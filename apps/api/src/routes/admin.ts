import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { formatEther, type Hex } from "viem";
import { requireJwt } from "../auth";
import { merchants } from "../db/schema";
import type { AppEnv, Deps } from "../deps";
import { ApiError } from "../lib/errors";
import { readBody, send } from "../lib/validate";
import { gasSummary, gasTopup, toMerchant } from "../services/dash";

export function adminRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.use("*", requireJwt(deps, "merchant"));
  app.use("*", async (c, next) => {
    const owner = await deps.chain.contractOwner();
    if (owner.toLowerCase() !== c.get("jwt").sub.toLowerCase()) {
      throw new ApiError(403, "forbidden", "Only the current contract owner can manage relayer funding.");
    }
    await next();
  });
  app.get("/gas", async (c) => {
    const balance = await deps.chain.relayerBalance();
    return send(c, "adminGas", {
      relayerAddress: deps.chain.relayerAddress,
      balanceWei: balance.toString(), balance: formatEther(balance),
      merchants: deps.db.select().from(merchants).all().map((merchant) => ({ merchant: toMerchant(merchant), gas: gasSummary(deps, merchant) })),
    });
  });
  app.post("/gas/topup", async (c) => {
    const { merchantId, txHash } = await readBody(c, "adminGasTopup");
    const merchant = deps.db.select().from(merchants).where(eq(merchants.id, merchantId)).get();
    if (!merchant) throw new ApiError(404, "not_found", "Merchant not found.");
    return send(c, "adminGasTopup", await gasTopup(deps, merchant, txHash as Hex, c.get("jwt").sub));
  });
  return app;
}
