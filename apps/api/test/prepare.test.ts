import { eq } from "drizzle-orm";
import { recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { PrepareSessionResponse, PublicSession, USDT_ADDRESS, paymentNonce } from "@quietpay/shared";
import { checkoutSessions } from "../src/db/schema";
import { QUIETPAY, hoodieSession, setup } from "./helpers";

const payer = privateKeyToAccount(generatePrivateKey());

async function newSession() {
  const ctx = setup();
  const { body } = await ctx.call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: ctx.merchant.secretKey });
  return { ...ctx, sessionId: body.id as string };
}

describe("GET /public/sessions/:id", () => {
  it("shows the merchant, items and total without auth", async () => {
    const { call, sessionId } = await newSession();
    const res = await call("GET", `/public/sessions/${sessionId}`);
    expect(res.status).toBe(200);
    const s = PublicSession.parse(res.body);
    expect(s.merchant.name).toBe("Swag Counter");
    expect(s.amount).toBe("37.00");
    expect(s.lineItems).toHaveLength(2);
    expect(s.plan).toBeNull();
  });

  it("404s for an unknown session", async () => {
    const { call } = setup();
    const res = await call("GET", "/public/sessions/sess_missing");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });
});

describe("POST /public/sessions/:id/prepare", () => {
  it("returns the exact EIP-3009 typed data QuietPay.pay expects", async () => {
    const { call, chain, deps, sessionId } = await newSession();
    chain.balances[payer.address.toLowerCase()] = 50_000_000n;

    const res = await call("POST", `/public/sessions/${sessionId}/prepare`, { body: { payer: payer.address } });
    expect(res.status).toBe(200);
    const prep = PrepareSessionResponse.parse(res.body);
    if (prep.mode !== "payment") throw new Error("expected payment mode");

    const row = deps.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, sessionId)).get()!;
    const td = prep.typedData.payment;
    expect(td.domain).toEqual({ name: "Tether USD", version: "1", chainId: 1874, verifyingContract: USDT_ADDRESS });
    expect(td.primaryType).toBe("ReceiveWithAuthorization");
    expect(td.message).toEqual({
      from: payer.address,
      to: QUIETPAY,
      value: "37000000",
      validAfter: "0",
      validBefore: String(row.expiresAt),
      nonce: paymentNonce(QUIETPAY, 7n, row.orderIdHex as Hex),
    });
    expect(prep).toMatchObject({ amount: "37.00", balance: "50.00", sufficientBalance: true });
    expect(row.payerAddress).toBe(payer.address);

    // what the frontend does: sign exactly what came back
    const signature = await payer.signTypedData(td as never);
    expect(await recoverTypedDataAddress({ ...(td as object), signature } as never)).toBe(payer.address);
  });

  it("reports insufficient balance", async () => {
    const { call, chain, sessionId } = await newSession();
    chain.balances[payer.address.toLowerCase()] = 4_000_000n;
    const res = await call("POST", `/public/sessions/${sessionId}/prepare`, { body: { payer: payer.address } });
    expect(res.body).toMatchObject({ balance: "4.00", sufficientBalance: false });
  });

  it("refuses an expired session", async () => {
    const { call, deps, sessionId } = await newSession();
    deps.db.update(checkoutSessions).set({ expiresAt: 1 }).where(eq(checkoutSessions.id, sessionId)).run();

    const res = await call("POST", `/public/sessions/${sessionId}/prepare`, { body: { payer: payer.address } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("session_expired");
    expect((await call("GET", `/public/sessions/${sessionId}`)).body.status).toBe("expired");
  });

  it("refuses a session that is already processing", async () => {
    const { call, deps, sessionId } = await newSession();
    deps.db.update(checkoutSessions).set({ status: "processing" }).where(eq(checkoutSessions.id, sessionId)).run();
    const res = await call("POST", `/public/sessions/${sessionId}/prepare`, { body: { payer: payer.address } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("session_not_open");
  });

  it("validates the payer address", async () => {
    const { call, sessionId } = await newSession();
    const res = await call("POST", `/public/sessions/${sessionId}/prepare`, { body: { payer: "0x123" } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
  });
});
