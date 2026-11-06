import { eq } from "drizzle-orm";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { RefundTypedDataResponse, USDT_ADDRESS, WebhookEvent, refundNonce } from "@quietpay/shared";
import { payments, refunds, webhookDeliveries } from "../src/db/schema";
import { Indexer } from "../src/indexer";
import { QUIETPAY, hoodieSession, setup } from "./helpers";

const payer = privateKeyToAccount(generatePrivateKey());

/** A paid 37.00 checkout, a signed-in merchant dashboard, and helpers to refund through the API. */
async function paid() {
  const ctx = setup();
  ctx.chain.balances[payer.address.toLowerCase()] = 100_000_000n;
  ctx.chain.balances[ctx.merchant.payout.address.toLowerCase()] = 100_000_000n; // payout wallet funds refunds
  const { body } = await ctx.call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: ctx.merchant.secretKey });
  const prep = await ctx.call("POST", `/public/sessions/${body.id}/prepare`, { body: { payer: payer.address } });
  const sig = await payer.signTypedData(prep.body.typedData.payment);
  await ctx.call("POST", `/public/sessions/${body.id}/submit`, { body: { payer: payer.address, signatures: { payment: sig } } });
  await ctx.relayer.idle();
  const indexer = new Indexer(ctx.deps, 90n);
  await indexer.tick();
  const payment = ctx.deps.db.select().from(payments).get()!;

  const n = (await ctx.call("GET", `/auth/nonce?address=${ctx.merchant.payout.address}`)).body;
  const login = await ctx.call("POST", "/auth/verify", {
    body: { address: ctx.merchant.payout.address, signature: await ctx.merchant.payout.signMessage({ message: n.message }), role: "merchant" },
  });
  const dash = login.body.token as string;

  const request = (amount: string) =>
    ctx.call("POST", "/v1/refunds", { body: { paymentId: payment.id, amount, reason: "wrong size" }, token: ctx.merchant.secretKey });
  const typedData = (id: string) => ctx.call("POST", `/dash/refunds/${id}/typed-data`, { token: dash });
  const submit = (id: string, signature: Hex) => ctx.call("POST", `/dash/refunds/${id}/submit`, { body: { signature }, token: dash });
  /** request → typed data → payout signs → submit → receipt + indexer */
  const refund = async (amount: string) => {
    const r = await request(amount);
    const td = await typedData(r.body.id);
    const res = await submit(r.body.id, await ctx.merchant.payout.signTypedData(td.body.typedData));
    await ctx.relayer.idle();
    await indexer.tick();
    return { request: r, typed: td, res };
  };
  const refundRow = (id: string) => ctx.deps.db.select().from(refunds).where(eq(refunds.id, id)).get()!;
  const paymentRow = () => ctx.deps.db.select().from(payments).get()!;
  const webhooks = () =>
    ctx.deps.db.select().from(webhookDeliveries).all().map((d) => WebhookEvent.parse(JSON.parse(d.payloadJson))).filter((e) => e.type === "refund.succeeded");
  return { ...ctx, payment, dash, request, typedData, submit, refund, refundRow, paymentRow, webhooks, indexer };
}

