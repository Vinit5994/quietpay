import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  DashOverviewResponse,
  Endpoints,
  HealthResponse,
  OnboardMerchantResponse,
  PAYMENTS_CSV_COLUMNS,
  Payment,
  PortalResponse,
  Receipt,
} from "@quietpay/shared";
import { merchants, payments } from "../src/db/schema";
import { Indexer } from "../src/indexer";
import { hoodieSession, setup } from "./helpers";

type Ctx = ReturnType<typeof setup>;
type Account = ReturnType<typeof privateKeyToAccount>;

async function signIn(ctx: Ctx, who: Account, role: "merchant" | "customer") {
  const n = (await ctx.call("GET", `/auth/nonce?address=${who.address}`)).body;
  const res = await ctx.call("POST", "/auth/verify", { body: { address: who.address, signature: await who.signMessage({ message: n.message }), role } });
  return res.body.token as string;
}

/** Pays a session the way the checkout page does and indexes it. */
async function pay(ctx: Ctx, payer: Account, body: object = hoodieSession) {
  ctx.chain.balances[payer.address.toLowerCase()] = (ctx.chain.balances[payer.address.toLowerCase()] ?? 0n) + 100_000_000n;
  const s = await ctx.call("POST", "/v1/checkout/sessions", { body, token: ctx.merchant.secretKey });
  return paySession(ctx, payer, s.body.id);
}

async function paySession(ctx: Ctx, payer: Account, sessionId: string) {
  const prep = await ctx.call("POST", `/public/sessions/${sessionId}/prepare`, { body: { payer: payer.address } });
  const sig = await payer.signTypedData(prep.body.typedData.payment);
  await ctx.call("POST", `/public/sessions/${sessionId}/submit`, { body: { payer: payer.address, signatures: { payment: sig } } });
  await ctx.relayer.idle();
  await new Indexer(ctx.deps, 90n).tick();
  return (await ctx.call("GET", `/public/sessions/${sessionId}/status`)).body.paymentId as string;
}

describe("every endpoint in @quietpay/shared is implemented", () => {
  it("walks the Endpoints map: no route answers 'No route …'", async () => {
    const ctx = setup();
    const missing: string[] = [];
    for (const [name, e] of Object.entries(Endpoints)) {
      const path = e.path.replace(/:[a-zA-Z]+/g, "x_test");
      const res = await ctx.call(e.method, path, { body: e.method === "GET" ? undefined : {} });
      if (res.status === 404 && String(res.body?.error?.message ?? "").startsWith("No route")) missing.push(`${name} ${e.method} ${e.path}`);
    }
    expect(missing).toEqual([]);
  });
});

describe("payment links", () => {
  it("creates a link with a QR code, unique slugs, and a fresh session per visit", async () => {
    const ctx = setup();
    const res = await ctx.call("POST", "/v1/payment_links", { body: { title: "Sticker Pack", amount: "3.00" }, token: ctx.merchant.secretKey });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ slug: "sticker-pack", amount: "3.00", active: true, url: "http://localhost:3001/l/sticker-pack" });
    expect(res.body.qrSvg).toMatch(/^<svg/);

    const again = await ctx.call("POST", "/v1/payment_links", { body: { title: "Sticker Pack", amount: "3.00" }, token: ctx.merchant.secretKey });
    expect(again.body.slug).toBe("sticker-pack-2");
    expect((await ctx.call("GET", "/v1/payment_links", { token: ctx.merchant.secretKey })).body.data).toHaveLength(2);

    const a = await ctx.call("GET", "/public/links/sticker-pack");
    const b = await ctx.call("GET", "/public/links/sticker-pack");
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ title: "Sticker Pack", amount: "3.00", sessionUrl: `http://localhost:3001/c/${a.body.sessionId}` });
    expect(a.body.sessionId).not.toBe(b.body.sessionId);

    // paying through the link: reference and link are recorded
    const payer = privateKeyToAccount(generatePrivateKey());
    ctx.chain.balances[payer.address.toLowerCase()] = 10_000_000n;
    const paymentId = await paySession(ctx, payer, a.body.sessionId);
    const p = ctx.deps.db.select().from(payments).where(eq(payments.id, paymentId)).get()!;
    expect(p).toMatchObject({ reference: "link:sticker-pack", amountUnits: "3000000" });
    expect((await ctx.call("GET", "/public/links/nope")).status).toBe(404);
  });
});

