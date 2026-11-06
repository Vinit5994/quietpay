import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { QuietPay as QuietPayClient } from "@quietpay/node";
import { WEBHOOK_SIGNATURE_HEADER, WebhookDelivery, WebhookEvent, checkoutPaymentId } from "@quietpay/shared";
import { chainEvents, checkoutSessions, indexerCursor, payments, webhookDeliveries } from "../src/db/schema";
import { Indexer, MAX_BLOCK_RANGE } from "../src/indexer";
import { MAX_ATTEMPTS } from "../src/webhooks";
import { hoodieSession, setup } from "./helpers";

const payer = privateKeyToAccount(generatePrivateKey());

/** Pays a session end to end through the API (prepare → sign → submit) and waits for the relayer. */
async function paidSession(ctx = setup()) {
  ctx.chain.balances[payer.address.toLowerCase()] = 100_000_000n;
  const { body } = await ctx.call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: ctx.merchant.secretKey });
  const prep = await ctx.call("POST", `/public/sessions/${body.id}/prepare`, { body: { payer: payer.address } });
  const sig = await payer.signTypedData(prep.body.typedData.payment);
  await ctx.call("POST", `/public/sessions/${body.id}/submit`, { body: { payer: payer.address, signatures: { payment: sig } } });
  await ctx.relayer.idle();
  return { ...ctx, sessionId: body.id as string, indexer: new Indexer(ctx.deps, 90n) };
}

const verifier = new QuietPayClient("sk_test_unused");

describe("indexer", () => {
  it("turns PaymentReceived into payment.succeeded + checkout.session.completed", async () => {
    const ctx = await paidSession();
    await ctx.indexer.tick();

    const types = ctx.deps.db.select().from(webhookDeliveries).all().map((d) => d.type);
    expect(types).toEqual(["payment.succeeded", "checkout.session.completed"]);
    expect(ctx.indexer.lastBlock()).toBe(ctx.chain.head);
    expect(ctx.deps.db.select().from(chainEvents).all()[0]!.processedAt).not.toBeNull();
  });

  it("is idempotent: re-reading the same blocks adds nothing", async () => {
    const ctx = await paidSession();
    await ctx.indexer.tick();
    ctx.deps.db.update(indexerCursor).set({ lastBlock: "90" }).run(); // rewind
    await ctx.indexer.tick();
    await new Indexer(ctx.deps, 90n).tick();

    expect(ctx.deps.db.select().from(chainEvents).all()).toHaveLength(1);
    expect(ctx.deps.db.select().from(payments).all()).toHaveLength(1);
    expect(ctx.deps.db.select().from(webhookDeliveries).all()).toHaveLength(2);
  });

  it("completes the session even if the relayer never saw the receipt", async () => {
    const ctx = await paidSession();
    // simulate an API restart between broadcast and receipt
    ctx.deps.db.update(checkoutSessions).set({ status: "processing", paymentId: null }).where(eq(checkoutSessions.id, ctx.sessionId)).run();
    ctx.deps.db.delete(payments).run();
    await ctx.indexer.tick();
    const s = ctx.deps.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, ctx.sessionId)).get()!;
    expect(s.status).toBe("complete");
    expect(ctx.deps.db.select().from(payments).all()).toHaveLength(1);
  });

  it("ignores events for merchants this instance doesn't know (the other teammate's API)", async () => {
    const ctx = setup();
    ctx.chain.events.push({
      eventName: "PaymentReceived",
      args: { paymentId: checkoutPaymentId(999n, `0x${"ab".repeat(32)}`), merchantId: 999n, ref: `0x${"ab".repeat(32)}`, payer: payer.address, amount: 1_000_000n, fee: 0n, kind: 0, subId: 0n },
      blockNumber: 95n,
      transactionHash: `0x${"cd".repeat(32)}`,
      logIndex: 0,
    });
    await new Indexer(ctx.deps, 90n).tick();
    expect(ctx.deps.db.select().from(chainEvents).all()[0]!.processedAt).not.toBeNull();
    expect(ctx.deps.db.select().from(payments).all()).toHaveLength(0);
    expect(ctx.deps.db.select().from(webhookDeliveries).all()).toHaveLength(0);
  });

  it("reads at most 2,000 blocks per call and catches up in one tick", async () => {
    const ctx = setup();
    ctx.chain.head = 5_000n;
    const calls: [bigint, bigint][] = [];
    const orig = ctx.chain.quietPayLogs;
    ctx.chain.quietPayLogs = async (f, t) => (calls.push([f, t]), orig(f, t));
    const indexer = new Indexer(ctx.deps, 1_000n);
    await indexer.tick();
    await indexer.tick(); // already caught up: no new window
    expect(calls).toEqual([
      [1_000n, 2_999n],
      [3_000n, 4_999n],
      [5_000n, 5_000n],
    ]);
    expect(calls.every(([f, t]) => t - f + 1n <= MAX_BLOCK_RANGE)).toBe(true);
  });
});

