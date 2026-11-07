import type { PrepareSessionResponse, PublicSession, SessionStatusResponse } from "@quietpay/shared";
import type { TypedDataJson } from "@/lib/wallet/typed-data";

/**
 * Hosted checkout as a pure state machine (docs/SPEC_FRONTEND.md "/c/[sessionId]", 8 states):
 * loading → review (sign in) → pay → [insufficient] → processing → success, or closed.
 * Side effects (API calls, signing, polling) live in useCheckout; this file only decides what comes next.
 */

export type ClosedReason = "expired" | "already_paid" | "not_found" | "error";
export type Busy = "preparing" | "signing" | "submitting";

export interface SignStep {
  key: "payment" | "subscribe" | "permit";
  label: string;
  payload: TypedDataJson;
}

export type Phase =
  | { name: "loading" }
  | { name: "review"; session: PublicSession }
  | {
      name: "pay";
      session: PublicSession;
      busy: Busy | null;
      step: { current: number; total: number; label: string } | null;
      notice: string | null;
    }
  | { name: "insufficient"; session: PublicSession; balance: string; needed: string }
  | { name: "processing"; session: PublicSession; txHash: string | null; slow: boolean }
  | { name: "success"; session: PublicSession; status: SessionStatusResponse }
  | { name: "closed"; session: PublicSession | null; reason: ClosedReason; message: string };

export type Action =
  | { type: "loaded"; session: PublicSession; signedIn: boolean }
  | { type: "load_failed"; code: string; message: string }
  | { type: "signed_in" }
  | { type: "signed_out" }
  | { type: "pay_started" }
  | { type: "prepared"; prepare: PrepareSessionResponse }
  | { type: "sign_step"; current: number; total: number; label: string }
  | { type: "sign_rejected" }
  | { type: "submit_started" }
  | { type: "submitted"; txHash: string }
  | { type: "status"; status: SessionStatusResponse }
  | { type: "slow" }
  | { type: "failed"; code: string; message: string }
  | { type: "expired_locally" };

export const initialPhase: Phase = { name: "loading" };

const payIdle = (session: PublicSession, notice: string | null = null): Phase => ({
  name: "pay",
  session,
  busy: null,
  step: null,
  notice,
});

export const MESSAGES = {
  expired: "This checkout has expired. Go back to the store to start again.",
  alreadyPaid: "This order has already been paid.",
  notFound: "This checkout link doesn't work. Go back to the store and try again.",
  signRejected: "You closed the signature request. You haven't been charged.",
  merchantUnavailable: "This store can't take payments right now. You haven't been charged. Please try again later or contact the store.",
};

/** API errors whose wording is meant for merchants (gas, budgets), rephrased for customers. */
const customerMessage = (code: string, message: string) => (code === "merchant_gas_budget_exhausted" ? MESSAGES.merchantUnavailable : message);

/** The messages the customer signs, in order. */
export function signSteps(prepare: PrepareSessionResponse): SignStep[] {
  if (prepare.mode === "payment") {
    return [{ key: "payment", label: `Confirm payment of ${prepare.amount} USDT`, payload: prepare.typedData.payment }];
  }
  return [
    { key: "subscribe", label: "Approve the subscription", payload: prepare.typedData.subscribe },
    { key: "permit", label: `Allow charges up to ${prepare.spendingCap} USDT in total`, payload: prepare.typedData.permit },
  ];
}

function fromSessionStatus(session: PublicSession, signedIn: boolean): Phase {
  switch (session.status) {
    case "open":
      return signedIn ? payIdle(session) : { name: "review", session };
    case "processing":
      return { name: "processing", session, txHash: session.txHash, slow: false };
    case "complete":
      return { name: "closed", session, reason: "already_paid", message: MESSAGES.alreadyPaid };
    case "expired":
      return { name: "closed", session, reason: "expired", message: MESSAGES.expired };
  }
}

function sessionOf(phase: Phase): PublicSession | null {
  return phase.name === "loading" ? null : phase.session;
}

export function reducer(phase: Phase, action: Action): Phase {
  const session = sessionOf(phase);

  switch (action.type) {
    case "loaded":
      return fromSessionStatus(action.session, action.signedIn);

    case "load_failed":
      return {
        name: "closed",
        session: null,
        reason: action.code === "not_found" ? "not_found" : "error",
        message: action.code === "not_found" ? MESSAGES.notFound : action.message,
      };

    case "signed_in":
      return phase.name === "review" ? payIdle(phase.session) : phase;

    case "signed_out":
      return phase.name === "pay" || phase.name === "insufficient" ? { name: "review", session: phase.session } : phase;

    case "pay_started":
      if (phase.name !== "pay" && phase.name !== "insufficient") return phase;
      return { name: "pay", session: phase.session, busy: "preparing", step: null, notice: null };

    case "prepared": {
      if (phase.name !== "pay") return phase;
      const p = action.prepare;
      if (!p.sufficientBalance) return { name: "insufficient", session: phase.session, balance: p.balance, needed: p.amount };
      const steps = signSteps(p);
      return { ...phase, busy: "signing", step: { current: 1, total: steps.length, label: steps[0]!.label } };
    }

    case "sign_step":
      if (phase.name !== "pay") return phase;
      return { ...phase, busy: "signing", step: { current: action.current, total: action.total, label: action.label } };

    case "sign_rejected":
      return phase.name === "pay" ? payIdle(phase.session, MESSAGES.signRejected) : phase;

    case "submit_started":
      return phase.name === "pay" ? { ...phase, busy: "submitting", step: null } : phase;

    case "submitted":
      return phase.name === "pay" ? { name: "processing", session: phase.session, txHash: action.txHash, slow: false } : phase;

    case "slow":
      return phase.name === "processing" ? { ...phase, slow: true } : phase;

    case "status": {
      if (phase.name !== "processing") return phase;
      const s = action.status;
      if (s.status === "complete") return { name: "success", session: phase.session, status: s };
      if (s.status === "expired") return { name: "closed", session: phase.session, reason: "expired", message: MESSAGES.expired };
      if (s.status === "open") {
        return payIdle(phase.session, s.error ? customerMessage(s.error.code, s.error.message) : "The payment didn't go through. You haven't been charged. Please try again.");
      }
      return { ...phase, txHash: s.txHash ?? phase.txHash };
    }

    case "failed": {
      if (!session) return phase;
      if (action.code === "session_expired") return { name: "closed", session, reason: "expired", message: MESSAGES.expired };
      if (action.code === "session_not_open" || action.code === "order_already_paid") {
        return { name: "closed", session, reason: "already_paid", message: MESSAGES.alreadyPaid };
      }
      if (action.code === "not_found") return { name: "closed", session, reason: "not_found", message: MESSAGES.notFound };
      // Everything else is retryable from the pay screen.
      return payIdle(session, customerMessage(action.code, action.message));
    }

    case "expired_locally":
      if (phase.name === "review" || phase.name === "insufficient" || (phase.name === "pay" && phase.busy === null)) {
        return { name: "closed", session: phase.session, reason: "expired", message: MESSAGES.expired };
      }
      return phase;
  }
}
