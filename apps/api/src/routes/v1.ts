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

/** Merchant API: secret key (SDK) or merchant dashboard JWT. */
export function v1Routes(deps: Deps, dispatcher: Dispatcher) {
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
