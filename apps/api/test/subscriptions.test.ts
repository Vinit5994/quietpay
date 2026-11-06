import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  Plan,
  PrepareSessionResponse,
  PublicSession,
  Subscription,
  USDT_ADDRESS,
  WebhookEvent,
  apiPaymentId,
  subscriptionPaymentId,
} from "@quietpay/shared";
import { subscriptions, webhookDeliveries } from "../src/db/schema";
import { Indexer } from "../src/indexer";
import { Keeper } from "../src/keeper";
import { QUIETPAY, setup } from "./helpers";

const box = { name: "Builder Box", amount: "15.00", interval: "custom", periodSeconds: 120, graceSeconds: 60 };

async function withPlan(ctx = setup(), body: object = box) {
  const res = await ctx.call("POST", "/v1/plans", { body, token: ctx.merchant.secretKey });
  return { ...ctx, planRes: res, plan: res.body };
}

/** Subscribes `who` through the API like the checkout page: prepare → sign Subscribe + Permit → submit. */
async function subscribed(opts: { balance?: bigint } = {}) {
  const ctx = await withPlan();
  const who = privateKeyToAccount(generatePrivateKey());
  ctx.chain.balances[who.address.toLowerCase()] = opts.balance ?? 100_000_000n;
  const session = await ctx.call("POST", "/v1/checkout/sessions", {
    body: { mode: "subscription", planId: ctx.plan.id, reference: "box_42", successUrl: "http://s.test/box", cancelUrl: "http://s.test/box" },
    token: ctx.merchant.secretKey,
  });
  const prep = await ctx.call("POST", `/public/sessions/${session.body.id}/prepare`, { body: { payer: who.address } });
  const subscribe = await who.signTypedData(prep.body.typedData.subscribe);
  const permit = await who.signTypedData(prep.body.typedData.permit);
  const submit = await ctx.call("POST", `/public/sessions/${session.body.id}/submit`, {
    body: { payer: who.address, signatures: { subscribe, permit } },
  });
  await ctx.relayer.idle();
  const indexer = new Indexer(ctx.deps, 90n);
  const keeper = new Keeper(ctx.deps, ctx.relayer, () => ctx.chain.time);
  const sub = () => ctx.deps.db.select().from(subscriptions).get()!;
  const webhooks = () => ctx.deps.db.select().from(webhookDeliveries).all().map((d) => WebhookEvent.parse(JSON.parse(d.payloadJson)));
  /** keeper → relayer → indexer, like one round of the background loops */
  const round = async () => {
    await keeper.tick();
    await ctx.relayer.idle();
    await indexer.tick();
  };
  return { ...ctx, who, sessionId: session.body.id as string, prep, submit, indexer, keeper, sub, webhooks, round };
}

describe("plans", () => {
  it("creates the plan on-chain and lists it", async () => {
    const ctx = await withPlan();
    expect(ctx.planRes.status).toBe(201);
    const plan = Plan.parse(ctx.plan);
    expect(plan).toMatchObject({ name: "Builder Box", amount: "15.00", onchainPlanId: "1", periodSeconds: 120, graceSeconds: 60, active: true });
    expect(ctx.chain.sent[0]).toMatchObject({ fn: "createPlan", args: [7n, 15_000_000n, 120, 60] });

    const list = await ctx.call("GET", "/v1/plans", { token: ctx.merchant.secretKey });
    expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([plan.id]);
  });

  it("uses month/week periods with a 3-day grace by default", async () => {
    const { plan } = await withPlan(setup(), { name: "Weekly", amount: "5.00", interval: "week" });
    expect(plan).toMatchObject({ periodSeconds: 604_800, graceSeconds: 259_200 });
  });

  it("DEMO_PERIOD_OVERRIDE forces short periods and a 60s grace", async () => {
    const { plan } = await withPlan(setup({ env: { DEMO_PERIOD_OVERRIDE: "120" } }), { name: "Monthly", amount: "9.00", interval: "month" });
    expect(plan).toMatchObject({ periodSeconds: 120, graceSeconds: 60 });
  });
});

