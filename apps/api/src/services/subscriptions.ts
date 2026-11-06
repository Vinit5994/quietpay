import { and, desc, eq } from "drizzle-orm";
import { getAddress, type Hex } from "viem";
import {
  apiPaymentId,
  cancelSubscriptionTypedData,
  explorerTx,
  fromUnits,
  subscriptionPaymentId,
  toJsonTypedData,
  type Subscription,
} from "@quietpay/shared";
import { checkoutSessions, merchants, payments, subscriptions } from "../db/schema";
import type { Deps, MerchantRow } from "../deps";
import { ApiError, notFound } from "../lib/errors";
import type { Relayer } from "../relayer";
import { isoFromSeconds, newId, nowSeconds } from "../lib/ids";
import { enqueueWebhook } from "../webhooks";
import { planById, planByOnchainId, type PlanRow } from "./plans";

export type SubscriptionRow = typeof subscriptions.$inferSelect;
type CancelReason = NonNullable<SubscriptionRow["cancelReason"]>;
const REASONS: Record<number, CancelReason> = { 0: "customer", 1: "nonpayment", 2: "merchant" };

export function toSubscription(deps: Deps, row: SubscriptionRow): Subscription {
  const plan = planById(deps, row.planId);
  return {
    id: row.id,
    onchainSubId: row.onchainSubId,
    planId: row.planId,
    planName: plan?.name ?? "Plan",
    amount: fromUnits(BigInt(plan?.amountUnits ?? "0")),
    periodSeconds: plan?.periodSeconds ?? 0,
    graceSeconds: plan?.graceSeconds ?? 0,
    subscriberAddress: row.subscriberAddress,
    customerEmail: row.customerEmail,
    reference: row.reference,
    status: row.status,
    cycle: row.cycle,
    nextChargeAt: row.status === "canceled" || !row.nextChargeAt ? null : isoFromSeconds(row.nextChargeAt),
    pastDueSince: row.pastDueSince ? isoFromSeconds(row.pastDueSince) : null,
    failedAttempts: row.failedAttempts,
    cancelReason: row.cancelReason,
    createdAt: isoFromSeconds(row.createdAt),
  };
}

export const subByOnchainId = (deps: Deps, subId: bigint | string) =>
  deps.db.select().from(subscriptions).where(eq(subscriptions.onchainSubId, subId.toString())).get();

export function loadSubscription(deps: Deps, merchantId: string, id: string) {
  const row = deps.db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.id, id), eq(subscriptions.merchantId, merchantId)))
    .get();
  if (!row) throw notFound("Subscription");
  return row;
}

export function listSubscriptions(deps: Deps, merchantId: string, status?: SubscriptionRow["status"]) {
  const where = status
    ? and(eq(subscriptions.merchantId, merchantId), eq(subscriptions.status, status))
    : eq(subscriptions.merchantId, merchantId);
  return deps.db.select().from(subscriptions).where(where).orderBy(desc(subscriptions.createdAt)).all();
}

function merchantOf(deps: Deps, row: SubscriptionRow): MerchantRow {
  return deps.db.select().from(merchants).where(eq(merchants.id, row.merchantId)).get()!;
}

/** `subscription.*` webhook payload (same shape for every type). */
function subscriptionEventData(deps: Deps, row: SubscriptionRow, tx: Hex | null, extra: { paymentId?: string | null; attemptedCycle?: number | null } = {}) {
  const s = toSubscription(deps, row);
  return {
    merchantReference: row.reference,
    txHash: tx,
    explorerUrl: tx ? explorerTx(tx) : null,
    subscriptionId: s.id,
    planId: s.planId,
    subscriberAddress: s.subscriberAddress,
    status: s.status,
    cycle: s.cycle,
    amount: s.amount,
    nextChargeAt: s.nextChargeAt,
    pastDueSince: s.pastDueSince,
    cancelReason: s.cancelReason,
    paymentId: extra.paymentId ?? null,
    attemptedCycle: extra.attemptedCycle ?? null,
  };
}

