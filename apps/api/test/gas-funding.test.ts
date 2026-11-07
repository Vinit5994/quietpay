import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gasTopups, merchants, relayerTxs } from "../src/db/schema";
import { Relayer } from "../src/relayer";
import { gasSummary } from "../src/services/dash";
import { setup } from "./helpers";

type Ctx = ReturnType<typeof setup>;
async function signIn(ctx: Ctx, account = ctx.merchant.payout, role: "merchant" | "customer" = "merchant") {
  const { body } = await ctx.call("GET", `/auth/nonce?address=${account.address}`);
  const signature = await account.signMessage({ message: body.message });
  return (await ctx.call("POST", "/auth/verify", { body: { address: account.address, signature, role } })).body.token as string;
}
const row = (ctx: Ctx) => ctx.deps.db.select().from(merchants).where(eq(merchants.id, ctx.merchant.id)).get()!;
const request = (ctx: Ctx) => ({ fn: "setPlanActive" as const, args: [1n, true], purpose: "admin" as const, merchant: row(ctx) });
const hash = (hex: string) => `0x${hex.repeat(64)}` as const;

afterEach(() => vi.restoreAllMocks());

describe("verified gas deposits", () => {
  it("ignores legacy starter credit and cannot borrow another business's funding", async () => {
    const ctx = setup();
    const other = ctx.addMerchant("Another business", "8");
    ctx.deps.db.delete(gasTopups).where(eq(gasTopups.merchantId, ctx.merchant.id)).run();
    expect(gasSummary(ctx.deps, row(ctx)).remainingWei).toBe("0");
    await expect(ctx.relayer.relay(request(ctx))).rejects.toMatchObject({ code: "merchant_gas_budget_exhausted" });
    expect(ctx.chain.sent).toHaveLength(0);
    const plan = { name: "Membership", amount: "5.00", interval: "month" };
    expect((await ctx.call("POST", "/v1/plans", { token: ctx.merchant.secretKey, body: plan })).status).toBe(402);
    expect((await ctx.call("POST", "/v1/plans", { token: other.secretKey, body: plan })).status).toBe(201);
    await ctx.relayer.idle();
    expect(row(ctx).gasSpentWei).toBe("0");
  });

  it("credits only its own merchant and handles simultaneous confirmation retries once", async () => {
    const ctx = setup();
    const other = ctx.addMerchant("Other", "8");
    const token = await signIn(ctx);
    const txHash = hash("a");
    ctx.chain.nativeTxs[txHash] = { from: ctx.merchant.payout.address, to: ctx.chain.relayerAddress, value: 10n ** 18n, success: true };
    const results = await Promise.all([1, 2].map(() => ctx.call("POST", "/dash/gas/topup", { token, body: { txHash } })));
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(gasSummary(ctx.deps, row(ctx)).budgetWei).toBe("1050000000000000000");
    const otherRow = ctx.deps.db.select().from(merchants).where(eq(merchants.id, other.id)).get()!;
    expect(gasSummary(ctx.deps, otherRow).budgetWei).toBe("50000000000000000");
    const otherToken = await signIn(ctx, other.payout);
    expect((await ctx.call("POST", "/dash/gas/topup", { token: otherToken, body: { txHash } })).status).toBe(409);
  });

  it("rejects another sender, reverted transfers, zero-value transfers and relayer self-transfers", async () => {
    const ctx = setup();
    const token = await signIn(ctx);
    const txHash = hash("b");
    const deposit = { from: ctx.merchant.payout.address, to: ctx.chain.relayerAddress, value: 10n ** 18n, success: true };
    for (const tx of [{ ...deposit, from: privateKeyToAccount(generatePrivateKey()).address }, { ...deposit, success: false }, { ...deposit, value: 0n }]) {
      ctx.chain.nativeTxs[txHash] = tx;
      expect((await ctx.call("POST", "/dash/gas/topup", { token, body: { txHash } })).status).not.toBe(200);
    }
    ctx.chain.relayerAddress = ctx.merchant.payout.address;
    ctx.chain.nativeTxs[txHash] = { ...deposit, to: ctx.chain.relayerAddress };
    expect((await ctx.call("POST", "/dash/gas/topup", { token, body: { txHash } })).status).toBe(400);
  });
});

