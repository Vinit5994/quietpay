import { explorerTx, fromUnits } from "@quietpay/shared";
import {
  getBalance,
  newPaymentIds,
  nextBlock,
  randomHash,
  recordGas,
  setBalance,
  type MockState,
  type PaymentRec,
  type RefundRec,
  type SessionRec,
  type SubRec,
} from "./state";
import { emitWebhook } from "./webhooks";

const later = (ms: number, fn: () => void) => setTimeout(fn, ms).unref?.();
const chain = (txHash: string | null) => ({ txHash, explorerUrl: txHash ? explorerTx(txHash) : null });

export function subscriptionEventData(
  state: MockState,
  sub: SubRec,
  txHash: string | null,
  extra: { paymentId?: string | null; attemptedCycle?: number | null } = {},
) {
  const plan = state.plans.find((p) => p.id === sub.planId)!;
  return {
    merchantReference: sub.reference,
    ...chain(txHash),
    subscriptionId: sub.id,
    planId: sub.planId,
    subscriberAddress: sub.subscriber,
    status: sub.status,
    cycle: sub.cycle,
    amount: fromUnits(plan.amount),
    nextChargeAt: sub.nextChargeAt?.toISOString() ?? null,
    pastDueSince: sub.pastDueSince?.toISOString() ?? null,
    cancelReason: sub.cancelReason,
    paymentId: extra.paymentId ?? null,
    attemptedCycle: extra.attemptedCycle ?? null,
  };
}

function paymentEventData(p: PaymentRec) {
  return {
    merchantReference: p.reference,
    ...chain(p.txHash),
    paymentId: p.id,
    kind: p.kind,
    sessionId: p.sessionId,
    subscriptionId: p.subscriptionId,
    payerAddress: p.payer,
    amount: fromUnits(p.amount),
    fee: fromUnits(p.fee),
    net: fromUnits(p.amount - p.fee),
    paidAt: p.paidAt.toISOString(),
  };
}

function sessionCompletedData(session: SessionRec, payment: PaymentRec) {
  return {
    merchantReference: session.reference,
    ...chain(session.txHash),
    sessionId: session.id,
    mode: session.mode,
    paymentId: payment.id,
    subscriptionId: session.subscriptionId,
    payerAddress: session.payer!,
    amount: fromUnits(session.amount),
  };
}

function createPayment(
  state: MockState,
  input: Omit<PaymentRec, "id" | "onchainId" | "refunded" | "refundCount" | "fee" | "paidAt" | "blockNumber">,
): PaymentRec {
  const payment: PaymentRec = {
    ...input,
    ...newPaymentIds(),
    fee: 0n,
    refunded: 0n,
    refundCount: 0,
    blockNumber: nextBlock(state),
    paidAt: new Date(),
  };
  state.payments.unshift(payment);
  return payment;
}

/** After /submit: pretend the relayer's transaction confirms after `confirmMs`. */
export function scheduleSessionConfirmation(state: MockState, session: SessionRec) {
  later(state.config.confirmMs, () => void confirmSession(state, session));
}

async function confirmSession(state: MockState, session: SessionRec) {
  const payer = session.payer!;
  const txHash = session.txHash!;
  recordGas(state, session.merchantId);
  setBalance(state, payer, getBalance(state, payer) - session.amount);

  if (session.mode === "payment") {
    const payment = createPayment(state, {
      merchantId: session.merchantId,
      kind: "checkout",
      reference: session.reference,
      customerEmail: session.customerEmail,
      payer,
      amount: session.amount,
      txHash,
      sessionId: session.id,
      subscriptionId: null,
      lineItems: session.lineItems,
      planName: null,
    });
    session.paymentId = payment.id;
    session.status = "complete";
    await emitWebhook(state, session.merchantId, "checkout.session.completed", sessionCompletedData(session, payment));
    await emitWebhook(state, session.merchantId, "payment.succeeded", paymentEventData(payment));
    return;
  }

  const plan = state.plans.find((p) => p.id === session.planId)!;
  state.counters.sub += 1n;
  const sub: SubRec = {
    id: `sub_${randomHash().slice(2, 18)}`,
    onchainId: state.counters.sub,
    merchantId: session.merchantId,
    planId: plan.id,
    subscriber: payer,
    customerEmail: session.customerEmail,
    reference: session.reference,
    status: "active",
    cycle: 0,
    failedAttempts: 0,
    nextChargeAt: new Date(Date.now() + plan.periodSeconds * 1000),
    pastDueSince: null,
    lastAttemptAt: new Date(),
    cancelReason: null,
    forceFail: false,
    createdAt: new Date(),
  };
  state.subs.unshift(sub);
  const payment = createPayment(state, {
    merchantId: session.merchantId,
    kind: "subscription",
    reference: session.reference,
    customerEmail: session.customerEmail,
    payer,
    amount: plan.amount,
    txHash,
    sessionId: session.id,
    subscriptionId: sub.id,
    lineItems: [{ name: plan.name, unitAmount: fromUnits(plan.amount), quantity: 1, amount: fromUnits(plan.amount) }],
    planName: plan.name,
  });
  session.paymentId = payment.id;
  session.subscriptionId = sub.id;
  session.status = "complete";
  await emitWebhook(state, session.merchantId, "subscription.created", subscriptionEventData(state, sub, txHash, { paymentId: payment.id }));
  await emitWebhook(state, session.merchantId, "payment.succeeded", paymentEventData(payment));
  await emitWebhook(state, session.merchantId, "checkout.session.completed", sessionCompletedData(session, payment));
}

