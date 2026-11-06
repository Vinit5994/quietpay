import { describe, expect, it } from "vitest";
import {
  CreateCheckoutSessionRequest,
  CreatePlanRequest,
  Endpoints,
  ErrorEnvelope,
  PrepareSessionResponse,
  WEBHOOK_EVENT_TYPES,
  WebhookEvent,
} from "../src/api-types";

// Every route in docs/SPEC_API.md. If you add one to the spec, add it here and to Endpoints.
const SPEC_ROUTES = [
  "GET /auth/nonce",
  "POST /auth/verify",
  "POST /v1/checkout/sessions",
  "GET /v1/checkout/sessions/:id",
  "POST /v1/payment_links",
  "GET /v1/payment_links",
  "POST /v1/plans",
  "GET /v1/plans",
  "GET /v1/payments",
  "GET /v1/subscriptions",
  "POST /v1/subscriptions/:id/cancel",
  "POST /v1/refunds",
  "GET /v1/exports/payments.csv",
  "PUT /v1/webhook_endpoint",
  "POST /v1/webhook_endpoint/test",
  "GET /dash/overview",
  "GET /dash/payments",
  "GET /dash/subscriptions",
  "GET /dash/webhooks/deliveries",
  "POST /dash/refunds/:id/typed-data",
  "POST /dash/refunds/:id/submit",
  "POST /dash/merchant",
  "POST /dash/keys/rotate",
  "POST /dash/gas/topup",
  "GET /public/sessions/:id",
  "POST /public/sessions/:id/prepare",
  "POST /public/sessions/:id/submit",
  "GET /public/sessions/:id/status",
  "GET /public/links/:slug",
  "GET /public/receipts/:paymentId",
  "GET /public/portal",
  "POST /public/portal/subscriptions/:id/cancel/prepare",
  "POST /public/portal/subscriptions/:id/cancel/submit",
  "POST /demo/fund",
  "GET /health",
];

const routes = Object.values(Endpoints).map((e) => `${e.method} ${e.path}`);

describe("Endpoints map", () => {
  it("covers every route in SPEC_API", () => {
    for (const r of SPEC_ROUTES) expect(routes, r).toContain(r);
  });

  it("has no duplicate routes", () => {
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("declares params for every path with :placeholders", () => {
    for (const [name, e] of Object.entries(Endpoints)) {
      if (e.path.includes("/:")) expect("params" in e, name).toBe(true);
    }
  });
});

const ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const HASH = `0x${"ab".repeat(32)}`;

describe("request schemas", () => {
  it("accepts a payment session and rejects 3-decimal amounts", () => {
    const ok = {
      mode: "payment",
      reference: "ord_1",
      lineItems: [{ name: "Builder Hoodie", unitAmount: "25.00", quantity: 1 }],
      successUrl: "http://localhost:3000/orders/ord_1",
      cancelUrl: "http://localhost:3000/cart",
    };
    expect(CreateCheckoutSessionRequest.safeParse(ok).success).toBe(true);
    const bad = { ...ok, lineItems: [{ name: "x", unitAmount: "25.001", quantity: 1 }] };
    expect(CreateCheckoutSessionRequest.safeParse(bad).success).toBe(false);
  });

  it("accepts a subscription session", () => {
    expect(
      CreateCheckoutSessionRequest.safeParse({
        mode: "subscription",
        planId: "plan_box",
        reference: "box_1",
        successUrl: "http://localhost:3000/box",
        cancelUrl: "http://localhost:3000/box",
      }).success,
    ).toBe(true);
  });

  it("requires periodSeconds for custom plans", () => {
    expect(CreatePlanRequest.safeParse({ name: "Box", amount: "15.00", interval: "custom" }).success).toBe(false);
    expect(
      CreatePlanRequest.safeParse({ name: "Box", amount: "15.00", interval: "custom", periodSeconds: 120 }).success,
    ).toBe(true);
  });
});

describe("response + webhook schemas", () => {
  it("parses the error envelope", () => {
    expect(ErrorEnvelope.parse({ error: { code: "session_expired", message: "Expired" } }).error.code).toBe(
      "session_expired",
    );
  });

  it("parses a payment prepare response", () => {
    const res = PrepareSessionResponse.parse({
      mode: "payment",
      payer: ADDR,
      amount: "37.00",
      balance: "50.00",
      sufficientBalance: true,
      typedData: {
        payment: {
          domain: { name: "Tether USD", version: "1", chainId: 1874, verifyingContract: ADDR },
          types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }] },
          primaryType: "ReceiveWithAuthorization",
          message: { from: ADDR, to: ADDR, value: "37000000", validAfter: "0", validBefore: "1900000000", nonce: HASH },
        },
      },
    });
    expect(res.mode).toBe("payment");
  });

  it("parses every webhook type", () => {
    const now = "2026-11-06T10:00:00.000Z";
    const sub = {
      merchantReference: "box_1",
      txHash: HASH,
      explorerUrl: `https://explorer.testnet.whitechain.io/tx/${HASH}`,
      subscriptionId: "sub_1",
      planId: "plan_box",
      subscriberAddress: ADDR,
      status: "active",
      cycle: 0,
      amount: "15.00",
      nextChargeAt: now,
      pastDueSince: null,
      cancelReason: null,
      paymentId: "pay_1",
      attemptedCycle: null,
    };
    const data: Record<string, unknown> = {
      "checkout.session.completed": {
        merchantReference: "ord_1",
        txHash: HASH,
        explorerUrl: sub.explorerUrl,
        sessionId: "sess_1",
        mode: "payment",
        paymentId: "pay_1",
        subscriptionId: null,
        payerAddress: ADDR,
        amount: "37.00",
      },
      "payment.succeeded": {
        merchantReference: "ord_1",
        txHash: HASH,
        explorerUrl: sub.explorerUrl,
        paymentId: "pay_1",
        kind: "checkout",
        sessionId: "sess_1",
        subscriptionId: null,
        payerAddress: ADDR,
        amount: "37.00",
        fee: "0.00",
        net: "37.00",
        paidAt: now,
      },
      "refund.succeeded": {
        merchantReference: "ord_1",
        txHash: HASH,
        explorerUrl: sub.explorerUrl,
        refundId: "re_1",
        paymentId: "pay_1",
        amount: "8.00",
        totalRefunded: "8.00",
        paymentAmount: "25.00",
        fullyRefunded: false,
      },
      "subscription.created": sub,
      "subscription.renewed": { ...sub, cycle: 1 },
      "subscription.payment_failed": { ...sub, status: "past_due", pastDueSince: now, paymentId: null, attemptedCycle: 2 },
      "subscription.canceled": { ...sub, status: "canceled", cancelReason: "nonpayment", paymentId: null },
      ping: { merchantReference: null, txHash: null, explorerUrl: null, message: "Hello from QuietPay" },
    };
    for (const type of WEBHOOK_EVENT_TYPES) {
      const r = WebhookEvent.safeParse({ id: "evt_1", type, createdAt: now, data: data[type] });
      expect(r.success, `${type}: ${r.error?.message}`).toBe(true);
    }
  });
});
