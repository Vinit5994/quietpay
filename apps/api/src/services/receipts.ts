import { and, desc, eq } from "drizzle-orm";
import { explorerTx, fromUnits, type PortalResponse, type Receipt } from "@quietpay/shared";
import { checkoutSessions, merchants, payments, refunds, subscriptions } from "../db/schema";
import type { Deps } from "../deps";
import { notFound } from "../lib/errors";
import { isoFromSeconds } from "../lib/ids";
import { paymentStatus, toPayment } from "./payments";
import { planById } from "./plans";
import { toSubscription } from "./subscriptions";

type StoredLineItem = { name: string; unitAmountUnits: string; quantity: number };

const merchantName = (deps: Deps, id: string) =>
  deps.db.select().from(merchants).where(eq(merchants.id, id)).get()?.name ?? "Merchant";

export const receiptUrl = (deps: Deps, paymentId: string) => `${deps.env.PUBLIC_WEB_URL.replace(/\/$/, "")}/r/${paymentId}`;

/** GET /public/receipts/:paymentId: public by design (payment ids are unguessable hashes), like a card receipt link. */
export function receipt(deps: Deps, paymentId: string): Receipt {
  const p = deps.db.select().from(payments).where(eq(payments.id, paymentId)).get();
  if (!p) throw notFound("Receipt");

  let lineItems: Receipt["lineItems"] = [];
  let planName: string | null = null;
  if (p.sessionId) {
    const s = deps.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, p.sessionId)).get();
    if (s) {
      lineItems = (JSON.parse(s.lineItemsJson) as StoredLineItem[]).map((i) => ({
        name: i.name,
        unitAmount: fromUnits(BigInt(i.unitAmountUnits)),
        quantity: i.quantity,
        amount: fromUnits(BigInt(i.unitAmountUnits) * BigInt(i.quantity)),
      }));
    }
  }
  if (p.subscriptionId) {
    const sub = deps.db.select().from(subscriptions).where(eq(subscriptions.id, p.subscriptionId)).get();
    planName = sub ? (planById(deps, sub.planId)?.name ?? null) : null;
    if (!lineItems.length && planName) {
      lineItems = [{ name: planName, unitAmount: fromUnits(BigInt(p.amountUnits)), quantity: 1, amount: fromUnits(BigInt(p.amountUnits)) }];
    }
  }

  const done = deps.db
    .select()
    .from(refunds)
    .where(and(eq(refunds.paymentId, p.id), eq(refunds.status, "succeeded")))
    .all();

  return {
    paymentId: p.id,
    merchant: { name: merchantName(deps, p.merchantId) },
    kind: p.kind,
    status: paymentStatus(p),
    lineItems,
    planName,
    reference: p.reference,
    amount: fromUnits(BigInt(p.amountUnits)),
    refunded: fromUnits(BigInt(p.refundedUnits)),
    payerAddress: p.payerAddress,
    txHash: p.txHash,
    explorerUrl: explorerTx(p.txHash),
    paidAt: isoFromSeconds(p.paidAt),
    refunds: done.map((r) => ({
      id: r.id,
      amount: fromUnits(BigInt(r.amountUnits)),
      txHash: r.txHash,
      explorerUrl: r.txHash ? explorerTx(r.txHash) : null,
      createdAt: isoFromSeconds(r.createdAt),
    })),
  };
}

/** GET /public/portal: the signed-in wallet's subscriptions and payments, across all merchants on this instance. */
export function portal(deps: Deps, address: string): PortalResponse {
  const lc = address.toLowerCase();
  const subs = deps.db
    .select()
    .from(subscriptions)
    .orderBy(desc(subscriptions.createdAt))
    .all()
    .filter((s) => s.subscriberAddress.toLowerCase() === lc);
  const paid = deps.db
    .select()
    .from(payments)
    .orderBy(desc(payments.paidAt))
    .all()
    .filter((p) => p.payerAddress.toLowerCase() === lc);
  return {
    address,
    subscriptions: subs.map((s) => ({ ...toSubscription(deps, s), merchantName: merchantName(deps, s.merchantId) })),
    payments: paid.map((p) => ({ ...toPayment(deps, p), merchantName: merchantName(deps, p.merchantId), receiptUrl: receiptUrl(deps, p.id) })),
  };
}
