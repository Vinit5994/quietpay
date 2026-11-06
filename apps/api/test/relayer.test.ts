import { eq } from "drizzle-orm";
import { ContractFunctionRevertedError, encodeErrorResult, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionStatusResponse, apiPaymentId, checkoutPaymentId, quietPayAbi } from "@quietpay/shared";
import { checkoutSessions, merchants, payments, relayerTxs } from "../src/db/schema";
import { decodeRevert } from "../src/relayer/errors";
import { RateLimiter } from "../src/relayer/ratelimit";
import { hoodieSession, setup } from "./helpers";

const payer = privateKeyToAccount(generatePrivateKey());

/** Creates a 37.00 session, funds the payer, runs /prepare and signs like the frontend. */
async function signedSession(ctx = setup(), signer = payer) {
  ctx.chain.balances[signer.address.toLowerCase()] = 100_000_000n;
  const { body } = await ctx.call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: ctx.merchant.secretKey });
  const prep = await ctx.call("POST", `/public/sessions/${body.id}/prepare`, { body: { payer: signer.address } });
  const signature = await signer.signTypedData(prep.body.typedData.payment);
  const submit = (sig: Hex = signature, who = signer.address) =>
    ctx.call("POST", `/public/sessions/${body.id}/submit`, { body: { payer: who, signatures: { payment: sig } } });
  const status = async () => SessionStatusResponse.parse((await ctx.call("GET", `/public/sessions/${body.id}/status`)).body);
  const row = () => ctx.deps.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, body.id)).get()!;
  return { ...ctx, sessionId: body.id as string, signature, submit, status, row };
}

afterEach(() => vi.restoreAllMocks());

describe("submit: happy path", () => {
  it("relays pay(), completes the session and accounts the gas", async () => {
    const s = await signedSession();
    const res = await s.submit();
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "processing", txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/) });

    // exactly one pay() with the stored invoice signature and the payer's authorization
    expect(s.chain.sent).toHaveLength(1);
    const { fn, args } = s.chain.sent[0]!;
    const row = s.row();
    expect(fn).toBe("pay");
    expect(args).toEqual([7n, row.orderIdHex, 37_000_000n, BigInt(row.expiresAt), row.invoiceSig, payer.address, 0n, BigInt(row.expiresAt), s.signature]);

    await s.relayer.idle();
    const st = await s.status();
    const paymentId = apiPaymentId(checkoutPaymentId(7n, row.orderIdHex as Hex));
    expect(st).toMatchObject({
      status: "complete",
      txHash: res.body.txHash,
      paymentId,
      receiptUrl: `http://localhost:3001/r/${paymentId}`,
      redirectUrl: hoodieSession.successUrl,
      error: null,
    });

    const p = s.deps.db.select().from(payments).where(eq(payments.id, paymentId)).get()!;
    expect(p).toMatchObject({ kind: "checkout", amountUnits: "37000000", reference: "ord_1001", sessionId: s.sessionId });

    const rtx = s.deps.db.select().from(relayerTxs).get()!;
    expect(rtx).toMatchObject({ purpose: "pay", status: "succeeded", gasUsed: "244000", gasCostWei: String(244_000n * 5_000_000_000n) });
    const m = s.deps.db.select().from(merchants).where(eq(merchants.id, s.merchant.id)).get()!;
    expect(m.gasSpentWei).toBe(String(244_000n * 5_000_000_000n));
  });
});

