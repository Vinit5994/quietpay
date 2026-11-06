import { and, eq } from "drizzle-orm";
import { getAddress, parseEventLogs, type Hex } from "viem";
import {
  explorerTx,
  fromUnits,
  quietPayAbi,
  receiveWithAuthorizationTypedData,
  refundNonce,
  toJsonTypedData,
  toUnits,
  type BodyOf,
  type Refund,
} from "@quietpay/shared";
import { merchants, payments, refunds } from "../db/schema";
import type { Deps, MerchantRow } from "../deps";
import { ApiError, notFound } from "../lib/errors";
import { isoFromSeconds, newId, nowSeconds } from "../lib/ids";
import type { Relayer } from "../relayer";
import { enqueueWebhook } from "../webhooks";

export type RefundRow = typeof refunds.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;

/** How long the payout wallet's refund authorization stays valid. */
export const REFUND_SIGNATURE_TTL = 60 * 60;

export function toRefund(row: RefundRow): Refund {
  return {
    id: row.id,
    paymentId: row.paymentId,
    amount: fromUnits(BigInt(row.amountUnits)),
    reason: row.reason,
    status: row.status,
    seq: row.seq,
    txHash: row.txHash,
    explorerUrl: row.txHash ? explorerTx(row.txHash) : null,
    error: row.error,
    createdAt: isoFromSeconds(row.createdAt),
  };
}

function loadPayment(deps: Deps, merchantId: string, paymentId: string): PaymentRow {
  const p = deps.db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.merchantId, merchantId))).get();
  if (!p) throw notFound("Payment");
  return p;
}

/** amount − refunded − refunds already submitted on-chain but not yet confirmed. */
export function refundableUnits(deps: Deps, payment: PaymentRow): bigint {
  const inFlight = deps.db
    .select()
    .from(refunds)
    .where(and(eq(refunds.paymentId, payment.id), eq(refunds.status, "submitted")))
    .all()
    .reduce((sum, r) => sum + BigInt(r.amountUnits), 0n);
  return BigInt(payment.amountUnits) - BigInt(payment.refundedUnits) - inFlight;
}

function assertRefundable(deps: Deps, payment: PaymentRow, amount: bigint) {
  const left = refundableUnits(deps, payment);
  if (amount > left) {
    throw new ApiError(
      422,
      "refund_exceeds_payment",
      `Only ${fromUnits(left > 0n ? left : 0n)} USDT of this ${fromUnits(BigInt(payment.amountUnits))} USDT payment can still be refunded.`,
    );
  }
}

/** POST /v1/refunds: checks the cap and creates the refund `awaiting_signature` (the payout wallet signs next). */
export function createRefund(deps: Deps, merchant: MerchantRow, body: BodyOf<"createRefund">) {
  const payment = loadPayment(deps, merchant.id, body.paymentId);
  const amount = toUnits(body.amount);
  if (amount <= 0n) throw new ApiError(422, "invalid_amount", "Refund amount must be more than 0.");
  assertRefundable(deps, payment, amount);

  const row: RefundRow = {
    id: newId("re"),
    paymentId: payment.id,
    amountUnits: amount.toString(),
    reason: body.reason ?? null,
    status: "awaiting_signature",
    seq: null,
    typedDataJson: null,
    txHash: null,
    error: null,
    createdAt: nowSeconds(),
  };
  deps.db.insert(refunds).values(row).run();
  const signUrl = `${deps.env.PUBLIC_WEB_URL.replace(/\/$/, "")}/dashboard/payments?refund=${row.id}`;
  return { ...toRefund(row), signUrl };
}

export function loadRefund(deps: Deps, merchantId: string, refundId: string) {
  const row = deps.db.select().from(refunds).where(eq(refunds.id, refundId)).get();
  if (!row) throw notFound("Refund");
  const payment = loadPayment(deps, merchantId, row.paymentId); // 404 if another merchant's
  return { row, payment };
}

type RefundTypedData = ReturnType<typeof toJsonTypedData<ReturnType<typeof receiveWithAuthorizationTypedData>>>;

/**
 * POST /dash/refunds/:id/typed-data: EIP-3009 from the merchant payout wallet to QuietPay,
 * nonce = refundNonce(paymentId, on-chain refundCount). Stored so submit verifies the exact message.
 */
export async function refundTypedData(deps: Deps, merchant: MerchantRow, refundId: string) {
  const { row, payment } = loadRefund(deps, merchant.id, refundId);
  if (row.status !== "awaiting_signature") throw new ApiError(409, "conflict", `This refund is already ${row.status}.`);
  assertRefundable(deps, payment, BigInt(row.amountUnits));

  const seq = await deps.chain.refundCount(payment.onchainPaymentId as Hex);
  const payout = getAddress(merchant.payoutAddress);
  const typedData = toJsonTypedData(
    receiveWithAuthorizationTypedData({
      from: payout,
      to: deps.chain.quietPay,
      value: BigInt(row.amountUnits),
      validAfter: 0n,
      validBefore: BigInt(nowSeconds() + REFUND_SIGNATURE_TTL),
      nonce: refundNonce(deps.chain.quietPay, payment.onchainPaymentId as Hex, seq),
    }),
  );
  deps.db.update(refunds).set({ seq, typedDataJson: JSON.stringify(typedData) }).where(eq(refunds.id, row.id)).run();
  const updated = deps.db.select().from(refunds).where(eq(refunds.id, row.id)).get()!;
  return { refund: toRefund(updated), signer: payout, typedData: typedData as never };
}

