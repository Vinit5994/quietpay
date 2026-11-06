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

/** Dashboard routes (merchant JWT). A10: refund signing. More arrive with A11. */
export function dashRoutes(deps: Deps, relayer: Relayer) {
  const app = new Hono<AppEnv>();
  app.use("*", requireJwt(deps, "merchant"));
  app.use("/refunds/*", requireDashMerchant(deps));

  app.post("/refunds/:id/typed-data", async (c) =>
    send(c, "dashRefundTypedData", await refundTypedData(deps, c.get("merchant"), c.req.param("id"))),
  );

  app.post("/refunds/:id/submit", async (c) => {
    const { signature } = await readBody(c, "dashRefundSubmit");
    return send(c, "dashRefundSubmit", await submitRefund(deps, relayer, c.get("merchant"), c.req.param("id"), signature as Hex));
  });

  return app;
}