describe("refunds", () => {
  it("two partial refunds succeed with sequence 0 then 1; a too-large one is rejected before sending", async () => {
    const s = await paid();

    const first = await s.refund("8.00");
    expect(first.request.status).toBe(201);
    expect(first.request.body).toMatchObject({ amount: "8.00", status: "awaiting_signature", signUrl: expect.stringContaining(first.request.body.id) });
    expect(first.res.status).toBe(200);
    expect(s.refundRow(first.request.body.id)).toMatchObject({ status: "succeeded", seq: 0 });

    const second = await s.refund("17.00");
    expect(s.refundRow(second.request.body.id)).toMatchObject({ status: "succeeded", seq: 1 });
    const td = RefundTypedDataResponse.parse(second.typed.body);
    expect(td.typedData.message.nonce).toBe(refundNonce(QUIETPAY, s.payment.onchainPaymentId as Hex, 1));

    expect(s.paymentRow().refundedUnits).toBe("25000000");
    expect(s.chain.balances[payer.address.toLowerCase()]).toBe(100_000_000n - 37_000_000n + 25_000_000n);

    // 37 − 25 = 12 left: 13 is rejected at creation, nothing is relayed
    const sentBefore = s.chain.sent.length;
    const tooBig = await s.request("13.00");
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error).toEqual({ code: "refund_exceeds_payment", message: "Only 12.00 USDT of this 37.00 USDT payment can still be refunded." });
    expect(s.chain.sent.length).toBe(sentBefore);

    const hooks = s.webhooks();
    expect(hooks.map((h) => h.type === "refund.succeeded" && [h.data.amount, h.data.totalRefunded, h.data.fullyRefunded])).toEqual([
      ["8.00", "8.00", false],
      ["17.00", "25.00", false],
    ]);
    expect(hooks[0]!.type === "refund.succeeded" && hooks[0]!.data.merchantReference).toBe("ord_1001");

    // the rest refunds fully
    await s.refund("12.00");
    const last = s.webhooks().at(-1)!;
    expect(last.type === "refund.succeeded" && [last.data.totalRefunded, last.data.fullyRefunded]).toEqual(["37.00", true]);
  });

  it("typed data is an EIP-3009 authorization from the payout wallet to QuietPay", async () => {
    const s = await paid();
    const r = await s.request("5.00");
    const td = RefundTypedDataResponse.parse((await s.typedData(r.body.id)).body);
    expect(td.signer).toBe(s.merchant.payout.address);
    expect(td.typedData.domain.verifyingContract).toBe(USDT_ADDRESS);
    expect(td.typedData.message).toMatchObject({
      from: s.merchant.payout.address,
      to: QUIETPAY,
      value: "5000000",
      validAfter: "0",
      nonce: refundNonce(QUIETPAY, s.payment.onchainPaymentId as Hex, 0),
    });
    expect(td.refund).toMatchObject({ seq: 0, status: "awaiting_signature" });
  });

  it("only the payout wallet's signature is accepted", async () => {
    const s = await paid();
    const r = await s.request("5.00");
    const td = await s.typedData(r.body.id);
    const res = await s.submit(r.body.id, await payer.signTypedData(td.body.typedData));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_signature");
    expect(s.chain.sent.filter((t) => t.fn === "refund")).toHaveLength(0);
  });

  it("two refunds signed against the same sequence: the second must be re-signed", async () => {
    const s = await paid();
    const a = await s.request("5.00");
    const b = await s.request("6.00");
    const tdA = await s.typedData(a.body.id);
    const tdB = await s.typedData(b.body.id); // also seq 0
    expect((await s.submit(a.body.id, await s.merchant.payout.signTypedData(tdA.body.typedData))).status).toBe(200);
    await s.relayer.idle();

    const stale = await s.submit(b.body.id, await s.merchant.payout.signTypedData(tdB.body.typedData));
    expect(stale.status).toBe(409);
    const fresh = await s.typedData(b.body.id);
    expect(fresh.body.refund.seq).toBe(1);
    expect((await s.submit(b.body.id, await s.merchant.payout.signTypedData(fresh.body.typedData))).status).toBe(200);
  });

  it("checks the payout wallet balance before relaying", async () => {
    const s = await paid();
    s.chain.balances[s.merchant.payout.address.toLowerCase()] = 1_000_000n;
    const r = await s.request("5.00");
    const td = await s.typedData(r.body.id);
    const res = await s.submit(r.body.id, await s.merchant.payout.signTypedData(td.body.typedData));
    expect(res.status).toBe(402);
    expect(res.body.error.message).toBe("The payout wallet has 1.00 USDT; this refund needs 5.00 USDT.");
  });

  it("dashboard refund routes need the merchant's own dashboard sign-in", async () => {
    const s = await paid();
    const r = await s.request("5.00");
    expect((await s.call("POST", `/dash/refunds/${r.body.id}/typed-data`, { token: s.merchant.secretKey })).status).toBe(401);

    const other = s.addMerchant("Other Shop", "8");
    const n = (await s.call("GET", `/auth/nonce?address=${other.payout.address}`)).body;
    const login = await s.call("POST", "/auth/verify", {
      body: { address: other.payout.address, signature: await other.payout.signMessage({ message: n.message }), role: "merchant" },
    });
    expect((await s.call("POST", `/dash/refunds/${r.body.id}/typed-data`, { token: login.body.token })).status).toBe(404);
    expect((await s.call("POST", "/v1/refunds", { body: { paymentId: s.payment.id, amount: "1.00" }, token: other.secretKey })).status).toBe(404);
  });

  it("refunds a subscription charge too", async () => {
    // covered on-chain by contracts test 21; here: the API accepts any of the merchant's payments
    const s = await paid();
    s.deps.db.update(payments).set({ kind: "subscription" }).run();
    const { res } = await s.refund("2.00");
    expect(res.status).toBe(200);
  });
});
