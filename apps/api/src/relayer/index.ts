import { eq } from "drizzle-orm";
import { formatEther, type Hex } from "viem";
import { RELAY_FUNCTIONS, type RelayFunction, type TxReceipt } from "../chain";
import { merchants, relayerTxs } from "../db/schema";
import type { Deps, MerchantRow } from "../deps";
import { ApiError } from "../lib/errors";
import { newId, nowSeconds } from "../lib/ids";
import { decodeRevert } from "./errors";
import { relayerRateLimits } from "./ratelimit";

export const LOW_BALANCE_WEI = 50_000_000_000_000_000n; // 0.05 WBT
/** Conservative per-call gas used for the budget check (pay ≈ 245k, subscribe ≈ 300k). */
export const GAS_LIMITS: Partial<Record<RelayFunction, bigint>> = {
  pay: 300_000n,
  subscribe: 400_000n,
  charge: 250_000n,
  refund: 250_000n,
  cancel: 120_000n,
};
const DEFAULT_GAS_LIMIT = 300_000n;

type Purpose = (typeof relayerTxs.$inferInsert)["purpose"];

export type RelayRequest = {
  fn: RelayFunction;
  args: readonly unknown[];
  merchant: MerchantRow;
  purpose: Purpose;
  /** Runs after the receipt arrives (success or revert). */
  onReceipt?: (receipt: TxReceipt, txHash: Hex) => void | Promise<void>;
  /** Runs if broadcasting or the receipt wait throws. */
  onError?: (err: ApiError) => void | Promise<void>;
};

/**
 * The only code that sends transactions. Runs relayer checks 7–10 (gas budget, simulate, send, low balance);
 * callers run checks 1–6 first (see services/submit.ts). Sends are serialized on one queue.
 */
export class Relayer {
  readonly limits = relayerRateLimits();
  private queue: Promise<unknown> = Promise.resolve();
  private inFlight = new Set<Promise<unknown>>();

  constructor(private readonly deps: Deps) {}

  /** Resolves when every pending send and receipt handler has finished (tests, graceful shutdown). */
  async idle() {
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight]);
  }

  /** Checks 7–9 synchronously (errors throw); the receipt is handled in the background. Returns the tx hash. */
  async relay(req: RelayRequest): Promise<Hex> {
    const { deps } = this;
    // 1. allowed target + function (the chain client only ever calls QuietPay)
    if (!(RELAY_FUNCTIONS as readonly string[]).includes(req.fn)) {
      throw new ApiError(400, "bad_request", `Relayer refuses to call ${req.fn}.`);
    }

    // 7. merchant gas budget
    const gasPrice = await deps.chain.gasPrice();
    const estimate = (GAS_LIMITS[req.fn] ?? DEFAULT_GAS_LIMIT) * gasPrice;
    const fresh = deps.db.select().from(merchants).where(eq(merchants.id, req.merchant.id)).get() ?? req.merchant;
    const remaining = BigInt(fresh.gasBudgetWei) - BigInt(fresh.gasSpentWei);
    if (estimate > remaining) {
      throw new ApiError(
        402,
        "merchant_gas_budget_exhausted",
        `This merchant's gas budget is used up (${formatEther(remaining > 0n ? remaining : 0n)} WBT left). The merchant needs to top up.`,
      );
    }

    // 8. simulate; decode the custom error on revert
    try {
      await deps.chain.simulate(req.fn, req.args);
    } catch (err) {
      throw decodeRevert(err);
    }

    // 9. send on one serialized queue
    const rtxId = newId("rtx");
    deps.db
      .insert(relayerTxs)
      .values({ id: rtxId, merchantId: req.merchant.id, purpose: req.purpose, status: "pending", createdAt: nowSeconds() })
      .run();

    const sent = this.queue.then(() => deps.chain.send(req.fn, req.args));
    this.queue = sent.catch(() => undefined);
    let txHash: Hex;
    try {
      txHash = await sent;
    } catch (err) {
      const e = decodeRevert(err);
      deps.db.update(relayerTxs).set({ status: "failed", error: e.message }).where(eq(relayerTxs.id, rtxId)).run();
      throw new ApiError(500, "transaction_failed", `Could not send the transaction: ${e.message}`);
    }
    deps.db.update(relayerTxs).set({ txHash }).where(eq(relayerTxs.id, rtxId)).run();
    console.log(`[relayer] ${req.purpose} ${req.fn} sent ${txHash}`);

    const tracked = this.finish(req, rtxId, txHash);
    this.inFlight.add(tracked);
    void tracked.finally(() => this.inFlight.delete(tracked));
    return txHash;
  }

  /**
   * Relays and waits for the receipt (operator calls the API needs the result of, e.g. createPlan's planId).
   * Rejects if the tx reverts on-chain.
   */
  async relayAndWait(req: Omit<RelayRequest, "onReceipt" | "onError">): Promise<{ txHash: Hex; receipt: TxReceipt }> {
    return new Promise((resolve, reject) => {
      this.relay({
        ...req,
        onReceipt: (receipt, txHash) =>
          receipt.status === "success"
            ? resolve({ txHash, receipt })
            : reject(new ApiError(500, "transaction_failed", `Transaction ${txHash} reverted on-chain.`)),
        onError: reject,
      }).catch(reject);
    });
  }

  /** Receipt → relayer_txs + merchant gas_spent_wei → caller hook → 10. low-balance alert. */
  private async finish(req: RelayRequest, rtxId: string, txHash: Hex) {
    const { deps } = this;
    try {
      const receipt = await deps.chain.waitForReceipt(txHash);
      const cost = receipt.gasUsed * receipt.effectiveGasPrice;
      deps.db
        .update(relayerTxs)
        .set({
          status: receipt.status === "success" ? "succeeded" : "failed",
          gasUsed: receipt.gasUsed.toString(),
          gasCostWei: cost.toString(),
          error: receipt.status === "success" ? null : "reverted on-chain",
        })
        .where(eq(relayerTxs.id, rtxId))
        .run();
      // better-sqlite3 is synchronous, so this read-modify-write can't interleave with another one.
      const m = deps.db.select().from(merchants).where(eq(merchants.id, req.merchant.id)).get();
      if (m) {
        const spent = (BigInt(m.gasSpentWei) + cost).toString();
        deps.db.update(merchants).set({ gasSpentWei: spent }).where(eq(merchants.id, m.id)).run();
      }
      await req.onReceipt?.(receipt, txHash);
    } catch (err) {
      console.error(`[relayer] receipt for ${txHash} failed`, err);
      deps.db.update(relayerTxs).set({ status: "failed", error: String(err) }).where(eq(relayerTxs.id, rtxId)).run();
      await req.onError?.(new ApiError(500, "transaction_failed", "The network did not confirm the transaction."));
    }

    try {
      const balance = await deps.chain.relayerBalance();
      if (balance < LOW_BALANCE_WEI) {
        console.warn(`[relayer] LOW BALANCE: ${formatEther(balance)} WBT on ${deps.chain.relayerAddress}. Claim from the faucet.`);
      }
    } catch {
      // balance check is best-effort
    }
  }
}
