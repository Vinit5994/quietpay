import { and, eq, isNull, sql } from "drizzle-orm";
import { type Hex } from "viem";
import { QUIETPAY_DEPLOY_BLOCK, apiPaymentId, explorerTx, fromUnits } from "@quietpay/shared";
import type { ChainEvent } from "../chain";
import { chainEvents, checkoutSessions, indexerCursor, merchants } from "../db/schema";
import type { Deps, MerchantRow } from "../deps";
import { isoFromSeconds, nowSeconds } from "../lib/ids";
import { recordCheckoutPayment } from "../services/payments";
import { enqueueWebhook } from "../webhooks";

export const MAX_BLOCK_RANGE = 2_000n;
export const MAX_WINDOWS_PER_TICK = 25;

const toJson = (args: Record<string, unknown>) =>
  JSON.stringify(args, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

/**
 * Polls QuietPay logs (SPEC_API "Indexer"): stores them idempotently in chain_events (id = txHash:logIndex),
 * then processes unprocessed events in chain order. Events for merchants this instance doesn't know are skipped,
 * so two teammates' APIs can share one contract.
 */
export class Indexer {
  private running = false;

  constructor(
    private readonly deps: Deps,
    private readonly startBlock: bigint = QUIETPAY_DEPLOY_BLOCK ?? 0n,
  ) {}

  private get cursorKey() {
    return this.deps.chain.quietPay.toLowerCase();
  }

  lastBlock(): bigint | null {
    const row = this.deps.db.select().from(indexerCursor).where(eq(indexerCursor.contract, this.cursorKey)).get();
    return row ? BigInt(row.lastBlock) : null;
  }

  /** Fetch one window of logs (≤ 2,000 blocks), store, advance the cursor, process. */
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const latest = await this.deps.chain.blockNumber();
      // catch up in 2,000-block windows (several per tick when far behind, e.g. after a restart)
      for (let i = 0; i < MAX_WINDOWS_PER_TICK; i++) {
        const from = (this.lastBlock() ?? this.startBlock - 1n) + 1n;
        if (from > latest) break;
        const to = from + MAX_BLOCK_RANGE - 1n < latest ? from + MAX_BLOCK_RANGE - 1n : latest;
        this.store(await this.deps.chain.quietPayLogs(from, to), to);
      }
      this.processPending();
    } finally {
      this.running = false;
    }
  }

  private store(events: ChainEvent[], toBlock: bigint) {
    const { db } = this.deps;
    db.transaction((tx) => {
      for (const e of events) {
        tx.insert(chainEvents)
          .values({
            id: `${e.transactionHash}:${e.logIndex}`,
            name: e.eventName,
            blockNumber: e.blockNumber.toString(),
            argsJson: toJson(e.args),
            processedAt: null,
          })
          .onConflictDoNothing()
          .run();
      }
      tx.insert(indexerCursor)
        .values({ contract: this.cursorKey, lastBlock: toBlock.toString() })
        .onConflictDoUpdate({ target: indexerCursor.contract, set: { lastBlock: toBlock.toString() } })
        .run();
    });
  }

  /** Processes stored events in insertion (= chain) order; each event is handled exactly once. */
  processPending() {
    const { db } = this.deps;
    const pending = db.select().from(chainEvents).where(isNull(chainEvents.processedAt)).orderBy(sql`rowid`).all();
    // block_number is TEXT; stable numeric sort keeps log order inside a block (rowid = insertion = chain order)
    pending.sort((a, b) => (BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 : BigInt(a.blockNumber) > BigInt(b.blockNumber) ? 1 : 0));
    for (const ev of pending) {
      try {
        this.handle(ev.name, JSON.parse(ev.argsJson), ev.id.split(":")[0] as Hex, BigInt(ev.blockNumber));
      } catch (err) {
        console.error(`[indexer] failed to process ${ev.name} ${ev.id}`, err);
        continue; // retried next tick
      }
      db.update(chainEvents).set({ processedAt: nowSeconds() }).where(eq(chainEvents.id, ev.id)).run();
    }
  }

  private merchantByOnchainId(id: string): MerchantRow | undefined {
    return this.deps.db.select().from(merchants).where(eq(merchants.onchainId, id)).get();
  }

  private handle(name: string, args: Record<string, string | number>, txHash: Hex, blockNumber: bigint) {
    switch (name) {
      case "PaymentReceived":
        if (Number(args.kind) === 0) return this.onCheckoutPayment(args, txHash, blockNumber);
        return; // subscription charges: A9
      default:
        return; // MerchantRegistered, PlanCreated, OperatorSet, …: nothing to do; subscriptions/refunds: A9/A10
    }
  }

  /** PaymentReceived kind 0 → payment row, session complete → payment.succeeded + checkout.session.completed. */
  private onCheckoutPayment(args: Record<string, string | number>, txHash: Hex, blockNumber: bigint) {
    const merchant = this.merchantByOnchainId(String(args.merchantId));
    if (!merchant) return; // another instance's merchant

    const session = this.deps.db
      .select()
      .from(checkoutSessions)
      .where(and(eq(checkoutSessions.merchantId, merchant.id), eq(checkoutSessions.orderIdHex, String(args.ref).toLowerCase())))
      .get();
    if (!session) {
      console.warn(`[indexer] PaymentReceived for unknown order ${args.ref} (merchant ${merchant.id}); skipped`);
      return;
    }

    const amount = BigInt(args.amount!);
    const fee = BigInt(args.fee!);
    const paymentId = recordCheckoutPayment(
      this.deps,
      session,
      { paymentId: args.paymentId as Hex, payer: String(args.payer), amount, fee },
      { txHash, blockNumber },
    );
    const common = { merchantReference: session.reference, txHash, explorerUrl: explorerTx(txHash) };

    enqueueWebhook(this.deps, merchant, "payment.succeeded", {
      ...common,
      paymentId,
      kind: "checkout",
      sessionId: session.id,
      subscriptionId: null,
      payerAddress: String(args.payer),
      amount: fromUnits(amount),
      fee: fromUnits(fee),
      net: fromUnits(amount - fee),
      paidAt: isoFromSeconds(nowSeconds()),
    });
    enqueueWebhook(this.deps, merchant, "checkout.session.completed", {
      ...common,
      sessionId: session.id,
      mode: session.mode,
      paymentId: apiPaymentId(args.paymentId as Hex),
      subscriptionId: null,
      payerAddress: String(args.payer),
      amount: fromUnits(amount),
    });
  }
}
