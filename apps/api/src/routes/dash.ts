import { Hono, type MiddlewareHandler } from "hono";
import { eq } from "drizzle-orm";
import type { Hex } from "viem";
import { requireJwt } from "../auth";
import { merchants } from "../db/schema";
import type { AppEnv, Deps } from "../deps";
import { ApiError } from "../lib/errors";
import { readBody, send } from "../lib/validate";
import type { Relayer } from "../relayer";
import { refundTypedData, submitRefund } from "../services/refunds";
import { gasSummary, gasTopup, onboardMerchant, overview, rotateKey, toMerchant } from "../services/dash";
import { listPayments } from "../services/payments";
import { listSubscriptions, toSubscription } from "../services/subscriptions";
import { toWebhookDelivery } from "../webhooks";
import { readQuery } from "../lib/validate";
import { desc } from "drizzle-orm";
import { webhookDeliveries } from "../db/schema";

/** Merchant dashboard JWT that has finished onboarding → sets `merchant`. */
const requireDashMerchant =
  (deps: Deps): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const mid = c.get("jwt").mid;
    const merchant = mid ? deps.db.select().from(merchants).where(eq(merchants.id, mid)).get() : undefined;
    if (!merchant) throw new ApiError(403, "forbidden", "Finish merchant onboarding first.");
    c.set("merchant", merchant);
    await next();
  };

/** Dashboard routes (merchant JWT). Everything except onboarding needs a finished merchant account. */
export function dashRoutes(deps: Deps, relayer: Relayer) {
  const app = new Hono<AppEnv>();
  app.use("*", requireJwt(deps, "merchant"));

  // onboarding: the only route for a wallet that has no merchant yet
  app.post("/merchant", async (c) => {
    const body = await readBody(c, "dashOnboard");
    return send(c, "dashOnboard", await onboardMerchant(deps, c.get("jwt"), body));
  });

  app.use("*", requireDashMerchant(deps));

  app.get("/merchant", (c) => send(c, "dashGetMerchant", toMerchant(c.get("merchant"))));
  app.get("/overview", (c) => send(c, "dashOverview", overview(deps, c.get("merchant"))));
  app.get("/payments", (c) => send(c, "dashPayments", listPayments(deps, c.get("merchant").id, readQuery(c, "dashPayments"))));
  app.get("/subscriptions", (c) => {
    const { status } = readQuery(c, "dashSubscriptions");
    const rows = listSubscriptions(deps, c.get("merchant").id, status);
    return send(c, "dashSubscriptions", { data: rows.map((r) => toSubscription(deps, r)), nextCursor: null });
  });
  app.get("/webhooks/deliveries", (c) => {
    const { limit } = readQuery(c, "dashWebhookDeliveries");
    const rows = deps.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.merchantId, c.get("merchant").id))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit ?? 50)
      .all();
    return send(c, "dashWebhookDeliveries", { data: rows.map(toWebhookDelivery), nextCursor: null });
  });
  app.post("/keys/rotate", (c) => send(c, "dashRotateKey", rotateKey(deps, c.get("merchant"))));
  app.post("/gas/topup", async (c) => {
    const { txHash } = await readBody(c, "dashGasTopup");
    return send(c, "dashGasTopup", await gasTopup(deps, c.get("merchant"), txHash as Hex));
  });
  app.get("/gas", (c) => send(c, "dashGas", { relayerAddress: deps.chain.relayerAddress, gas: gasSummary(deps, c.get("merchant")) }));

  app.post("/refunds/:id/typed-data", async (c) =>
    send(c, "dashRefundTypedData", await refundTypedData(deps, c.get("merchant"), c.req.param("id"))),
  );

  app.post("/refunds/:id/submit", async (c) => {
    const { signature } = await readBody(c, "dashRefundSubmit");
    return send(c, "dashRefundSubmit", await submitRefund(deps, relayer, c.get("merchant"), c.req.param("id"), signature as Hex));
  });

  return app;
}
