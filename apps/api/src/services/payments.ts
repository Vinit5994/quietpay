import { and, desc, eq, lt, or } from "drizzle-orm";
import { parseEventLogs, type Hex, type Log } from "viem";
import { PAYMENTS_CSV_COLUMNS, apiPaymentId, explorerTx, fromUnits, quietPayAbi, type Payment } from "@quietpay/shared";
import { checkoutSessions, payments, subscriptions } from "../db/schema";
import type { Deps } from "../deps";
import { ApiError } from "../lib/errors";
import { isoFromSeconds, nowSeconds } from "../lib/ids";
import type { SessionRow } from "./sessions";

/**
 * Records a checkout payment from its PaymentReceived log and completes the session.
 * Idempotent: the relayer (on receipt) and the indexer (A8) may both call it for the same payment.
 */
export function recordCheckoutPayment(
  deps: Deps,
  session: SessionRow,
  args: { paymentId: Hex; payer: string; amount: bigint; fee: bigint },
  tx: { txHash: Hex; blockNumber: bigint; paidAt?: number },
) {
  const id = apiPaymentId(args.paymentId);
  deps.db
    .insert(payments)
    .values({
      id,
      onchainPaymentId: args.paymentId.toLowerCase(),
      merchantId: session.merchantId,
      kind: "checkout",
      sessionId: session.id,
      subscriptionId: null,
      reference: session.reference,
      payerAddress: args.payer,
      amountUnits: args.amount.toString(),
      feeUnits: args.fee.toString(),
      refundedUnits: "0",
      txHash: tx.txHash,
      blockNumber: tx.blockNumber.toString(),
      paidAt: tx.paidAt ?? nowSeconds(),
    })
    .onConflictDoNothing()
    .run();
  deps.db
    .update(checkoutSessions)
    .set({ status: "complete", paymentId: id, txHash: tx.txHash, payerAddress: args.payer, lastError: null })
    .where(eq(checkoutSessions.id, session.id))
    .run();
  return id;
}

/** The checkout PaymentReceived (kind 0) for this session's order in a receipt, if any. */
export function findCheckoutPayment(logs: Log[], orderIdHex: string) {
  return parseEventLogs({ abi: quietPayAbi, eventName: "PaymentReceived", logs }).find(
    (l) => l.args.kind === 0 && l.args.ref.toLowerCase() === orderIdHex.toLowerCase(),
  );
}

// ---------------------------------------------------------------- read side: lists, CSV

type PaymentRow = typeof payments.$inferSelect;

export const DEFAULT_PAGE = 20;

export function paymentStatus(row: PaymentRow): Payment["status"] {
  const refunded = BigInt(row.refundedUnits);
  if (refunded === 0n) return "paid";
  return refunded >= BigInt(row.amountUnits) ? "refunded" : "partially_refunded";
}

function customerEmailOf(deps: Deps, row: PaymentRow): string | null {
  if (row.sessionId) {
    const s = deps.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, row.sessionId)).get();
    if (s?.customerEmail) return s.customerEmail;
  }
  if (row.subscriptionId) {
    return deps.db.select().from(subscriptions).where(eq(subscriptions.id, row.subscriptionId)).get()?.customerEmail ?? null;
  }
  return null;
}

export function toPayment(deps: Deps, row: PaymentRow): Payment {
  const amount = BigInt(row.amountUnits);
  const fee = BigInt(row.feeUnits);
  const refunded = BigInt(row.refundedUnits);
  return {
    id: row.id,
    onchainPaymentId: row.onchainPaymentId,
    kind: row.kind,
    status: paymentStatus(row),
    sessionId: row.sessionId,
    subscriptionId: row.subscriptionId,
    reference: row.reference,
    customerEmail: customerEmailOf(deps, row),
    payerAddress: row.payerAddress,
    amount: fromUnits(amount),
    fee: fromUnits(fee),
    refunded: fromUnits(refunded),
    net: fromUnits(amount - fee - refunded),
    refundable: fromUnits(amount - refunded),
    txHash: row.txHash,
    explorerUrl: explorerTx(row.txHash),
    blockNumber: row.blockNumber,
    paidAt: isoFromSeconds(row.paidAt),
  };
}

/** Cursor = base64url("<paidAt>:<id>") of the last row; newest first. */
const encodeCursor = (r: PaymentRow) => Buffer.from(`${r.paidAt}:${r.id}`).toString("base64url");
function decodeCursor(cursor: string): { paidAt: number; id: string } {
  const [paidAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split(":");
  if (!paidAt || !id || !/^\d+$/.test(paidAt)) throw new ApiError(400, "bad_request", "Invalid cursor.");
  return { paidAt: Number(paidAt), id };
}

export function listPayments(
  deps: Deps,
  merchantId: string,
  q: { limit?: number; cursor?: string; reference?: string },
) {
  const limit = q.limit ?? DEFAULT_PAGE;
  const conds = [eq(payments.merchantId, merchantId)];
  if (q.reference) conds.push(eq(payments.reference, q.reference));
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    conds.push(or(lt(payments.paidAt, c.paidAt), and(eq(payments.paidAt, c.paidAt), lt(payments.id, c.id)))!);
  }
  const rows = deps.db
    .select()
    .from(payments)
    .where(and(...conds))
    .orderBy(desc(payments.paidAt), desc(payments.id))
    .limit(limit + 1)
    .all();
  const page = rows.slice(0, limit);
  return {
    data: page.map((r) => toPayment(deps, r)),
    nextCursor: rows.length > limit ? encodeCursor(page.at(-1)!) : null,
  };
}

const csvCell = (v: string | null) => {
  const s = v ?? "";
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** All payments, newest first, columns from PAYMENTS_CSV_COLUMNS. Cells that look like formulas are quoted. */
export function paymentsCsv(deps: Deps, merchantId: string): string {
  const rows = deps.db.select().from(payments).where(eq(payments.merchantId, merchantId)).orderBy(desc(payments.paidAt)).all();
  const lines = rows.map((r) => {
    const p = toPayment(deps, r);
    return [p.paidAt, p.id, p.kind, p.reference, p.payerAddress, p.amount, p.fee, p.refunded, p.net, p.txHash, p.explorerUrl]
      .map(csvCell)
      .join(",");
  });
  return [PAYMENTS_CSV_COLUMNS.join(","), ...lines].join("\n") + "\n";
}