/**
 * Creates the subscription row for an on-chain subscribe (idempotent on onchain_sub_id) and completes its
 * checkout session. Called by the relayer on receipt and by the indexer on `Subscribed`.
 */
export function recordSubscriptionStart(
  deps: Deps,
  args: { subId: bigint; plan: PlanRow; subscriber: string; nextChargeAt: number; txHash: Hex },
): { row: SubscriptionRow; created: boolean } {
  const existing = subByOnchainId(deps, args.subId);
  if (existing) return { row: existing, created: false };

  const session = deps.db.select().from(checkoutSessions).where(eq(checkoutSessions.txHash, args.txHash)).get();
  const row: SubscriptionRow = {
    id: newId("sub"),
    merchantId: args.plan.merchantId,
    onchainSubId: args.subId.toString(),
    planId: args.plan.id,
    subscriberAddress: getAddress(args.subscriber),
    customerEmail: session?.customerEmail ?? null,
    reference: session?.reference ?? null,
    status: "active",
    cycle: 0,
    nextChargeAt: args.nextChargeAt,
    pastDueSince: null,
    failedAttempts: 0,
    lastAttemptAt: null,
    cancelReason: null,
    sessionId: session?.id ?? null,
    cancelPreparedJson: null,
    createdAt: nowSeconds(),
  };
  deps.db.insert(subscriptions).values(row).onConflictDoNothing().run();

  const paymentId = apiPaymentId(subscriptionPaymentId(args.subId, 0));
  if (session) {
    deps.db
      .update(checkoutSessions)
      .set({ status: "complete", subscriptionId: row.id, paymentId, payerAddress: row.subscriberAddress, lastError: null })
      .where(eq(checkoutSessions.id, session.id))
      .run();
  }
  return { row: subByOnchainId(deps, args.subId) ?? row, created: true };
}

/** Records a subscription charge (cycle 0 = first charge in subscribe, ≥1 = renewal). Idempotent. */
export function recordSubscriptionPayment(
  deps: Deps,
  sub: SubscriptionRow,
  args: { paymentId: Hex; amount: bigint; fee: bigint },
  tx: { txHash: Hex; blockNumber: bigint },
) {
  const id = apiPaymentId(args.paymentId);
  const isFirst = args.paymentId.toLowerCase() === subscriptionPaymentId(BigInt(sub.onchainSubId), 0).toLowerCase();
  const inserted = deps.db
    .insert(payments)
    .values({
      id,
      onchainPaymentId: args.paymentId.toLowerCase(),
      merchantId: sub.merchantId,
      kind: "subscription",
      sessionId: isFirst ? sub.sessionId : null,
      subscriptionId: sub.id,
      reference: sub.reference,
      payerAddress: sub.subscriberAddress,
      amountUnits: args.amount.toString(),
      feeUnits: args.fee.toString(),
      refundedUnits: "0",
      txHash: tx.txHash,
      blockNumber: tx.blockNumber.toString(),
      paidAt: nowSeconds(),
    })
    .onConflictDoNothing()
    .run();
  return { id, isFirst, inserted: inserted.changes > 0 };
}

// ---------------------------------------------------------------- indexer handlers (each runs once per event)

/** `Subscribed` → subscription row + `subscription.created`. */
export async function onSubscribed(deps: Deps, args: { subId: bigint; planId: bigint; subscriber: string }, txHash: Hex) {
  const plan = planByOnchainId(deps, args.planId.toString());
  if (!plan) return; // another instance's plan
  const onchain = await deps.chain.readSub(args.subId);
  const { row } = recordSubscriptionStart(deps, {
    subId: args.subId,
    plan,
    subscriber: args.subscriber,
    nextChargeAt: Number(onchain.nextChargeAt),
    txHash,
  });
  enqueueWebhook(deps, merchantOf(deps, row), "subscription.created", subscriptionEventData(deps, row, txHash, {
    paymentId: apiPaymentId(subscriptionPaymentId(args.subId, 0)),
  }));
}