describe("subscription checkout", () => {
  it("shows plan terms and the spending cap", async () => {
    const ctx = await withPlan();
    const session = await ctx.call("POST", "/v1/checkout/sessions", {
      body: { mode: "subscription", planId: ctx.plan.id, reference: "box_1", successUrl: "http://s.test/a", cancelUrl: "http://s.test/b" },
      token: ctx.merchant.secretKey,
    });
    expect(session.status).toBe(201);
    expect(session.body).toMatchObject({ mode: "subscription", amount: "15.00", planId: ctx.plan.id });

    const pub = PublicSession.parse((await ctx.call("GET", `/public/sessions/${session.body.id}`)).body);
    expect(pub.plan).toEqual({
      id: ctx.plan.id,
      name: "Builder Box",
      amount: "15.00",
      periodSeconds: 120,
      graceSeconds: 60,
      spendingCap: "180.00",
      capPeriods: 12,
    });
  });

  it("prepare returns Subscribe + Permit with on-chain nonces and allowance + 12 × amount", async () => {
    const ctx = await withPlan();
    const who = privateKeyToAccount(generatePrivateKey());
    ctx.chain.balances[who.address.toLowerCase()] = 50_000_000n;
    ctx.chain.allowances[who.address.toLowerCase()] = 5_000_000n; // left over from elsewhere
    const session = await ctx.call("POST", "/v1/checkout/sessions", {
      body: { mode: "subscription", planId: ctx.plan.id, reference: "box_1", successUrl: "http://s.test/a", cancelUrl: "http://s.test/b" },
      token: ctx.merchant.secretKey,
    });
    const res = await ctx.call("POST", `/public/sessions/${session.body.id}/prepare`, { body: { payer: who.address } });
    const prep = PrepareSessionResponse.parse(res.body);
    if (prep.mode !== "subscription") throw new Error("expected subscription");

    const deadline = String(Math.floor(new Date(session.body.expiresAt).getTime() / 1000));
    expect(prep.typedData.subscribe.domain).toEqual({ name: "QuietPay", version: "1", chainId: 1874, verifyingContract: QUIETPAY });
    expect(prep.typedData.subscribe.message).toEqual({ planId: "1", subscriber: who.address, maxAmount: "15000000", nonce: "0", deadline });
    expect(prep.typedData.permit.domain.verifyingContract).toBe(USDT_ADDRESS);
    expect(prep.typedData.permit.message).toEqual({ owner: who.address, spender: QUIETPAY, value: "185000000", nonce: "0", deadline });
    expect(prep).toMatchObject({ amount: "15.00", spendingCap: "180.00", balance: "50.00", sufficientBalance: true });
  });

  it("rejects a missing permit, a wrong signer and an empty wallet", async () => {
    const ctx = await withPlan();
    const who = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    ctx.chain.balances[who.address.toLowerCase()] = 100_000_000n;
    const mk = async () =>
      (await ctx.call("POST", "/v1/checkout/sessions", {
        body: { mode: "subscription", planId: ctx.plan.id, reference: "box", successUrl: "http://s.test/a", cancelUrl: "http://s.test/b" },
        token: ctx.merchant.secretKey,
      })).body.id as string;

    const a = await mk();
    const pa = (await ctx.call("POST", `/public/sessions/${a}/prepare`, { body: { payer: who.address } })).body;
    const onlySub = await ctx.call("POST", `/public/sessions/${a}/submit`, {
      body: { payer: who.address, signatures: { subscribe: await who.signTypedData(pa.typedData.subscribe) } },
    });
    expect(onlySub.status).toBe(400);

    const forged = await ctx.call("POST", `/public/sessions/${a}/submit`, {
      body: { payer: who.address, signatures: { subscribe: await other.signTypedData(pa.typedData.subscribe), permit: await who.signTypedData(pa.typedData.permit) } },
    });
    expect(forged.body.error.code).toBe("invalid_signature");

    ctx.chain.balances[who.address.toLowerCase()] = 1_000_000n;
    const broke = await ctx.call("POST", `/public/sessions/${a}/submit`, {
      body: { payer: who.address, signatures: { subscribe: await who.signTypedData(pa.typedData.subscribe), permit: await who.signTypedData(pa.typedData.permit) } },
    });
    expect(broke.status).toBe(402);
    expect(broke.body.error.code).toBe("insufficient_balance");
    expect(ctx.chain.sent.filter((t) => t.fn === "subscribe")).toHaveLength(0);
  });
});

