import { Hono } from "hono";
import { requireMerchantKey } from "../auth";
import type { AppEnv, Deps } from "../deps";
import { badRequest, notFound } from "../lib/errors";
import { readBody, send } from "../lib/validate";
import { eq } from "drizzle-orm";
import { merchants } from "../db/schema";
import { newWebhookSecret } from "../lib/crypto";
import { createCheckoutSession, loadSession, toCheckoutSession } from "../services/sessions";
import { enqueueWebhook, toWebhookDelivery, type Dispatcher } from "../webhooks";
import type { Relayer } from "../relayer";
import { readQuery } from "../lib/validate";
import { createPlan, listPlans, toPlan } from "../services/plans";
import { cancelByMerchant, listSubscriptions, loadSubscription, toSubscription } from "../services/subscriptions";
import { createRefund } from "../services/refunds";
import { createPaymentLink, listPaymentLinks, toPaymentLink } from "../services/links";
import { listPayments, paymentsCsv } from "../services/payments";

/** Merchant API: secret key (SDK) or merchant dashboard JWT. */
export function v1Routes(deps: Deps, relayer: Relayer, dispatcher: Dispatcher) {
  const app = new Hono<AppEnv>();
  app.use("*", requireMerchantKey(deps));

  app.post("/checkout/sessions", async (c) => {
    const body = await readBody(c, "createCheckoutSession");
    const row = await createCheckoutSession(deps, c.get("merchant"), body);
    return send(c, "createCheckoutSession", toCheckoutSession(deps, row));
  });

  app.get("/checkout/sessions/:id", (c) => {
    const { row } = loadSession(deps, c.req.param("id"));
    if (row.merchantId !== c.get("merchant").id) throw notFound("Checkout session");
    return send(c, "getCheckoutSession", toCheckoutSession(deps, row));
  });

  // ---- plans (on-chain createPlan through the relayer)
  app.post("/plans", async (c) => {
    const body = await readBody(c, "createPlan");
    return send(c, "createPlan", toPlan(await createPlan(deps, relayer, c.get("merchant"), body)));
  });

  app.get("/plans", (c) => {
    readQuery(c, "listPlans");
    return send(c, "listPlans", { data: listPlans(deps, c.get("merchant").id).map(toPlan), nextCursor: null });
  });

  // ---- subscriptions
  app.get("/subscriptions", (c) => {
    const { status } = readQuery(c, "listSubscriptions");
    const rows = listSubscriptions(deps, c.get("merchant").id, status);
    return send(c, "listSubscriptions", { data: rows.map((r) => toSubscription(deps, r)), nextCursor: null });
  });

  app.post("/subscriptions/:id/cancel", async (c) => {
    const sub = loadSubscription(deps, c.get("merchant").id, c.req.param("id"));
    return send(c, "cancelSubscription", toSubscription(deps, await cancelByMerchant(deps, relayer, c.get("merchant"), sub)));
  });

  // ---- payment links
  app.post("/payment_links", async (c) => {
    const body = await readBody(c, "createPaymentLink");
    return send(c, "createPaymentLink", await createPaymentLink(deps, c.get("merchant"), body));
  });

  app.get("/payment_links", (c) => {
    readQuery(c, "listPaymentLinks");
    return send(c, "listPaymentLinks", { data: listPaymentLinks(deps, c.get("merchant").id).map((l) => toPaymentLink(deps, l)), nextCursor: null });
  });

  // ---- payments + CSV export
  app.get("/payments", (c) => send(c, "listPayments", listPayments(deps, c.get("merchant").id, readQuery(c, "listPayments"))));

  app.get("/exports/payments.csv", (c) => {
    const csv = paymentsCsv(deps, c.get("merchant").id);
    return c.body(csv, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="quietpay-payments-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
  });

  // ---- refunds: created here, signed by the payout wallet in the dashboard (/dash/refunds/:id/*)
  app.post("/refunds", async (c) => {
    const body = await readBody(c, "createRefund");
    return send(c, "createRefund", createRefund(deps, c.get("merchant"), body));
  });

  /** Sets the webhook URL and returns a fresh signing secret (shown once; it rotates on every PUT). */
  app.put("/webhook_endpoint", async (c) => {
    const { url } = await readBody(c, "updateWebhookEndpoint");
    const secret = newWebhookSecret();
    deps.db.update(merchants).set({ webhookUrl: url, webhookSecret: secret }).where(eq(merchants.id, c.get("merchant").id)).run();
    return send(c, "updateWebhookEndpoint", { url, secret });
  });

  /** Sends a `ping` right away and returns the delivery (retries continue in the background if it failed). */
  app.post("/webhook_endpoint/test", async (c) => {
    const merchant = deps.db.select().from(merchants).where(eq(merchants.id, c.get("merchant").id)).get()!;
    const row = enqueueWebhook(deps, merchant, "ping", {
      merchantReference: null,
      txHash: null,
      explorerUrl: null,
      message: `Hello from QuietPay, ${merchant.name}!`,
    });
    if (!row) throw badRequest("Set a webhook URL first (PUT /v1/webhook_endpoint).");
    return send(c, "testWebhookEndpoint", toWebhookDelivery(await dispatcher.attempt(row)));
  });

  return app;
}