/** `PaymentReceived` kind 1 → payment row + `payment.succeeded` (+ `checkout.session.completed` for the first charge). */
export function onSubscriptionPayment(
  deps: Deps,
  args: { paymentId: Hex; subId: bigint; payer: string; amount: bigint; fee: bigint },
  txHash: Hex,
  blockNumber: bigint,
) {
  const sub = subByOnchainId(deps, args.subId);
  if (!sub) return; // another instance's subscription
  const merchant = merchantOf(deps, sub);
  const { id, isFirst } = recordSubscriptionPayment(deps, sub, args, { txHash, blockNumber });
  const common = { merchantReference: sub.reference, txHash, explorerUrl: explorerTx(txHash) };

  enqueueWebhook(deps, merchant, "payment.succeeded", {
    ...common,
    paymentId: id,
    kind: "subscription",
    sessionId: isFirst ? sub.sessionId : null,
    subscriptionId: sub.id,
    payerAddress: sub.subscriberAddress,
    amount: fromUnits(args.amount),
    fee: fromUnits(args.fee),
    net: fromUnits(args.amount - args.fee),
    paidAt: isoFromSeconds(nowSeconds()),
  });
  if (isFirst && sub.sessionId) {
    enqueueWebhook(deps, merchant, "checkout.session.completed", {
      ...common,
      sessionId: sub.sessionId,
      mode: "subscription",
      paymentId: id,
      subscriptionId: sub.id,
      payerAddress: sub.subscriberAddress,
      amount: fromUnits(args.amount),
    });
  }
}

/** `Renewed` → active, cycle, next charge from chain, failures cleared → `subscription.renewed`. */
export async function onRenewed(deps: Deps, args: { subId: bigint; cycle: number; paymentId: Hex }, txHash: Hex) {
  const sub = subByOnchainId(deps, args.subId);
  if (!sub) return;
  const onchain = await deps.chain.readSub(args.subId);
  deps.db
    .update(subscriptions)
    .set({ status: "active", cycle: Number(args.cycle), nextChargeAt: Number(onchain.nextChargeAt), pastDueSince: null, failedAttempts: 0 })
    .where(eq(subscriptions.id, sub.id))
    .run();
  const row = subByOnchainId(deps, args.subId)!;
  enqueueWebhook(deps, merchantOf(deps, row), "subscription.renewed", subscriptionEventData(deps, row, txHash, {
    paymentId: apiPaymentId(args.paymentId),
  }));
}

/** `RenewalFailed` → past_due (pastDueSince set once), failedAttempts++ → `subscription.payment_failed`. */
export async function onRenewalFailed(deps: Deps, args: { subId: bigint; attemptedCycle: number }, txHash: Hex) {
  const sub = subByOnchainId(deps, args.subId);
  if (!sub) return;
  const onchain = await deps.chain.readSub(args.subId);
  deps.db
    .update(subscriptions)
    .set({
      status: "past_due",
      pastDueSince: sub.pastDueSince ?? (Number(onchain.pastDueSince) || nowSeconds()),
      failedAttempts: sub.failedAttempts + 1,
    })
    .where(eq(subscriptions.id, sub.id))
    .run();
  const row = subByOnchainId(deps, args.subId)!;
  enqueueWebhook(deps, merchantOf(deps, row), "subscription.payment_failed", subscriptionEventData(deps, row, txHash, {
    attemptedCycle: Number(args.attemptedCycle),
  }));
}

/** `SubscriptionCanceled` → canceled with reason → `subscription.canceled`. */
export function onSubscriptionCanceled(deps: Deps, args: { subId: bigint; reason: number }, txHash: Hex) {
  const sub = subByOnchainId(deps, args.subId);
  if (!sub) return;
  deps.db
    .update(subscriptions)
    .set({ status: "canceled", cancelReason: REASONS[Number(args.reason)] ?? "merchant" })
    .where(eq(subscriptions.id, sub.id))
    .run();
  const row = subByOnchainId(deps, args.subId)!;
  enqueueWebhook(deps, merchantOf(deps, row), "subscription.canceled", subscriptionEventData(deps, row, txHash));
}

