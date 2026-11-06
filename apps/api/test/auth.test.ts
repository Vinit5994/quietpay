import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { AuthNonceResponse, AuthVerifyResponse } from "@quietpay/shared";
import { hoodieSession, setup } from "./helpers";

async function signIn(ctx: ReturnType<typeof setup>, account: ReturnType<typeof privateKeyToAccount>, role: "merchant" | "customer") {
  const n = AuthNonceResponse.parse((await ctx.call("GET", `/auth/nonce?address=${account.address}`)).body);
  expect(n.message).toBe(`Sign in to QuietPay\nNonce: ${n.nonce}`);
  const signature = await account.signMessage({ message: n.message });
  return ctx.call("POST", "/auth/verify", { body: { address: account.address, signature, role } });
}

describe("wallet sign-in", () => {
  it("signs the merchant's payout wallet in and the token works on /v1", async () => {
    const ctx = setup();
    const res = await signIn(ctx, ctx.merchant.payout, "merchant");
    expect(res.status).toBe(200);
    const v = AuthVerifyResponse.parse(res.body);
    expect(v).toMatchObject({ role: "merchant", address: ctx.merchant.payout.address, merchantId: ctx.merchant.id });

    const created = await ctx.call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: v.token });
    expect(created.status).toBe(201);
  });

  it("returns merchantId null for a wallet that hasn't onboarded", async () => {
    const ctx = setup();
    const res = await signIn(ctx, privateKeyToAccount(generatePrivateKey()), "merchant");
    expect(res.body.merchantId).toBeNull();
    const created = await ctx.call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: res.body.token });
    expect(created.status).toBe(401);
  });

  it("does not let a customer token use the merchant API", async () => {
    const ctx = setup();
    const res = await signIn(ctx, ctx.merchant.payout, "customer");
    expect(res.body.role).toBe("customer");
    expect((await ctx.call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: res.body.token })).status).toBe(401);
  });

  it("rejects a signature from another wallet", async () => {
    const ctx = setup();
    const victim = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    const n = (await ctx.call("GET", `/auth/nonce?address=${victim.address}`)).body;
    const signature = await attacker.signMessage({ message: n.message });
    const res = await ctx.call("POST", "/auth/verify", { body: { address: victim.address, signature, role: "customer" } });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_signature");
  });

  it("uses each nonce once", async () => {
    const ctx = setup();
    const wallet = privateKeyToAccount(generatePrivateKey());
    const n = (await ctx.call("GET", `/auth/nonce?address=${wallet.address}`)).body;
    const signature = await wallet.signMessage({ message: n.message });
    const body = { address: wallet.address, signature, role: "customer" };
    expect((await ctx.call("POST", "/auth/verify", { body })).status).toBe(200);
    expect((await ctx.call("POST", "/auth/verify", { body })).status).toBe(401);
  });

  it("rejects a forged token", async () => {
    const ctx = setup();
    const res = await ctx.call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: "eyJhbGciOiJIUzI1NiJ9.e30.x" });
    expect(res.status).toBe(401);
  });
});
