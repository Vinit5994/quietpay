import { describe, expect, it } from "vitest";
import type { PrepareSessionResponse, PublicSession, SessionStatusResponse } from "@quietpay/shared";
import { MESSAGES, initialPhase, reducer, signSteps, type Phase } from "./machine";

const payer = "0x1111111111111111111111111111111111111111";
const USDT = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
const hash = (c: string) => `0x${c.repeat(64)}`;
const domain = { name: "Tether USD", version: "1", chainId: 1874, verifyingContract: USDT };

const paymentTd = {
  domain,
  types: { ReceiveWithAuthorization: [{ name: "value", type: "uint256" }] },
  primaryType: "ReceiveWithAuthorization" as const,
  message: { from: payer, to: payer, value: "25000000", validAfter: "0", validBefore: "1900000000", nonce: hash("a") },
};
const subscribeTd = {
  domain,
  types: { Subscribe: [{ name: "planId", type: "uint256" }] },
  primaryType: "Subscribe" as const,
  message: { planId: "1", subscriber: payer, maxAmount: "15000000", nonce: "0", deadline: "1900000000" },
};
const permitTd = {
  domain,
  types: { Permit: [{ name: "value", type: "uint256" }] },
  primaryType: "Permit" as const,
  message: { owner: payer, spender: payer, value: "180000000", nonce: "0", deadline: "1900000000" },
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
  successUrl: "http://localhost:3000/orders/1",
  cancelUrl: "http://localhost:3000/cart",
  paymentId: null,
  txHash: null,
  explorerUrl: null,
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  ...over,
});

const preparePayment = (sufficientBalance = true): PrepareSessionResponse => ({
  mode: "payment",
  payer,
  amount: "25.00",
  balance: sufficientBalance ? "100.00" : "4.00",
  sufficientBalance,
  typedData: { payment: paymentTd },
});
const prepareSub: PrepareSessionResponse = {
  mode: "subscription",
  payer,
  amount: "15.00",
  balance: "100.00",
  sufficientBalance: true,
  spendingCap: "180.00",
  typedData: { subscribe: subscribeTd, permit: permitTd },
};
const status = (s: SessionStatusResponse["status"], error: SessionStatusResponse["error"] = null): SessionStatusResponse => ({
  status: s,
  txHash: hash("a"),
  explorerUrl: null,
  paymentId: s === "complete" ? "pay_1" : null,
  subscriptionId: null,
  receiptUrl: s === "complete" ? "http://localhost:3001/r/pay_1" : null,
  redirectUrl: s === "complete" ? "http://localhost:3000/orders/1" : null,
  error,
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
      { type: "submitted", txHash: hash("b") },
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
      { type: "submitted", txHash: hash("b") },
      { type: "status", status: status("open", { code: "transaction_failed", message: "The payment was reverted." }) },
    ]);
    expect(p).toMatchObject({ name: "pay", busy: null, notice: "The payment was reverted." });
  });
  it("never shows merchant gas wording to the customer", () => {
    const paying = { name: "pay", session: session(), busy: "submitting", step: null, notice: null } as Phase;
    const p = reducer(paying, { type: "failed", code: "merchant_gas_budget_exhausted", message: "This merchant's gas budget is used up (0 WBT left)." });
    expect(p).toMatchObject({ name: "pay", notice: MESSAGES.merchantUnavailable });
    expect(JSON.stringify(p)).not.toMatch(/WBT|gas/);
  });
});
