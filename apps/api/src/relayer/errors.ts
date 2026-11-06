import { BaseError, ContractFunctionRevertedError } from "viem";
import type { ErrorCode } from "@quietpay/shared";
import { ApiError } from "../lib/errors";

/** QuietPay (and OZ) custom error → API error code + a message a customer can act on. */
const CONTRACT_ERRORS: Record<string, { code: ErrorCode; message: string }> = {
  MerchantInactive: { code: "merchant_inactive", message: "This merchant is not accepting payments right now." },
  InvoiceExpired: { code: "invoice_expired", message: "This checkout has expired. Go back to the store and try again." },
  OrderAlreadyPaid: { code: "order_already_paid", message: "This order has already been paid." },
  InvalidMerchantSignature: { code: "invalid_merchant_signature", message: "The merchant's invoice signature is invalid." },
  UnknownPayment: { code: "unknown_payment", message: "Payment not found on-chain." },
  RefundExceedsPayment: { code: "refund_exceeds_payment", message: "Refund is larger than what is left to refund." },
  PlanInactive: { code: "plan_inactive", message: "This plan is no longer available." },
  PlanAboveMax: { code: "plan_above_max", message: "The plan price is above what you approved." },
  SignatureExpired: { code: "signature_expired", message: "Your signature expired. Sign again." },
  InvalidSubscriberSignature: { code: "invalid_subscriber_signature", message: "Subscription signature is invalid." },
  InsufficientAllowance: { code: "insufficient_allowance", message: "The spending approval is too low." },
  NotChargeable: { code: "not_chargeable", message: "This subscription can't be charged." },
  NotDue: { code: "not_due", message: "This subscription isn't due yet." },
  NotOperator: { code: "not_operator", message: "The relayer is not an operator on QuietPay." },
  FeeTooHigh: { code: "fee_too_high", message: "Fee too high." },
  InvalidAmount: { code: "invalid_amount", message: "Invalid amount." },
  ZeroAddress: { code: "zero_address", message: "An address is missing." },
  EnforcedPause: { code: "enforced_pause", message: "Payments are paused for maintenance. Try again shortly." },
};

/** Revert strings from TetherTokenV2 (EIP-3009 / ERC-20). */
function fromTokenReason(reason: string): { code: ErrorCode; message: string } | undefined {
  const r = reason.toLowerCase();
  if (r.includes("signature")) return { code: "invalid_signature", message: "Your payment signature is invalid. Sign again." };
  if (r.includes("used") || r.includes("canceled")) return { code: "order_already_paid", message: "This payment was already submitted." };
  if (r.includes("expired") || r.includes("not yet valid")) return { code: "session_expired", message: "Your payment signature has expired. Sign again." };
  if (r.includes("balance")) return { code: "insufficient_balance", message: "Not enough USDT in the wallet." };
  if (r.includes("allowance")) return { code: "insufficient_allowance", message: "The spending approval is too low." };
  return undefined;
}

/** Turns a simulation/send failure into an ApiError. Unknown failures become `simulation_failed`. */
export function decodeRevert(err: unknown): ApiError {
  let errorName: string | undefined;
  let reason: string | undefined;

  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      errorName = revert.data?.errorName;
      reason = revert.reason ?? undefined;
    }
    reason ??= err.shortMessage;
  } else if (err && typeof err === "object") {
    // fakes in tests: { errorName } or { reason }
    errorName = (err as { errorName?: string }).errorName;
    reason = (err as { reason?: string }).reason;
  }

  const known = (errorName && CONTRACT_ERRORS[errorName]) || (reason && fromTokenReason(reason));
  if (known) return new ApiError(422, known.code, known.message);
  return new ApiError(422, "simulation_failed", `The transaction would fail: ${reason ?? errorName ?? "unknown reason"}.`);
}