// ---------------------------------------------------------------- cancel

function assertCancelable(row: SubscriptionRow) {
  if (row.status === "canceled") throw new ApiError(409, "subscription_not_active", "This subscription is already canceled.");
}

/** Merchant cancel (operator `cancelByMerchant`). The indexer sends `subscription.canceled`. */
export async function cancelByMerchant(deps: Deps, relayer: Relayer, merchant: MerchantRow, row: SubscriptionRow) {
  assertCancelable(row);
  await relayer.relayAndWait({ fn: "cancelByMerchant", args: [BigInt(row.onchainSubId)], merchant, purpose: "cancel" });
  deps.db.update(subscriptions).set({ status: "canceled", cancelReason: "merchant" }).where(eq(subscriptions.id, row.id)).run();
  return subByOnchainId(deps, row.onchainSubId)!;
}

export const CANCEL_SIGNATURE_TTL = 10 * 60;

/** Portal: only the subscriber's own subscriptions. */
export function loadCustomerSubscription(deps: Deps, address: string, id: string) {
  const row = deps.db.select().from(subscriptions).where(eq(subscriptions.id, id)).get();
  if (!row || row.subscriberAddress.toLowerCase() !== address.toLowerCase()) throw notFound("Subscription");
  return row;
}

/** CancelSubscription typed data for the subscriber to sign (stored so submit verifies the exact message). */
export async function prepareCustomerCancel(deps: Deps, row: SubscriptionRow) {
  assertCancelable(row);
  const nonce = await deps.chain.sigNonce(row.subscriberAddress as Hex);
  const typedData = toJsonTypedData(
    cancelSubscriptionTypedData(deps.chain.quietPay, {
      subId: BigInt(row.onchainSubId),
      nonce,
      deadline: BigInt(nowSeconds() + CANCEL_SIGNATURE_TTL),
    }),
  );
  deps.db.update(subscriptions).set({ cancelPreparedJson: JSON.stringify(typedData) }).where(eq(subscriptions.id, row.id)).run();
  return { subscriptionId: row.id, typedData: typedData as never };
}

/** Customer cancel (`cancel` with their signature, relayed gaslessly). */
export async function submitCustomerCancel(deps: Deps, relayer: Relayer, row: SubscriptionRow, signature: Hex) {
  assertCancelable(row);
  if (!row.cancelPreparedJson) throw new ApiError(400, "bad_request", "Prepare the cancellation first.");
  const typedData = JSON.parse(row.cancelPreparedJson) as ReturnType<typeof toJsonTypedData<ReturnType<typeof cancelSubscriptionTypedData>>>;
  if (Number(typedData.message.deadline) < nowSeconds()) {
    throw new ApiError(409, "signature_expired", "The cancel request expired. Try again.");
  }
  const ok = await deps.chain.verifyTypedData({ ...(typedData as object), address: row.subscriberAddress, signature } as never);
  if (!ok) throw new ApiError(400, "invalid_signature", "The cancel signature doesn't match this wallet.");

  const { txHash } = await relayer.relayAndWait({
    fn: "cancel",
    args: [BigInt(row.onchainSubId), BigInt(typedData.message.deadline), signature],
    merchant: merchantOf(deps, row),
    purpose: "cancel",
  });
  deps.db
    .update(subscriptions)
    .set({ status: "canceled", cancelReason: "customer", cancelPreparedJson: null })
    .where(eq(subscriptions.id, row.id))
    .run();
  const updated = subByOnchainId(deps, row.onchainSubId)!;
  return { txHash, subscription: { ...toSubscription(deps, updated), merchantName: merchantOf(deps, updated).name } };
}