describe("subscription lifecycle (2-minute plan)", () => {
  it("subscribe → renew → past due when emptied → retry in grace → canceled for nonpayment, with every webhook", async () => {
    const s = await subscribed();
    expect(s.submit.status).toBe(202);
    expect(s.chain.sent.at(-1)!.fn).toBe("subscribe");

    // first charge happened inside subscribe; the session completes
    const status = (await s.call("GET", `/public/sessions/${s.sessionId}/status`)).body;
    expect(status).toMatchObject({ status: "complete", subscriptionId: s.sub().id, paymentId: apiPaymentId(subscriptionPaymentId(1n, 0)) });
    expect(s.sub()).toMatchObject({ status: "active", cycle: 0, reference: "box_42", sessionId: s.sessionId });

    await s.indexer.tick();
    expect(s.webhooks().map((w) => w.type)).toEqual(["subscription.created", "payment.succeeded", "checkout.session.completed"]);

    // not due yet: keeper sends nothing
    await s.round();
    expect(s.chain.sent.filter((t) => t.fn === "charge")).toHaveLength(0);

    // period passes → renewed
    s.chain.advance(120);
    await s.round();
    expect(s.sub()).toMatchObject({ status: "active", cycle: 1, failedAttempts: 0 });
    expect(s.webhooks().slice(3).map((w) => w.type)).toEqual(["subscription.renewed", "payment.succeeded"]);
    const renewed = s.webhooks()[3]!;
    if (renewed.type !== "subscription.renewed") throw new Error();
    expect(renewed.data).toMatchObject({ cycle: 1, amount: "15.00", merchantReference: "box_42", paymentId: apiPaymentId(subscriptionPaymentId(1n, 1)) });

    // wallet emptied → next charge fails → past due (tx still succeeds)
    s.chain.balances[s.who.address.toLowerCase()] = 0n;
    s.chain.advance(120);
    await s.round();
    expect(s.sub()).toMatchObject({ status: "past_due", failedAttempts: 1 });
    expect(s.sub().pastDueSince).toBe(s.chain.time);
    const failed = s.webhooks().at(-1)!;
    expect(failed.type).toBe("subscription.payment_failed");
    if (failed.type === "subscription.payment_failed") expect(failed.data.attemptedCycle).toBe(2);

    // retried at most every 30s
    s.chain.advance(10);
    await s.round();
    expect(s.sub().failedAttempts).toBe(1);
    s.chain.advance(20);
    await s.round();
    expect(s.sub()).toMatchObject({ status: "past_due", failedAttempts: 2 });

    // grace (60s) over → canceled for nonpayment
    s.chain.advance(30);
    await s.round();
    expect(s.sub()).toMatchObject({ status: "canceled", cancelReason: "nonpayment" });
    expect(s.webhooks().at(-1)!.type).toBe("subscription.canceled");

    const list = await s.call("GET", "/v1/subscriptions?status=canceled", { token: s.merchant.secretKey });
    const [only] = list.body.data.map((x: unknown) => Subscription.parse(x));
    expect(only).toMatchObject({ status: "canceled", cancelReason: "nonpayment", nextChargeAt: null, planName: "Builder Box" });

    // canceled subscriptions are never charged again
    s.chain.advance(300);
    const before = s.chain.sent.length;
    await s.round();
    expect(s.chain.sent.length).toBe(before);
  });

  it("topping up during grace brings it back to active", async () => {
    const s = await subscribed();
    await s.indexer.tick();
    s.chain.balances[s.who.address.toLowerCase()] = 0n;
    s.chain.advance(120);
    await s.round();
    expect(s.sub().status).toBe("past_due");

    s.chain.balances[s.who.address.toLowerCase()] = 50_000_000n;
    s.chain.advance(30);
    await s.round();
    expect(s.sub()).toMatchObject({ status: "active", cycle: 1, failedAttempts: 0, pastDueSince: null });
  });

  it("resyncs from chain when the keeper's copy is stale (NotDue)", async () => {
    const s = await subscribed();
    s.deps.db.update(subscriptions).set({ nextChargeAt: 1 }).where(eq(subscriptions.id, s.sub().id)).run();
    await s.round();
    expect(s.chain.sent.filter((t) => t.fn === "charge")).toHaveLength(0);
    expect(s.sub().nextChargeAt).toBe(Number(s.chain.subs.get(1n)!.nextChargeAt));
  });
});

