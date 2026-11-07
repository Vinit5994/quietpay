import { and, eq } from "drizzle-orm";
import { gasTopups, relayerTxs } from "../db/schema";
import type { Deps } from "../deps";

/** Verified transfers are the source of truth, never the legacy demo budget. */
export function fundedGasWei(deps: Deps, merchantId: string): bigint {
  return deps.db.select().from(gasTopups).where(eq(gasTopups.merchantId, merchantId)).all()
    .reduce((sum, deposit) => sum + BigInt(deposit.valueWei), 0n);
}

/** Pending gasCostWei is the maximum reserved fee; a receipt replaces it with the actual cost. */
export function reservedGasWei(deps: Deps, merchantId?: string): bigint {
  return deps.db.select().from(relayerTxs).where(
    merchantId ? and(eq(relayerTxs.status, "pending"), eq(relayerTxs.merchantId, merchantId)) : eq(relayerTxs.status, "pending"),
  ).all().reduce((sum, tx) => sum + BigInt(tx.gasCostWei ?? "0"), 0n);
}