describe("admin sponsorship", () => {
  it("requires a signed token from the current contract owner, even without merchant onboarding", async () => {
    const ctx = setup();
    const owner = privateKeyToAccount(generatePrivateKey());
    ctx.chain.contractOwner = async () => owner.address;
    expect((await ctx.call("GET", "/admin/gas")).status).toBe(401);
    expect((await ctx.call("GET", "/admin/gas", { token: ctx.merchant.secretKey })).status).toBe(401);
    expect((await ctx.call("GET", "/admin/gas", { token: await signIn(ctx) })).status).toBe(403);
    expect((await ctx.call("GET", "/admin/gas", { token: await signIn(ctx, owner, "customer") })).status).toBe(403);
    const token = await signIn(ctx, owner);
    const info = await ctx.call("GET", "/admin/gas", { token });
    expect(info.status).toBe(200);
    expect(info.body.relayerAddress).toBe(ctx.chain.relayerAddress);
    const txHash = hash("c");
    ctx.chain.nativeTxs[txHash] = { from: owner.address, to: ctx.chain.relayerAddress, value: 10n ** 18n, success: true };
    const funded = await ctx.call("POST", "/admin/gas/topup", { token, body: { merchantId: ctx.merchant.id, txHash } });
    expect(funded.status).toBe(200);
    expect(funded.body.budgetWei).toBe("1050000000000000000");
    ctx.chain.contractOwner = async () => ctx.merchant.payout.address;
    expect((await ctx.call("GET", "/admin/gas", { token })).status).toBe(403);
  });

  it("cannot invent credit from an unrelated transfer or reuse it across businesses", async () => {
    const ctx = setup();
    ctx.chain.contractOwner = async () => ctx.merchant.payout.address;
    const token = await signIn(ctx);
    const other = ctx.addMerchant("Other", "8");
    const txHash = hash("d");
    ctx.chain.nativeTxs[txHash] = { from: other.payout.address, to: ctx.chain.relayerAddress, value: 10n ** 18n, success: true };
    expect((await ctx.call("POST", "/admin/gas/topup", { token, body: { merchantId: other.id, txHash } })).status).toBe(400);
    ctx.chain.nativeTxs[txHash]!.from = ctx.merchant.payout.address;
    expect((await ctx.call("POST", "/admin/gas/topup", { token, body: { merchantId: other.id, txHash } })).status).toBe(200);
    expect((await ctx.call("POST", "/admin/gas/topup", { token, body: { merchantId: ctx.merchant.id, txHash } })).status).toBe(409);
  });
});

describe("reserved gas balances", () => {
  it("blocks concurrent overspending and charges the actual fee instead of the whole reservation", async () => {
    const ctx = setup();
    const reserve = 300_000n * ctx.chain.gasPriceWei;
    ctx.deps.db.update(gasTopups).set({ valueWei: reserve.toString() }).where(eq(gasTopups.merchantId, ctx.merchant.id)).run();
    const wait = ctx.chain.waitForReceipt;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    ctx.chain.waitForReceipt = async (txHash) => { await gate; return wait(txHash); };
    const send = vi.spyOn(ctx.chain, "send");
    const results = await Promise.allSettled([ctx.relayer.relay(request(ctx)), ctx.relayer.relay(request(ctx))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(ctx.chain.sent).toHaveLength(1);
    expect(send).toHaveBeenCalledWith("setPlanActive", [1n, true], { gas: 300_000n, gasPrice: ctx.chain.gasPriceWei });
    expect(gasSummary(ctx.deps, row(ctx)).remainingWei).toBe("0");
    release();
    await ctx.relayer.idle();
    const actual = 244_000n * ctx.chain.gasPriceWei;
    expect(gasSummary(ctx.deps, row(ctx)).remainingWei).toBe((reserve - actual).toString());
    expect(row(ctx).gasSpentWei).toBe(actual.toString());
  });

  it("keeps reservations after receipt timeouts and recovers exactly once after a restart", async () => {
    const ctx = setup();
    const wait = ctx.chain.waitForReceipt;
    vi.spyOn(console, "error").mockImplementation(() => {});
    ctx.chain.waitForReceipt = async () => { throw new Error("RPC timeout"); };
    const onError = vi.fn();
    await ctx.relayer.relay({ ...request(ctx), onError });
    await ctx.relayer.idle();
    expect(onError).not.toHaveBeenCalled(); // Unknown confirmations must not reopen the payment.
    const pending = ctx.deps.db.select().from(relayerTxs).get()!;
    expect(pending.status).toBe("pending");
    expect(row(ctx).gasSpentWei).toBe("0");
    expect(BigInt(gasSummary(ctx.deps, row(ctx)).remainingWei)).toBe(50_000_000_000_000_000n - 300_000n * ctx.chain.gasPriceWei);
    ctx.chain.waitForReceipt = wait;
    const restarted = new Relayer(ctx.deps);
    await restarted.recoverPending();
    await restarted.recoverPending();
    expect(row(ctx).gasSpentWei).toBe(String(244_000n * ctx.chain.gasPriceWei));
    expect(ctx.deps.db.select().from(relayerTxs).get()!.status).toBe("succeeded");
  });

  it("keeps a reservation when the broadcast result is unknown", async () => {
    const ctx = setup();
    ctx.chain.send = async () => { throw new Error("Connection lost after broadcast"); };
    await expect(ctx.relayer.relay(request(ctx))).rejects.toMatchObject({ code: "transaction_failed" });
    expect(ctx.deps.db.select().from(relayerTxs).get()!.status).toBe("pending");
    expect(BigInt(gasSummary(ctx.deps, row(ctx)).remainingWei)).toBe(50_000_000_000_000_000n - 300_000n * ctx.chain.gasPriceWei);
  });

  it("charges reverted transactions only to their business and stops when the relayer is empty", async () => {
    const ctx = setup();
    const other = ctx.addMerchant("Other", "8");
    ctx.chain.revertOnChain = true;
    await ctx.relayer.relay(request(ctx));
    await ctx.relayer.idle();
    expect(row(ctx).gasSpentWei).toBe(String(244_000n * ctx.chain.gasPriceWei));
    expect(ctx.deps.db.select().from(merchants).where(eq(merchants.id, other.id)).get()!.gasSpentWei).toBe("0");
    ctx.chain.relayerBalanceWei = 0n;
    await expect(ctx.relayer.relay(request(ctx))).rejects.toMatchObject({ code: "merchant_gas_budget_exhausted" });
    expect(ctx.chain.sent).toHaveLength(1);
  });
});
