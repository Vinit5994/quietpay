import { eq } from "drizzle-orm";
import { parseEventLogs, type Hex, type Log } from "viem";
import { apiPaymentId, quietPayAbi } from "@quietpay/shared";
import { checkoutSessions, payments } from "../db/schema";
import type { Deps } from "../deps";
import { nowSeconds } from "../lib/ids";
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
