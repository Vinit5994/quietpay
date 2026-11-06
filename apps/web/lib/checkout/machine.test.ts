import { describe, expect, it } from "vitest";
import type { PrepareResponse, PublicSession, SessionStatusResponse, TypedDataPayload } from "@quietpay/shared";
import { MESSAGES, initialPhase, reducer, signSteps, type Phase } from "./machine";

const td: TypedDataPayload = {
  domain: { name: "Tether USD", version: "1", chainId: 1874, verifyingContract: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7" },
  types: { X: [{ name: "a", type: "uint256" }] },
  primaryType: "X",
  message: { a: "1" },
};

const session = (over: Partial<PublicSession> = {}): PublicSession => ({
  id: "sess_1",
  mode: "payment",
  status: "open",
  merchant: { name: "Swag Counter" },
  lineItems: [{ name: "Builder Hoodie", unitAmount: "25.00", quantity: 1, amount: "25.00" }],
  amount: "25.00",
  currency: "USDT",
  plan: null,
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  successUrl: "http://localhost:3000/orders/1",
  cancelUrl: "http://localhost:3000/cart",
  txHash: null,
  paymentId: null,
  ...over,
});

const payer = "0x1111111111111111111111111111111111111111";
const preparePayment = (sufficientFunds = true): PrepareResponse => ({
  mode: "payment",
  payer,
  amount: "25.00",
  balance: sufficientFunds ? "100.00" : "4.00",
  sufficientFunds,
  toSign: { payment: td },
});
const prepareSub: PrepareResponse = {
  mode: "subscription",
  payer,
  amount: "15.00",
  balance: "100.00",
  sufficientFunds: true,
  spendingCap: "180.00",
  periods: 12,
  toSign: { subscribe: td, permit: td },
};
const status = (s: SessionStatusResponse["status"]): SessionStatusResponse => ({
  status: s,
  txHash: "0x" + "a".repeat(64),
  paymentId: s === "complete" ? "pay_1" : null,
  subscriptionId: null,
  receiptUrl: s === "complete" ? "http://localhost:3001/r/pay_1" : null,
  redirectUrl: s === "complete" ? "http://localhost:3000/orders/1" : null,
  explorerUrl: null,
});

const run = (actions: Parameters<typeof reducer>[1][], from: Phase = initialPhase) => actions.reduce(reducer, from);

describe("checkout machine", () => {
  it("open session: review when signed out, pay when signed in", () => {
    expect(run([{ type: "loaded", session: session(), signedIn: false }]).name).toBe("review");
    expect(run([{ type: "loaded", session: session(), signedIn: true }]).name).toBe("pay");
  });

  it("maps session status on load", () => {
    expect(run([{ type: "loaded", session: session({ status: "expired" }), signedIn: true }])).toMatchObject({ name: "closed", reason: "expired" });
    expect(run([{ type: "loaded", session: session({ status: "complete" }), signedIn: true }])).toMatchObject({ name: "closed", reason: "already_paid" });
    expect(run([{ type: "loaded", session: session({ status: "processing" }), signedIn: true }]).name).toBe("processing");
  });

  it("unknown session closes as not found", () => {
    expect(run([{ type: "load_failed", code: "not_found", message: "x" }])).toMatchObject({ name: "closed", reason: "not_found", message: MESSAGES.notFound });
  });

  it("signing in moves review to pay", () => {
    expect(run([{ type: "loaded", session: session(), signedIn: false }, { type: "signed_in" }]).name).toBe("pay");
  });

  it("happy path: pay, prepare, sign, submit, processing, success", () => {
    const p = run([
      { type: "loaded", session: session(), signedIn: true },
      { type: "pay_started" },
      { type: "prepared", prepare: preparePayment() },
      { type: "submit_started" },
      { type: "submitted", txHash: "0x" + "b".repeat(64) },
      { type: "status", status: status("processing") },
      { type: "status", status: status("complete") },
    ]);
    expect(p.name).toBe("success");
  });

  it("not enough funds goes to insufficient, and Check again re-prepares", () => {
    const p = run([{ type: "loaded", session: session(), signedIn: true }, { type: "pay_started" }, { type: "prepared", prepare: preparePayment(false) }]);
    expect(p).toMatchObject({ name: "insufficient", balance: "4.00", needed: "25.00" });
    expect(reducer(p, { type: "pay_started" })).toMatchObject({ name: "pay", busy: "preparing" });
  });

  it("closing the signature request returns to pay with a notice", () => {
    const p = run([
      { type: "loaded", session: session(), signedIn: true },
      { type: "pay_started" },
      { type: "prepared", prepare: preparePayment() },
      { type: "sign_rejected" },
    ]);
    expect(p).toMatchObject({ name: "pay", busy: null, notice: MESSAGES.signRejected });
  });

  it("subscriptions sign two messages", () => {
    expect(signSteps(prepareSub).map((s) => s.key)).toEqual(["subscribe", "permit"]);
    const p = run([{ type: "loaded", session: session({ mode: "subscription" }), signedIn: true }, { type: "pay_started" }, { type: "prepared", prepare: prepareSub }]);
    expect(p).toMatchObject({ name: "pay", busy: "signing", step: { current: 1, total: 2 } });
  });

  it("maps API errors", () => {
    const paying = run([{ type: "loaded", session: session(), signedIn: true }, { type: "pay_started" }]);
    expect(reducer(paying, { type: "failed", code: "session_expired", message: "" })).toMatchObject({ name: "closed", reason: "expired" });
    expect(reducer(paying, { type: "failed", code: "session_not_open", message: "" })).toMatchObject({ name: "closed", reason: "already_paid" });
    expect(reducer(paying, { type: "failed", code: "rate_limited", message: "Slow down" })).toMatchObject({ name: "pay", busy: null, notice: "Slow down" });
  });

  it("expires locally only while the customer isn't mid-payment", () => {
    const idle = run([{ type: "loaded", session: session(), signedIn: true }]);
    expect(reducer(idle, { type: "expired_locally" })).toMatchObject({ name: "closed", reason: "expired" });
    const signing = run([{ type: "loaded", session: session(), signedIn: true }, { type: "pay_started" }, { type: "prepared", prepare: preparePayment() }]);
    expect(reducer(signing, { type: "expired_locally" }).name).toBe("pay");
  });

  it("a payment that reverts back to open returns to pay with a notice", () => {
    const p = run([
      { type: "loaded", session: session(), signedIn: true },
      { type: "pay_started" },
      { type: "prepared", prepare: preparePayment() },
      { type: "submit_started" },
      { type: "submitted", txHash: "0x" + "b".repeat(64) },
      { type: "status", status: status("open") },
    ]);
    expect(p).toMatchObject({ name: "pay", busy: null });
  });
});