describe("payments list + CSV", () => {
  it("paginates newest first, filters by reference, and shows refund status", async () => {
    const ctx = setup();
    const payer = privateKeyToAccount(generatePrivateKey());
    for (const ref of ["ord_a", "ord_b", "ord_c"]) await pay(ctx, payer, { ...hoodieSession, reference: ref });
    ctx.deps.db.select().from(payments).all().forEach((p, i) => ctx.deps.db.update(payments).set({ paidAt: 1_800_000_000 + i }).where(eq(payments.id, p.id)).run());

    const page1 = await ctx.call("GET", "/v1/payments?limit=2", { token: ctx.merchant.secretKey });
    expect(page1.body.data.map((p: Payment) => p.reference)).toEqual(["ord_c", "ord_b"]);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await ctx.call("GET", `/v1/payments?limit=2&cursor=${page1.body.nextCursor}`, { token: ctx.merchant.secretKey });
    expect(page2.body.data.map((p: Payment) => p.reference)).toEqual(["ord_a"]);
    expect(page2.body.nextCursor).toBeNull();

    const byRef = await ctx.call("GET", "/v1/payments?reference=ord_b", { token: ctx.merchant.secretKey });
    expect(byRef.body.data).toHaveLength(1);
    const p = Payment.parse(byRef.body.data[0]);
    expect(p).toMatchObject({ status: "paid", amount: "37.00", refunded: "0.00", net: "37.00", refundable: "37.00", kind: "checkout" });

    ctx.deps.db.update(payments).set({ refundedUnits: "10000000" }).where(eq(payments.id, p.id)).run();
    const partly = Payment.parse((await ctx.call("GET", "/v1/payments?reference=ord_b", { token: ctx.merchant.secretKey })).body.data[0]);
    expect(partly).toMatchObject({ status: "partially_refunded", refunded: "10.00", net: "27.00", refundable: "27.00" });
  });

  it("exports CSV with the spec columns and neutralizes formula injection", async () => {
    const ctx = setup();
    const payer = privateKeyToAccount(generatePrivateKey());
    await pay(ctx, payer, { ...hoodieSession, reference: "=HYPERLINK(\"x\")" });
    const res = await ctx.app.request("/v1/exports/payments.csv", { headers: { authorization: `Bearer ${ctx.merchant.secretKey}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const [header, row] = (await res.text()).trim().split("\n");
    expect(header).toBe(PAYMENTS_CSV_COLUMNS.join(","));
    expect(row).toContain('"=HYPERLINK(""x"")"');
    expect(row).toContain("37.00");
  });
});

describe("dashboard", () => {
  it("onboards a new wallet: registers on-chain, shows keys once, token now carries the merchant", async () => {
    const ctx = setup();
    const owner = privateKeyToAccount(generatePrivateKey());
    const token = await signIn(ctx, owner, "merchant");
    expect((await ctx.call("GET", "/dash/merchant", { token })).status).toBe(403);

    const wrong = await ctx.call("POST", "/dash/merchant", { body: { name: "Chai Stall", payoutAddress: ctx.merchant.payout.address }, token });
    expect(wrong.status).toBe(400);

    const res = await ctx.call("POST", "/dash/merchant", { body: { name: "Chai Stall", payoutAddress: owner.address }, token });
    expect(res.status).toBe(201);
    const ob = OnboardMerchantResponse.parse(res.body);
    expect(ob.merchant).toMatchObject({ name: "Chai Stall", payoutAddress: owner.address });
    expect(ob.secretKey).toMatch(/^sk_test_/);

    const me = await ctx.call("GET", "/dash/merchant", { token: ob.token });
    expect(me.body.name).toBe("Chai Stall");
    expect((await ctx.call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: ob.secretKey })).status).toBe(201);
    expect((await ctx.call("POST", "/dash/merchant", { body: { name: "Again", payoutAddress: owner.address }, token: ob.token })).status).toBe(409);
    const row = ctx.deps.db.select().from(merchants).where(eq(merchants.id, ob.merchant.id)).get()!;
    expect(row.gasBudgetWei).toBe("0");
  });

  it("overview, lists, key rotation and delivery log", async () => {
    const ctx = setup();
    const token = await signIn(ctx, ctx.merchant.payout, "merchant");
    await pay(ctx, privateKeyToAccount(generatePrivateKey()));

    const ov = DashOverviewResponse.parse((await ctx.call("GET", "/dash/overview", { token })).body);
    expect(ov).toMatchObject({ volume24h: "37.00", volume7d: "37.00", paymentsCount: 1, activeSubscriptions: 0, refundsCount: 0 });
    expect(ov.gas.txCount).toBe(1);
    expect(BigInt(ov.gas.spentWei)).toBeGreaterThan(0n);

    expect((await ctx.call("GET", "/dash/payments", { token })).body.data).toHaveLength(1);
    expect((await ctx.call("GET", "/dash/subscriptions", { token })).body.data).toEqual([]);
    const deliveries = await ctx.call("GET", "/dash/webhooks/deliveries", { token });
    expect(deliveries.body.data.map((d: { type: string }) => d.type).sort()).toEqual(["checkout.session.completed", "payment.succeeded"]);

    const rotated = await ctx.call("POST", "/dash/keys/rotate", { token });
    expect(rotated.body.secretKey).toMatch(/^sk_test_/);
    expect((await ctx.call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: ctx.merchant.secretKey })).status).toBe(401);
    expect((await ctx.call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: rotated.body.secretKey })).status).toBe(201);
  });

  it("gas top-up counts a WBT transfer from the payout wallet to the relayer once", async () => {
    const ctx = setup();
    const token = await signIn(ctx, ctx.merchant.payout, "merchant");
    const ok = `0x${"aa".repeat(32)}`;
    const wrongTo = `0x${"bb".repeat(32)}`;
    ctx.chain.nativeTxs[ok] = { from: ctx.merchant.payout.address, to: ctx.chain.relayerAddress, value: 10n ** 17n, success: true };
    ctx.chain.nativeTxs[wrongTo] = { from: ctx.merchant.payout.address, to: ctx.merchant.payout.address, value: 10n ** 17n, success: true };

    const res = await ctx.call("POST", "/dash/gas/topup", { body: { txHash: ok }, token });
    expect(res.status).toBe(200);
    expect(res.body.budgetWei).toBe(String(5n * 10n ** 16n + 10n ** 17n));
    expect((await ctx.call("POST", "/dash/gas/topup", { body: { txHash: ok }, token })).body.budgetWei).toBe(res.body.budgetWei);
    expect((await ctx.call("POST", "/dash/gas/topup", { body: { txHash: wrongTo }, token })).status).toBe(400);
    expect((await ctx.call("POST", "/dash/gas/topup", { body: { txHash: `0x${"cc".repeat(32)}` }, token })).status).toBe(404);
  });
});

describe("receipts + portal", () => {
  it("receipt shows items, refunds and the tx link; 404 for unknown", async () => {
    const ctx = setup();
    const paymentId = await pay(ctx, privateKeyToAccount(generatePrivateKey()));
    const r = Receipt.parse((await ctx.call("GET", `/public/receipts/${paymentId}`)).body);
    expect(r).toMatchObject({ merchant: { name: "Swag Counter" }, amount: "37.00", refunded: "0.00", status: "paid", reference: "ord_1001" });
    expect(r.lineItems.map((i) => i.name)).toEqual(["Builder Hoodie (L)", "Sticker Pack"]);
    expect(r.explorerUrl).toContain(r.txHash);
    expect((await ctx.call("GET", "/public/receipts/pay_nope")).status).toBe(404);
  });

  it("portal shows only the signed-in wallet's payments", async () => {
    const ctx = setup();
    const alice = privateKeyToAccount(generatePrivateKey());
    const bob = privateKeyToAccount(generatePrivateKey());
    await pay(ctx, alice);
    await pay(ctx, bob);
    const token = await signIn(ctx, alice, "customer");
    const res = PortalResponse.parse((await ctx.call("GET", "/public/portal", { token })).body);
    expect(res.address).toBe(alice.address);
    expect(res.payments).toHaveLength(1);
    expect(res.payments[0]).toMatchObject({ merchantName: "Swag Counter", payerAddress: alice.address });
    expect(res.payments[0]!.receiptUrl).toBe(`http://localhost:3001/r/${res.payments[0]!.id}`);
    expect((await ctx.call("GET", "/public/portal")).status).toBe(401);
    expect((await ctx.call("GET", "/public/portal", { token: await signIn(ctx, alice, "merchant") })).status).toBe(403);
  });
});

describe("demo funding + health", () => {
  it("is off unless DEMO_MODE=true", async () => {
    const ctx = setup();
    const res = await ctx.call("POST", "/demo/fund", { body: { address: ctx.merchant.payout.address } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("demo_disabled");
  });

  it("says so when the treasury is empty", async () => {
    const ctx = setup({ env: { DEMO_MODE: "true", DEMO_TREASURY_PK: generatePrivateKey() } });
    const res = await ctx.call("POST", "/demo/fund", { body: { address: ctx.merchant.payout.address } });
    expect(res.status).toBe(503);
    expect(res.body.error.message).toContain("treasury is empty (0.00 USDT left)");
    expect(ctx.chain.demoSent).toHaveLength(0);
  });

  it("sends 50 USDT once per address per 10 minutes", async () => {
    const treasuryPk = generatePrivateKey();
    const ctx = setup({ env: { DEMO_MODE: "true", DEMO_TREASURY_PK: treasuryPk } });
    ctx.chain.balances[privateKeyToAccount(treasuryPk).address.toLowerCase()] = 500_000_000n;
    const to = privateKeyToAccount(generatePrivateKey()).address;
    const first = await ctx.call("POST", "/demo/fund", { body: { address: to } });
    expect(first.status).toBe(200);
    expect(first.body.amount).toBe("50.00");
    expect(ctx.chain.demoSent).toEqual([{ to, amount: 50_000_000n }]);
    const again = await ctx.call("POST", "/demo/fund", { body: { address: to } });
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe("demo_fund_cooldown");
  });

  it("health reports RPC, relayer balance and indexer lag", async () => {
    const ctx = setup();
    await new Indexer(ctx.deps, 90n).tick();
    const h = HealthResponse.parse((await ctx.call("GET", "/health")).body);
    expect(h).toMatchObject({ ok: true, chainId: 1874, rpc: { ok: true, blockNumber: "100" }, relayer: { low: false }, indexer: { lastBlock: "100", lagBlocks: 0 } });
  });
});
