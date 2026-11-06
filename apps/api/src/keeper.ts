import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { merchants, subscriptions } from "./db/schema";
import type { Deps } from "./deps";
import { ApiError } from "./lib/errors";
import { nowSeconds } from "./lib/ids";
import type { Relayer } from "./relayer";

export const KEEPER_INTERVAL_MS = 10_000;
/** A subscription is attempted at most once per 30s (pending txs, past-due retries). */
export const RETRY_AFTER_SECONDS = 30;
const STATUS = ["None", "Active", "PastDue", "Canceled"] as const;

/**
 * SPEC_API "Keeper": every 10s, charge `active` subscriptions whose next charge is due and retry `past_due`
 * ones. A failed charge doesn't revert on-chain (it records past due / cancels after grace), so the tx succeeds;
 * the indexer turns its events into DB state and webhooks.
 */
export class Keeper {
  private running = false;

  constructor(
    private readonly deps: Deps,
    private readonly relayer: Relayer,
    private readonly now: () => number = nowSeconds,
  ) {}

  dueSubscriptions() {
    const now = this.now();
    const notRecent = or(isNull(subscriptions.lastAttemptAt), lte(subscriptions.lastAttemptAt, now - RETRY_AFTER_SECONDS));
    return this.deps.db
      .select()
      .from(subscriptions)
      .where(
        and(
          inArray(subscriptions.status, ["active", "past_due"]),
          lte(subscriptions.nextChargeAt, now),
          notRecent,
        ),
      )
      .all();
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      for (const sub of this.dueSubscriptions()) {
        const merchant = this.deps.db.select().from(merchants).where(eq(merchants.id, sub.merchantId)).get();
        if (!merchant) continue;
        this.deps.db.update(subscriptions).set({ lastAttemptAt: this.now() }).where(eq(subscriptions.id, sub.id)).run();
        try {
          const txHash = await this.relayer.relay({
            fn: "charge",
            args: [BigInt(sub.onchainSubId)],
            merchant,
            purpose: "charge",
          });
          console.log(`[keeper] charge ${sub.id} (on-chain #${sub.onchainSubId}, ${sub.status}) → ${txHash}`);
        } catch (err) {
          await this.onChargeError(sub.id, BigInt(sub.onchainSubId), err);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** NotDue / NotChargeable mean our copy is stale: resync it from the chain instead of retrying blindly. */
  private async onChargeError(id: string, subId: bigint, err: unknown) {
    const code = err instanceof ApiError ? err.code : "unknown";
    if (code === "not_due" || code === "not_chargeable") {
      const onchain = await this.deps.chain.readSub(subId);
      const status = STATUS[onchain.status];
      this.deps.db
        .update(subscriptions)
        .set({
          nextChargeAt: Number(onchain.nextChargeAt),
          ...(status === "Canceled" ? { status: "canceled" as const } : {}),
        })
        .where(eq(subscriptions.id, id))
        .run();
      return;
    }
    console.warn(`[keeper] charge ${id} not sent: ${err instanceof Error ? err.message : String(err)}`);
  }
}