/** Keeper: renew due subscriptions, retry past-due ones, cancel after grace. Runs every second. */
export async function tickSubscriptions(state: MockState, at = new Date()) {
  for (const sub of state.subs) {
    if (sub.status === "canceled") continue;
    const due =
      (sub.status === "active" && sub.nextChargeAt && sub.nextChargeAt <= at) ||
      (sub.status === "past_due" && (!sub.lastAttemptAt || at.getTime() - sub.lastAttemptAt.getTime() >= state.config.retryMs));
    if (due) await chargeSubscription(state, sub, at);
  }
}

export async function chargeSubscription(state: MockState, sub: SubRec, at = new Date()) {
  const plan = state.plans.find((p) => p.id === sub.planId)!;
  sub.lastAttemptAt = at;
  recordGas(state, sub.merchantId);
  const txHash = randomHash();
  const canPay = !sub.forceFail && getBalance(state, sub.subscriber) >= plan.amount;

  if (canPay) {
    setBalance(state, sub.subscriber, getBalance(state, sub.subscriber) - plan.amount);
    sub.cycle += 1;
    sub.status = "active";
    sub.pastDueSince = null;
    sub.failedAttempts = 0;
    sub.nextChargeAt = new Date(at.getTime() + plan.periodSeconds * 1000);
    const payment = createPayment(state, {
      merchantId: sub.merchantId,
      kind: "subscription",
      reference: sub.reference,
      customerEmail: sub.customerEmail,
      payer: sub.subscriber,
      amount: plan.amount,
      txHash,
      sessionId: null,
      subscriptionId: sub.id,
      lineItems: [{ name: plan.name, unitAmount: fromUnits(plan.amount), quantity: 1, amount: fromUnits(plan.amount) }],
      planName: plan.name,
    });
    await emitWebhook(state, sub.merchantId, "subscription.renewed", subscriptionEventData(state, sub, txHash, { paymentId: payment.id }));
    await emitWebhook(state, sub.merchantId, "payment.succeeded", paymentEventData(payment));
    return;
  }

  sub.failedAttempts += 1;
  if (sub.status === "active") {
    sub.status = "past_due";
    sub.pastDueSince = at;
  } else if (sub.pastDueSince && at.getTime() >= sub.pastDueSince.getTime() + plan.graceSeconds * 1000) {
    sub.status = "canceled";
    sub.cancelReason = "nonpayment";
    sub.nextChargeAt = null;
    await emitWebhook(state, sub.merchantId, "subscription.canceled", subscriptionEventData(state, sub, txHash));
    return;
  }
  await emitWebhook(state, sub.merchantId, "subscription.payment_failed", subscriptionEventData(state, sub, txHash, { attemptedCycle: sub.cycle + 1 }));
}

export async function cancelSubscription(state: MockState, sub: SubRec, reason: "customer" | "merchant") {
  recordGas(state, sub.merchantId);
  const txHash = randomHash();
  sub.status = "canceled";
  sub.cancelReason = reason;
  sub.nextChargeAt = null;
  await emitWebhook(state, sub.merchantId, "subscription.canceled", subscriptionEventData(state, sub, txHash));
  return txHash;
}

/** After a refund signature is submitted: confirm after `confirmMs`. */
export function scheduleRefundConfirmation(state: MockState, refund: RefundRec) {
  later(state.config.confirmMs, () => void confirmRefund(state, refund));
}

async function confirmRefund(state: MockState, refund: RefundRec) {
  const payment = state.payments.find((p) => p.id === refund.paymentId)!;
  if (payment.refunded + refund.amount > payment.amount) {
    refund.status = "failed";
    refund.error = "Refund would exceed the amount paid";
    return;
  }
  recordGas(state, refund.merchantId);
  payment.refunded += refund.amount;
  payment.refundCount += 1;
  setBalance(state, payment.payer, getBalance(state, payment.payer) + refund.amount);
  refund.status = "succeeded";
  await emitWebhook(state, refund.merchantId, "refund.succeeded", {
    merchantReference: payment.reference,
    ...chain(refund.txHash),
    refundId: refund.id,
    paymentId: payment.id,
    amount: fromUnits(refund.amount),
    totalRefunded: fromUnits(payment.refunded),
    paymentAmount: fromUnits(payment.amount),
    fullyRefunded: payment.refunded >= payment.amount,
  });
}