describe("webhook dispatcher", () => {
  it("delivers signed events the SDK verifies", async () => {
    const ctx = await paidSession();
    await ctx.indexer.tick();
    await ctx.dispatcher.tick();

    expect(ctx.webhook.calls).toHaveLength(2);
    const [first] = ctx.webhook.calls;
    expect(first!.url).toBe("http://store.test/api/webhooks/quietpay");
    const header = first!.headers.get(WEBHOOK_SIGNATURE_HEADER)!;
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

    const event = verifier.webhooks.verify(first!.body, header, ctx.merchant.webhookSecret, { now: ctx.webhook.clock });
    const parsed = WebhookEvent.parse(event);
    if (parsed.type !== "payment.succeeded") throw new Error(parsed.type);
    expect(parsed.data).toMatchObject({
      merchantReference: "ord_1001",
      amount: "37.00",
      fee: "0.00",
      net: "37.00",
      kind: "checkout",
      sessionId: ctx.sessionId,
      payerAddress: payer.address,
    });
    expect(parsed.data.explorerUrl).toBe(`https://explorer.testnet.whitechain.io/tx/${parsed.data.txHash}`);
    expect(ctx.deps.db.select().from(webhookDeliveries).all().every((d) => d.status === "succeeded")).toBe(true);
  });

  it("retries after 1s, 5s, 30s, 2m and gives up after 5 attempts", async () => {
    const ctx = await paidSession();
    await ctx.indexer.tick();
    ctx.deps.db.delete(webhookDeliveries).where(eq(webhookDeliveries.type, "checkout.session.completed")).run();
    ctx.webhook.status = 500;

    const gaps: number[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await ctx.dispatcher.tick();
      const d = ctx.deps.db.select().from(webhookDeliveries).get()!;
      expect(d.attempts).toBe(i + 1);
      expect(d.lastStatusCode).toBe(500);
      if (d.nextAttemptAt) {
        gaps.push(d.nextAttemptAt - ctx.webhook.clock);
        await ctx.dispatcher.tick(); // not due yet: no extra attempt
        expect(ctx.deps.db.select().from(webhookDeliveries).get()!.attempts).toBe(i + 1);
        ctx.webhook.clock = d.nextAttemptAt;
      }
    }
    expect(gaps).toEqual([1, 5, 30, 120]);
    expect(ctx.deps.db.select().from(webhookDeliveries).get()!.status).toBe("failed");
    expect(ctx.webhook.calls).toHaveLength(MAX_ATTEMPTS);
  });

  it("recovers when the endpoint comes back", async () => {
    const ctx = await paidSession();
    await ctx.indexer.tick();
    ctx.webhook.status = 503;
    await ctx.dispatcher.tick();
    ctx.webhook.status = 200;
    ctx.webhook.clock += 1;
    await ctx.dispatcher.tick();
    const rows = ctx.deps.db.select().from(webhookDeliveries).all();
    expect(rows.map((r) => [r.status, r.attempts])).toEqual([
      ["succeeded", 2],
      ["succeeded", 2],
    ]);
  });
});

describe("webhook endpoint API", () => {
  it("PUT sets the URL and rotates the secret; test sends a verifiable ping", async () => {
    const ctx = setup();
    const put = await ctx.call("PUT", "/v1/webhook_endpoint", { body: { url: "http://localhost:3999/hook" }, token: ctx.merchant.secretKey });
    expect(put.status).toBe(200);
    expect(put.body.url).toBe("http://localhost:3999/hook");
    expect(put.body.secret).toMatch(/^whsec_/);
    expect(put.body.secret).not.toBe(ctx.merchant.webhookSecret);

    const test = await ctx.call("POST", "/v1/webhook_endpoint/test", { token: ctx.merchant.secretKey });
    expect(test.status).toBe(200);
    const d = WebhookDelivery.parse(test.body);
    expect(d).toMatchObject({ type: "ping", status: "succeeded", attempts: 1, lastStatusCode: 200, url: "http://localhost:3999/hook" });

    const call = ctx.webhook.calls[0]!;
    const event = verifier.webhooks.verify(call.body, call.headers.get(WEBHOOK_SIGNATURE_HEADER), put.body.secret, { now: ctx.webhook.clock });
    expect(event.type).toBe("ping");
  });

  it("requires the merchant key", async () => {
    const ctx = setup();
    expect((await ctx.call("PUT", "/v1/webhook_endpoint", { body: { url: "http://x.test" } })).status).toBe(401);
  });
});
