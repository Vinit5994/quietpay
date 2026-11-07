import { eq } from "drizzle-orm";
import { formatEther, type Hex } from "viem";
import { RELAY_FUNCTIONS, type RelayFunction, type TxReceipt } from "../chain";
import { merchants, relayerTxs } from "../db/schema";
import type { Deps, MerchantRow } from "../deps";
import { ApiError } from "../lib/errors";
import { newId, nowSeconds } from "../lib/ids";
import { decodeRevert } from "./errors";
import { relayerRateLimits } from "./ratelimit";
import { fundedGasWei, reservedGasWei } from "../services/gas";

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
  /** Runs on a definite application failure. */
  onError?: (err: ApiError) => void | Promise<void>;
  /** Receipt status is unknown: keep the application action pending and retain reserved gas. */
  onPending?: (err: ApiError) => void | Promise<void>;
};

/**
 * The only code that sends transactions. Runs relayer checks 7–10 (gas budget, simulate, send, low balance);
 * callers run checks 1–6 first (see services/submit.ts). Sends are serialized on one queue.
 */
export class Relayer {
  readonly limits = relayerRateLimits();
  private queue: Promise<unknown> = Promise.resolve();
  private inFlight = new Set<Promise<unknown>>();
  private watching = new Set<string>();
  private receiptRequests = new Map<string, RelayRequest>();

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
    const gas = GAS_LIMITS[req.fn] ?? DEFAULT_GAS_LIMIT;
    const estimate = gas * gasPrice;
    const fresh = deps.db.select().from(merchants).where(eq(merchants.id, req.merchant.id)).get();
    if (!fresh) throw new ApiError(404, "not_found", "Merchant not found.");
    const remaining = fundedGasWei(deps, fresh.id) - BigInt(fresh.gasSpentWei) - reservedGasWei(deps, fresh.id);
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
    const sent = this.queue.then(async () => {
      const balance = await deps.chain.relayerBalance();
      deps.db.transaction(() => {
        const merchant = deps.db.select().from(merchants).where(eq(merchants.id, req.merchant.id)).get()!;
        const available = fundedGasWei(deps, merchant.id) - BigInt(merchant.gasSpentWei) - reservedGasWei(deps, merchant.id);
        if (available < estimate) throw new ApiError(402, "merchant_gas_budget_exhausted", "This business needs to top up its gas balance before sending another transaction.");
        if (balance - reservedGasWei(deps) < estimate) throw new ApiError(402, "merchant_gas_budget_exhausted", "The relayer needs refuelling before it can send another transaction. Contact the platform admin.");
        deps.db.insert(relayerTxs).values({ id: rtxId, merchantId: merchant.id, purpose: req.purpose, status: "pending", gasCostWei: estimate.toString(), createdAt: nowSeconds() }).run();
      }, { behavior: "immediate" });
      // Fixed gas and gas price cap the possible fee at this business's reservation.
      return deps.chain.send(req.fn, req.args, { gas, gasPrice });
    });
    this.queue = sent.catch(() => undefined);
    let txHash: Hex;
    try {
      txHash = await sent;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const e = decodeRevert(err);
      // A transport error can occur after acceptance. Keep its reservation until reconciled.
      deps.db.update(relayerTxs).set({ error: `Broadcast uncertain: ${e.message}` }).where(eq(relayerTxs.id, rtxId)).run();
      throw new ApiError(500, "transaction_failed", `Could not send the transaction: ${e.message}`);
    }
    deps.db.update(relayerTxs).set({ txHash }).where(eq(relayerTxs.id, rtxId)).run();
    console.log(`[relayer] ${req.purpose} ${req.fn} sent ${txHash}`);

    this.receiptRequests.set(rtxId, req);
    const tracked = this.finish(req, rtxId, txHash);
    this.inFlight.add(tracked);
    void tracked.finally(() => this.inFlight.delete(tracked));
    return txHash;
  }

  /** Retry receipt accounting after timeouts or process restarts; reservations survive in SQLite. */
  async recoverPending() {
    const pending = this.deps.db.select().from(relayerTxs).where(eq(relayerTxs.status, "pending")).all();
    await Promise.all(pending.filter((tx) => tx.txHash && tx.merchantId && !this.watching.has(tx.id)).map(async (tx) => {
      const merchant = this.deps.db.select().from(merchants).where(eq(merchants.id, tx.merchantId!)).get();
      if (!merchant) return;
      const req = this.receiptRequests.get(tx.id) ?? { merchant, fn: "pay" as const, args: [], purpose: tx.purpose };
      await this.finish(req, tx.id, tx.txHash as Hex);
    }));
  }

  /**
   * Relays and waits for the receipt (operator calls the API needs the result of, e.g. createPlan's planId).
   * Rejects if the tx reverts on-chain.
   */
  async relayAndWait(req: Omit<RelayRequest, "onReceipt" | "onError" | "onPending">): Promise<{ txHash: Hex; receipt: TxReceipt }> {
    return new Promise((resolve, reject) => {
      this.relay({
        ...req,
        onReceipt: (receipt, txHash) =>
          receipt.status === "success"
            ? resolve({ txHash, receipt })
            : reject(new ApiError(500, "transaction_failed", `Transaction ${txHash} reverted on-chain.`)),
        onError: reject,
        onPending: reject,
      }).catch(reject);
    });
  }

  /** Receipt → relayer_txs + merchant gas_spent_wei → caller hook → 10. low-balance alert. */
  private async finish(req: RelayRequest, rtxId: string, txHash: Hex) {
    const { deps } = this;
    if (this.watching.has(rtxId)) return;
    this.watching.add(rtxId);
    try {
      const receipt = await deps.chain.waitForReceipt(txHash);
      const cost = receipt.gasUsed * receipt.effectiveGasPrice;
      const settled = deps.db.transaction(() => {
        const pending = deps.db.select().from(relayerTxs).where(eq(relayerTxs.id, rtxId)).get();
        if (pending?.status !== "pending") return false;
        deps.db.update(relayerTxs).set({
          status: receipt.status === "success" ? "succeeded" : "failed",
          gasUsed: receipt.gasUsed.toString(), gasCostWei: cost.toString(),
          error: receipt.status === "success" ? null : "reverted on-chain",
        }).where(eq(relayerTxs.id, rtxId)).run();
        const m = deps.db.select().from(merchants).where(eq(merchants.id, req.merchant.id)).get();
        if (m) deps.db.update(merchants).set({ gasSpentWei: (BigInt(m.gasSpentWei) + cost).toString() }).where(eq(merchants.id, m.id)).run();
        return true;
      }, { behavior: "immediate" });
      this.receiptRequests.delete(rtxId);
      if (settled) await req.onReceipt?.(receipt, txHash);
    } catch (err) {
      console.error(`[relayer] receipt for ${txHash} failed`, err);
      // Do not free budget for a transaction whose final status is still unknown.
      deps.db.update(relayerTxs).set({ error: String(err) }).where(eq(relayerTxs.id, rtxId)).run();
      await req.onPending?.(new ApiError(500, "transaction_failed", "The network has not confirmed the transaction yet. Its gas remains reserved."));
    } finally {
      this.watching.delete(rtxId);
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