describe("submit: rejection paths (each sends nothing)", () => {
  it("2. unknown, expired, already processing, double submit", async () => {
    const s = await signedSession();
    expect((await s.call("POST", "/public/sessions/sess_nope/submit", { body: { payer: payer.address, signatures: {} } })).status).toBe(404);

    const [first, second] = await Promise.all([s.submit(), s.submit()]);
    expect([first.status, second.status].sort()).toEqual([202, 409]);
    expect(second.status === 409 ? second.body.error.code : first.body.error.code).toBe("session_not_open");
    expect(s.chain.sent).toHaveLength(1);

    const e = await signedSession();
    e.deps.db.update(checkoutSessions).set({ expiresAt: 1 }).where(eq(checkoutSessions.id, e.sessionId)).run();
    const expired = await e.submit();
    expect(expired.body.error.code).toBe("session_expired");
    expect(e.chain.sent).toHaveLength(0);
  });

  it("3. signature from another wallet → invalid_signature, session reopens with the error", async () => {
    const s = await signedSession();
    const other = privateKeyToAccount(generatePrivateKey());
    const prep = await s.call("POST", `/public/sessions/${s.sessionId}/prepare`, { body: { payer: payer.address } });
    const forged = await other.signTypedData(prep.body.typedData.payment);
    const res = await s.submit(forged);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_signature");
    expect(s.chain.sent).toHaveLength(0);

    const st = await s.status();
    expect(st.status).toBe("open");
    expect(st.error?.code).toBe("invalid_signature");
    expect((await s.submit()).status).toBe(202); // the real signature still works
  });

  it("3. payer must be the one /prepare was called with", async () => {
    const s = await signedSession();
    const other = privateKeyToAccount(generatePrivateKey());
    const res = await s.submit(s.signature, other.address);
    expect(res.body.error.code).toBe("invalid_signature");
  });

  it("3. signature over a different amount is rejected", async () => {
    const s = await signedSession();
    const prep = await s.call("POST", `/public/sessions/${s.sessionId}/prepare`, { body: { payer: payer.address } });
    const td = prep.body.typedData.payment;
    const cheaper = await payer.signTypedData({ ...td, message: { ...td.message, value: "1000000" } });
    expect((await s.submit(cheaper)).body.error.code).toBe("invalid_signature");
  });

  it("4. insufficient balance → 402 with what the wallet has and needs", async () => {
    const s = await signedSession();
    s.chain.balances[payer.address.toLowerCase()] = 4_000_000n;
    const res = await s.submit();
    expect(res.status).toBe(402);
    expect(res.body.error).toEqual({
      code: "insufficient_balance",
      message: "Your wallet has 4.00 USDT; this order needs 37.00 USDT. Add funds and try again.",
    });
    expect(s.chain.sent).toHaveLength(0);
  });

  it("5. below the 0.50 minimum", async () => {
    const s = await signedSession();
    s.deps.db.update(checkoutSessions).set({ amountUnits: "400000" }).where(eq(checkoutSessions.id, s.sessionId)).run();
    const prep = await s.call("POST", `/public/sessions/${s.sessionId}/prepare`, { body: { payer: payer.address } });
    const sig = await payer.signTypedData(prep.body.typedData.payment);
    const res = await s.submit(sig);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("amount_below_minimum");
  });

  it("6. per-payer rate limit (5/min)", async () => {
    const ctx = setup();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await (await signedSession(ctx)).submit()).status);
    expect(codes).toEqual([202, 202, 202, 202, 202, 429]);
    expect(ctx.chain.sent).toHaveLength(5);
  });

  it("6. token bucket refills over time", () => {
    let t = 0;
    const rl = new RateLimiter(2, 60, () => t);
    expect([rl.take("a"), rl.take("a"), rl.take("a")]).toEqual([true, true, false]);
    expect(rl.take("b")).toBe(true);
    t = 30;
    expect(rl.take("a")).toBe(true);
  });

  it("7. merchant gas budget exhausted → 402", async () => {
    const s = await signedSession();
    s.deps.db.update(merchants).set({ gasSpentWei: "49999999999999999" }).where(eq(merchants.id, s.merchant.id)).run();
    const res = await s.submit();
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("merchant_gas_budget_exhausted");
    expect(s.chain.sent).toHaveLength(0);
  });

  it("8. simulation revert is decoded into the API error", async () => {
    const s = await signedSession();
    s.chain.simulateError = { errorName: "OrderAlreadyPaid" };
    const res = await s.submit();
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("order_already_paid");
    expect(s.chain.sent).toHaveLength(0);
  });

  it("9. on-chain revert reopens the session with transaction_failed", async () => {
    const s = await signedSession();
    s.chain.revertOnChain = true;
    expect((await s.submit()).status).toBe(202);
    await s.relayer.idle();
    const st = await s.status();
    expect(st.status).toBe("open");
    expect(st.error?.code).toBe("transaction_failed");
    expect(s.deps.db.select().from(relayerTxs).get()!.status).toBe("failed");
  });

  it("10. warns when the relayer runs low on WBT", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await signedSession();
    s.chain.relayerBalanceWei = 10n ** 16n; // 0.01 WBT
    await s.submit();
    await s.relayer.idle();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("LOW BALANCE"));
  });

  it("1. the relayer refuses functions outside the allow-list", async () => {
    const s = setup();
    const merchant = s.deps.db.select().from(merchants).get()!;
    await expect(s.relayer.relay({ fn: "transferOwnership" as never, args: [], merchant, purpose: "admin" })).rejects.toMatchObject({
      code: "bad_request",
    });
  });
});

describe("decodeRevert", () => {
  it("decodes real QuietPay custom errors from viem", () => {
    const err = new ContractFunctionRevertedError({
      abi: quietPayAbi,
      functionName: "pay",
      data: encodeErrorResult({ abi: quietPayAbi, errorName: "InvoiceExpired" }),
    });
    expect(decodeRevert(err)).toMatchObject({ status: 422, code: "invoice_expired" });
  });

  it("maps Tether revert strings and unknown failures", () => {
    expect(decodeRevert({ reason: "EIP3009: invalid signature" }).code).toBe("invalid_signature");
    expect(decodeRevert({ reason: "EIP3009: authorization is used or canceled" }).code).toBe("order_already_paid");
    expect(decodeRevert({ reason: "something odd" }).code).toBe("simulation_failed");
  });
});