/** POST /dash/refunds/:id/submit: verify the payout signature, re-check cap and sequence, relay `refund`. */
export async function submitRefund(deps: Deps, relayer: Relayer, merchant: MerchantRow, refundId: string, signature: Hex) {
  const { row, payment } = loadRefund(deps, merchant.id, refundId);
  if (row.status !== "awaiting_signature") throw new ApiError(409, "conflict", `This refund is already ${row.status}.`);
  if (!row.typedDataJson || row.seq === null) throw new ApiError(400, "bad_request", "Get the typed data to sign first.");
  const typedData = JSON.parse(row.typedDataJson) as RefundTypedData;
  const amount = BigInt(row.amountUnits);

  if (Number(typedData.message.validBefore) <= nowSeconds()) {
    throw new ApiError(409, "signature_expired", "The refund signature expired. Sign again.");
  }
  const ok = await deps.chain.verifyTypedData({ ...(typedData as object), address: merchant.payoutAddress, signature } as never);
  if (!ok) throw new ApiError(400, "invalid_signature", "This refund must be signed by the merchant payout wallet.");

  assertRefundable(deps, payment, amount);
  const seq = await deps.chain.refundCount(payment.onchainPaymentId as Hex);
  if (seq !== row.seq) {
    deps.db.update(refunds).set({ seq: null, typedDataJson: null }).where(eq(refunds.id, row.id)).run();
    throw new ApiError(409, "conflict", "Another refund on this payment went through first. Sign this one again.");
  }
  const payoutBalance = await deps.chain.usdtBalance(merchant.payoutAddress as Hex);
  if (payoutBalance < amount) {
    throw new ApiError(
      402,
      "insufficient_balance",
      `The payout wallet has ${fromUnits(payoutBalance)} USDT; this refund needs ${fromUnits(amount)} USDT.`,
    );
  }

  const txHash = await relayer.relay({
    fn: "refund",
    args: [payment.onchainPaymentId, amount, BigInt(typedData.message.validAfter), BigInt(typedData.message.validBefore), signature],
    merchant,
    purpose: "refund",
    onReceipt: (receipt) => {
      const log = receipt.status === "success"
        ? parseEventLogs({ abi: quietPayAbi, eventName: "Refunded", logs: receipt.logs })[0]
        : undefined;
      if (!log) {
        deps.db.update(refunds).set({ status: "failed", error: "The refund transaction reverted." }).where(eq(refunds.id, row.id)).run();
        return;
      }
      recordRefund(deps, payment, row.id, log.args.totalRefunded);
    },
    onError: (err) => {
      deps.db.update(refunds).set({ status: "failed", error: err.message }).where(eq(refunds.id, row.id)).run();
    },
  });
  deps.db.update(refunds).set({ status: "submitted", txHash }).where(eq(refunds.id, row.id)).run();
  return { refund: toRefund(deps.db.select().from(refunds).where(eq(refunds.id, row.id)).get()!), txHash };
}

/** Marks a refund succeeded and sets payments.refunded_units from the event's running total (idempotent). */
function recordRefund(deps: Deps, payment: PaymentRow, refundId: string, totalRefunded: bigint) {
  deps.db.update(refunds).set({ status: "succeeded", error: null }).where(eq(refunds.id, refundId)).run();
  deps.db.update(payments).set({ refundedUnits: totalRefunded.toString() }).where(eq(payments.id, payment.id)).run();
}

/** Indexer: `Refunded` → refund succeeded, payment refunded total → `refund.succeeded`. */
export function onRefunded(
  deps: Deps,
  args: { paymentId: Hex; merchantId: bigint; seq: number; amount: bigint; totalRefunded: bigint },
  txHash: Hex,
) {
  const merchant = deps.db.select().from(merchants).where(eq(merchants.onchainId, args.merchantId.toString())).get();
  if (!merchant) return; // another instance's merchant
  // payment ids come from viem logs, lowercase hex, both when stored and here
  const payment = deps.db
    .select()
    .from(payments)
    .where(and(eq(payments.onchainPaymentId, args.paymentId.toLowerCase()), eq(payments.merchantId, merchant.id)))
    .get();
  if (!payment) return;

  let refund = deps.db
    .select()
    .from(refunds)
    .where(and(eq(refunds.paymentId, payment.id), eq(refunds.seq, Number(args.seq))))
    .get();
  if (!refund) {
    // refunded outside the API (e.g. a direct contract call): record it anyway
    refund = {
      id: newId("re"),
      paymentId: payment.id,
      amountUnits: args.amount.toString(),
      reason: null,
      status: "succeeded",
      seq: Number(args.seq),
      typedDataJson: null,
      txHash,
      error: null,
      createdAt: nowSeconds(),
    };
    deps.db.insert(refunds).values(refund).run();
  }
  deps.db.update(refunds).set({ txHash }).where(eq(refunds.id, refund.id)).run();
  recordRefund(deps, payment, refund.id, args.totalRefunded);

  const paymentAmount = BigInt(payment.amountUnits);
  enqueueWebhook(deps, merchant, "refund.succeeded", {
    merchantReference: payment.reference,
    txHash,
    explorerUrl: explorerTx(txHash),
    refundId: refund.id,
    paymentId: payment.id,
    amount: fromUnits(args.amount),
    totalRefunded: fromUnits(args.totalRefunded),
    paymentAmount: fromUnits(paymentAmount),
    fullyRefunded: args.totalRefunded >= paymentAmount,
  });
}