describe("cancel", () => {
  it("merchant cancel via /v1 (operator cancelByMerchant)", async () => {
    const s = await subscribed();
    const res = await s.call("POST", `/v1/subscriptions/${s.sub().id}/cancel`, { token: s.merchant.secretKey });
    expect(res.status).toBe(200);
    expect(Subscription.parse(res.body)).toMatchObject({ status: "canceled", cancelReason: "merchant" });
    expect(s.chain.sent.at(-1)!.fn).toBe("cancelByMerchant");

    await s.indexer.tick();
    expect(s.webhooks().at(-1)!.type).toBe("subscription.canceled");
    expect((await s.call("POST", `/v1/subscriptions/${s.sub().id}/cancel`, { token: s.merchant.secretKey })).status).toBe(409);
  });

  it("customer cancel from the portal with a CancelSubscription signature", async () => {
    const s = await subscribed();
    const nonce = (await s.call("GET", `/auth/nonce?address=${s.who.address}`)).body;
    const login = await s.call("POST", "/auth/verify", {
      body: { address: s.who.address, signature: await s.who.signMessage({ message: nonce.message }), role: "customer" },
    });
    const token = login.body.token;
    const id = s.sub().id;

    const prep = await s.call("POST", `/public/portal/subscriptions/${id}/cancel/prepare`, { token });
    expect(prep.status).toBe(200);
    expect(prep.body.typedData.primaryType).toBe("CancelSubscription");
    expect(prep.body.typedData.message).toMatchObject({ subId: "1", nonce: "1" }); // subscribe used nonce 0

    const signature = await s.who.signTypedData(prep.body.typedData);
    const done = await s.call("POST", `/public/portal/subscriptions/${id}/cancel/submit`, { body: { signature }, token });
    expect(done.status).toBe(200);
    expect(done.body.subscription).toMatchObject({ status: "canceled", cancelReason: "customer", merchantName: "Swag Counter" });
    expect(s.chain.sent.at(-1)!.fn).toBe("cancel");
  });

  it("portal only shows the subscriber their own subscription", async () => {
    const s = await subscribed();
    const stranger = privateKeyToAccount(generatePrivateKey());
    const nonce = (await s.call("GET", `/auth/nonce?address=${stranger.address}`)).body;
    const login = await s.call("POST", "/auth/verify", {
      body: { address: stranger.address, signature: await stranger.signMessage({ message: nonce.message }), role: "customer" },
    });
    const res = await s.call("POST", `/public/portal/subscriptions/${s.sub().id}/cancel/prepare`, { token: login.body.token });
    expect(res.status).toBe(404);
    expect((await s.call("POST", `/public/portal/subscriptions/${s.sub().id}/cancel/prepare`)).status).toBe(401);
  });
});
