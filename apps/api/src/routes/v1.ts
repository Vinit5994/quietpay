import { Hono } from "hono";
import { requireMerchantKey } from "../auth";
import type { AppEnv, Deps } from "../deps";
import { notFound } from "../lib/errors";
import { readBody, send } from "../lib/validate";
import { createCheckoutSession, loadSession, toCheckoutSession } from "../services/sessions";

/** Merchant API: secret key (SDK) or merchant dashboard JWT. */
export function v1Routes(deps: Deps) {
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

  return app;
}
