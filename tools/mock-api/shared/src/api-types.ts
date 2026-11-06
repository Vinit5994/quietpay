/**
 * QuietPay API contract: zod schemas + TS types for every endpoint and webhook (docs/SPEC_API.md).
 * TEMPORARY copy (Person B) until Person A's packages/shared lands. Change rule: additive only.
 */
import { z } from "zod";

// ── Primitives ─────────────────────────────────────────────────────────────

/** API input amount: decimal string, max 2 decimals. */
export const AmountInput = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Use a number with at most 2 decimals, e.g. 25.00");
/** API output amount: decimal string ("25.00"). */
export const Amount = z.string().regex(/^-?\d+\.\d{2,6}$/);
export const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 0x address");
export const Hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
export const TxHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const IsoDate = z.string().datetime({ offset: true });
export const Currency = z.literal("USDT");

export const ApiErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const ErrorCode = z.enum([
  "bad_request",
  "unauthorized",
  "not_found",
  "session_expired",
  "session_not_open",
  "invalid_signature",
  "insufficient_balance",
  "amount_below_minimum",
  "rate_limited",
  "merchant_gas_budget_exhausted",
  "refund_exceeds_payment",
  "order_already_paid",
  "merchant_not_found",
  "internal_error",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const listOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ data: z.array(item), nextCursor: z.string().nullable() });

export const TypedDataPayload = z.object({
  domain: z.object({
    name: z.string(),
    version: z.string(),
    chainId: z.number().int(),
    verifyingContract: Address,
  }),
  types: z.record(z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: z.string(),
  /** uint values are decimal strings */
  message: z.record(z.string()),
});
export type TypedDataPayload = z.infer<typeof TypedDataPayload>;

// ── Shared objects ─────────────────────────────────────────────────────────

export const LineItemInput = z.object({
  name: z.string().min(1).max(120),
  unitAmount: AmountInput,
  quantity: z.number().int().min(1).max(99),
});
export const LineItem = z.object({
  name: z.string(),
  unitAmount: Amount,
  quantity: z.number().int(),
  amount: Amount,
});
export type LineItem = z.infer<typeof LineItem>;

export const SessionMode = z.enum(["payment", "subscription"]);
export const SessionStatus = z.enum(["open", "processing", "complete", "expired"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const PlanInterval = z.enum(["month", "week", "custom"]);
export const Plan = z.object({
  id: z.string(),
  name: z.string(),
  amount: Amount,
  currency: Currency,
  interval: PlanInterval,
  periodSeconds: z.number().int(),
  graceSeconds: z.number().int(),
  /** Human label, e.g. "every month" or "every 2 minutes (demo)" */
  intervalLabel: z.string(),
  active: z.boolean(),
  createdAt: IsoDate,
});
export type Plan = z.infer<typeof Plan>;

export const CheckoutSession = z.object({
  id: z.string(),
  mode: SessionMode,
  status: SessionStatus,
  url: z.string().url(),
  amount: Amount,
  currency: Currency,
  lineItems: z.array(LineItem),
  planId: z.string().nullable(),
  reference: z.string(),
  customerEmail: z.string().nullable(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  expiresAt: IsoDate,
  paymentId: z.string().nullable(),
  subscriptionId: z.string().nullable(),
  txHash: TxHash.nullable(),
  createdAt: IsoDate,
});
export type CheckoutSession = z.infer<typeof CheckoutSession>;

export const PaymentKind = z.enum(["checkout", "subscription"]);
export const PaymentStatus = z.enum(["paid", "partially_refunded", "refunded"]);
export const Payment = z.object({
  id: z.string(),
  kind: PaymentKind,
  status: PaymentStatus,
  reference: z.string(),
  payer: Address,
  amount: Amount,
  fee: Amount,
  refunded: Amount,
  net: Amount,
  refundable: Amount,
  txHash: TxHash,
  explorerUrl: z.string().url(),
  sessionId: z.string().nullable(),
  subscriptionId: z.string().nullable(),
  description: z.string(),
  paidAt: IsoDate,
});
export type Payment = z.infer<typeof Payment>;

export const SubscriptionStatus = z.enum(["active", "past_due", "canceled"]);
export const CancelReason = z.enum(["customer", "nonpayment", "merchant"]);
export const Subscription = z.object({
  id: z.string(),
  planId: z.string(),
  planName: z.string(),
  amount: Amount,
  subscriber: Address,
  customerEmail: z.string().nullable(),
  reference: z.string(),
  status: SubscriptionStatus,
  cycle: z.number().int(),
  failedAttempts: z.number().int(),
  nextChargeAt: IsoDate.nullable(),
  pastDueSince: IsoDate.nullable(),
  cancelReason: CancelReason.nullable(),
  createdAt: IsoDate,
});
export type Subscription = z.infer<typeof Subscription>;

export const RefundStatus = z.enum(["awaiting_signature", "submitted", "succeeded", "failed"]);
export const Refund = z.object({
  id: z.string(),
  paymentId: z.string(),
  amount: Amount,
  reason: z.string().nullable(),
  status: RefundStatus,
  txHash: TxHash.nullable(),
  error: z.string().nullable(),
  createdAt: IsoDate,
});
export type Refund = z.infer<typeof Refund>;

export const PaymentLink = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  amount: Amount,
  currency: Currency,
  url: z.string().url(),
  qrSvg: z.string(),
  active: z.boolean(),
  createdAt: IsoDate,
});
export type PaymentLink = z.infer<typeof PaymentLink>;

export const Merchant = z.object({
  id: z.string(),
  name: z.string(),
  payoutAddress: Address,
  onchainId: z.string().nullable(),
  webhookUrl: z.string().nullable(),
  secretKeyPrefix: z.string(),
  createdAt: IsoDate,
});
export type Merchant = z.infer<typeof Merchant>;

export const WebhookEventType = z.enum([
  "checkout.session.completed",
  "payment.succeeded",
  "refund.succeeded",
  "subscription.created",
  "subscription.renewed",
  "subscription.payment_failed",
  "subscription.canceled",
  "ping",
]);
export type WebhookEventType = z.infer<typeof WebhookEventType>;

export const WebhookDelivery = z.object({
  id: z.string(),
  eventId: z.string(),
  type: WebhookEventType,
  status: z.enum(["pending", "succeeded", "failed"]),
  attempts: z.number().int(),
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  payload: z.string(),
  createdAt: IsoDate,
});
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;

// ── Webhook events ─────────────────────────────────────────────────────────

const eventBase = { id: z.string(), createdAt: IsoDate };
const chainRef = { txHash: TxHash, explorerUrl: z.string().url() };

export const SessionCompletedData = z.object({
  sessionId: z.string(),
  merchantReference: z.string(),
  mode: SessionMode,
  amount: Amount,
  paymentId: z.string(),
  subscriptionId: z.string().nullable(),
  ...chainRef,
});
export const PaymentSucceededData = z.object({
  paymentId: z.string(),
  merchantReference: z.string(),
  kind: PaymentKind,
  amount: Amount,
  payer: Address,
  sessionId: z.string().nullable(),
  subscriptionId: z.string().nullable(),
  ...chainRef,
});
export const RefundSucceededData = z.object({
  refundId: z.string(),
  paymentId: z.string(),
  merchantReference: z.string(),
  amount: Amount,
  totalRefunded: Amount,
  ...chainRef,
});
export const SubscriptionEventData = z.object({
  subscriptionId: z.string(),
  merchantReference: z.string(),
  planId: z.string(),
  status: SubscriptionStatus,
  cycle: z.number().int(),
  amount: Amount,
  nextChargeAt: IsoDate.nullable(),
  cancelReason: CancelReason.nullable(),
  txHash: TxHash.nullable(),
  explorerUrl: z.string().url().nullable(),
});

export const WebhookEvent = z.discriminatedUnion("type", [
  z.object({ ...eventBase, type: z.literal("checkout.session.completed"), data: SessionCompletedData }),
  z.object({ ...eventBase, type: z.literal("payment.succeeded"), data: PaymentSucceededData }),
  z.object({ ...eventBase, type: z.literal("refund.succeeded"), data: RefundSucceededData }),
  z.object({ ...eventBase, type: z.literal("subscription.created"), data: SubscriptionEventData }),
  z.object({ ...eventBase, type: z.literal("subscription.renewed"), data: SubscriptionEventData }),
  z.object({ ...eventBase, type: z.literal("subscription.payment_failed"), data: SubscriptionEventData }),
  z.object({ ...eventBase, type: z.literal("subscription.canceled"), data: SubscriptionEventData }),
  z.object({ ...eventBase, type: z.literal("ping"), data: z.object({ message: z.string() }) }),
]);
export type WebhookEvent = z.infer<typeof WebhookEvent>;

/** Header: `QuietPay-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<rawBody>")>` */
export const WEBHOOK_SIGNATURE_HEADER = "quietpay-signature";

// ── Request / response bodies ──────────────────────────────────────────────

export const CreateCheckoutSessionBody = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("payment"),
    lineItems: z.array(LineItemInput).min(1).max(50),
    reference: z.string().min(1).max(200),
    customerEmail: z.string().email().optional(),
    successUrl: z.string().url(),
    cancelUrl: z.string().url(),
    expiresInSeconds: z.number().int().min(60).max(86_400).optional(),
  }),
  z.object({
    mode: z.literal("subscription"),
    planId: z.string(),
    reference: z.string().min(1).max(200),
    customerEmail: z.string().email().optional(),
    successUrl: z.string().url(),
    cancelUrl: z.string().url(),
  }),
]);
export type CreateCheckoutSessionBody = z.infer<typeof CreateCheckoutSessionBody>;

export const CreatePaymentLinkBody = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  amount: AmountInput,
});
export const CreatePlanBody = z.object({
  name: z.string().min(1).max(120),
  amount: AmountInput,
  interval: PlanInterval,
  periodSeconds: z.number().int().min(60).optional(),
  graceSeconds: z.number().int().min(0).optional(),
});
export const CreateRefundBody = z.object({
  paymentId: z.string(),
  amount: AmountInput,
  reason: z.string().max(200).optional(),
});
export const CreateRefundResponse = Refund.extend({ signUrl: z.string().url() });
export const PutWebhookEndpointBody = z.object({ url: z.string().url() });
export const PutWebhookEndpointResponse = z.object({ url: z.string().url(), secret: z.string() });

export const ListPaymentsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  reference: z.string().optional(),
});
export const ListSubscriptionsQuery = z.object({ status: SubscriptionStatus.optional() });

// Auth
export const AuthRole = z.enum(["merchant", "customer"]);
export const AuthNonceQuery = z.object({ address: Address });
export const AuthNonceResponse = z.object({ nonce: z.string(), message: z.string() });
export const AuthVerifyBody = z.object({ address: Address, signature: Hex, role: AuthRole });
export const AuthVerifyResponse = z.object({
  token: z.string(),
  role: AuthRole,
  address: Address,
  merchantId: z.string().nullable(),
});

// Dashboard
export const GasSummary = z.object({
  spentWbt: z.string(),
  budgetWbt: z.string(),
  remainingWbt: z.string(),
  txCount: z.number().int(),
});
export const DashOverview = z.object({
  volume24h: Amount,
  volume7d: Amount,
  mrr: Amount,
  activeSubscriptions: z.number().int(),
  pastDueSubscriptions: z.number().int(),
  refunded7d: Amount,
  paymentsCount: z.number().int(),
  gas: GasSummary,
  /** Customers never pay gas; always "0" */
  customerGasPaidWbt: z.literal("0"),
});
export const CreateMerchantBody = z.object({ name: z.string().min(1).max(80), payoutAddress: Address });
export const CreateMerchantResponse = z.object({
  merchant: Merchant,
  secretKey: z.string(),
  webhookSecret: z.string(),
});
export const RotateKeysResponse = z.object({ secretKey: z.string() });
export const RefundTypedDataResponse = z.object({ refund: Refund, toSign: TypedDataPayload });
export const SubmitSignatureBody = z.object({ signature: Hex });
export const GasTopupBody = z.object({ txHash: TxHash });

// Public: checkout
export const PublicSession = z.object({
  id: z.string(),
  mode: SessionMode,
  status: SessionStatus,
  merchant: z.object({ name: z.string() }),
  lineItems: z.array(LineItem),
  amount: Amount,
  currency: Currency,
  plan: z
    .object({
      id: z.string(),
      name: z.string(),
      amount: Amount,
      periodSeconds: z.number().int(),
      graceSeconds: z.number().int(),
      intervalLabel: z.string(),
    })
    .nullable(),
  expiresAt: IsoDate,
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  txHash: TxHash.nullable(),
  paymentId: z.string().nullable(),
});
export type PublicSession = z.infer<typeof PublicSession>;

export const PrepareBody = z.object({ payer: Address });
const prepareBase = {
  payer: Address,
  amount: Amount,
  balance: Amount,
  sufficientFunds: z.boolean(),
};
export const PrepareResponse = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("payment"),
    ...prepareBase,
    toSign: z.object({ payment: TypedDataPayload }),
  }),
  z.object({
    mode: z.literal("subscription"),
    ...prepareBase,
    /** Total the customer allows across `periods` charges, e.g. "180.00" */
    spendingCap: Amount,
    periods: z.number().int(),
    toSign: z.object({ subscribe: TypedDataPayload, permit: TypedDataPayload }),
  }),
]);
export type PrepareResponse = z.infer<typeof PrepareResponse>;

export const SubmitBody = z.object({
  payer: Address,
  signatures: z.object({
    payment: Hex.optional(),
    subscribe: Hex.optional(),
    permit: Hex.optional(),
  }),
});
export type SubmitBody = z.infer<typeof SubmitBody>;
export const SubmitResponse = z.object({ txHash: TxHash });

export const SessionStatusResponse = z.object({
  status: SessionStatus,
  txHash: TxHash.nullable(),
  paymentId: z.string().nullable(),
  subscriptionId: z.string().nullable(),
  receiptUrl: z.string().url().nullable(),
  redirectUrl: z.string().url().nullable(),
  explorerUrl: z.string().url().nullable(),
});
export type SessionStatusResponse = z.infer<typeof SessionStatusResponse>;

export const PublicLinkResponse = z.object({ sessionId: z.string(), sessionUrl: z.string().url() });

export const Receipt = z.object({
  paymentId: z.string(),
  merchant: z.object({ name: z.string() }),
  kind: PaymentKind,
  description: z.string(),
  lineItems: z.array(LineItem),
  amount: Amount,
  refunded: Amount,
  payer: Address,
  paidAt: IsoDate,
  txHash: TxHash,
  explorerUrl: z.string().url(),
  planName: z.string().nullable(),
});

export const PortalResponse = z.object({
  address: Address,
  subscriptions: z.array(Subscription.extend({ merchantName: z.string() })),
  payments: z.array(Payment.extend({ merchantName: z.string(), receiptUrl: z.string().url() })),
});
export const CancelPrepareResponse = z.object({ toSign: TypedDataPayload });

// Demo + health
export const DemoFundBody = z.object({ address: Address });
export const DemoFundResponse = z.object({ txHash: TxHash, amount: Amount });
export const HealthResponse = z.object({
  ok: z.boolean(),
  rpc: z.boolean(),
  relayerWbt: z.string(),
  indexerLagBlocks: z.number().int(),
});

// ── Endpoint map (used by the real API, the mock API and clients) ──────────

export type EndpointAuth = "secret" | "merchant" | "customer" | "public";
export interface EndpointDef {
  method: "GET" | "POST" | "PUT";
  path: string;
  auth: EndpointAuth;
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  response: z.ZodTypeAny;
  /** default "json" */
  responseType?: "json" | "csv";
}

const Empty = z.object({}).strict();
const Csv = z.string();

export const endpoints = {
  // Merchant API (secret key)
  createCheckoutSession: { method: "POST", path: "/v1/checkout/sessions", auth: "secret", body: CreateCheckoutSessionBody, response: CheckoutSession },
  getCheckoutSession: { method: "GET", path: "/v1/checkout/sessions/:id", auth: "secret", response: CheckoutSession },
  createPaymentLink: { method: "POST", path: "/v1/payment_links", auth: "secret", body: CreatePaymentLinkBody, response: PaymentLink },
  listPaymentLinks: { method: "GET", path: "/v1/payment_links", auth: "secret", response: listOf(PaymentLink) },
  createPlan: { method: "POST", path: "/v1/plans", auth: "secret", body: CreatePlanBody, response: Plan },
  listPlans: { method: "GET", path: "/v1/plans", auth: "secret", response: listOf(Plan) },
  listPayments: { method: "GET", path: "/v1/payments", auth: "secret", query: ListPaymentsQuery, response: listOf(Payment) },
  listSubscriptions: { method: "GET", path: "/v1/subscriptions", auth: "secret", query: ListSubscriptionsQuery, response: listOf(Subscription) },
  cancelSubscription: { method: "POST", path: "/v1/subscriptions/:id/cancel", auth: "secret", body: Empty, response: Subscription },
  createRefund: { method: "POST", path: "/v1/refunds", auth: "secret", body: CreateRefundBody, response: CreateRefundResponse },
  exportPaymentsCsv: { method: "GET", path: "/v1/exports/payments.csv", auth: "secret", response: Csv, responseType: "csv" },
  putWebhookEndpoint: { method: "PUT", path: "/v1/webhook_endpoint", auth: "secret", body: PutWebhookEndpointBody, response: PutWebhookEndpointResponse },
  testWebhookEndpoint: { method: "POST", path: "/v1/webhook_endpoint/test", auth: "secret", body: Empty, response: WebhookDelivery },

  // Wallet sign-in
  getAuthNonce: { method: "GET", path: "/auth/nonce", auth: "public", query: AuthNonceQuery, response: AuthNonceResponse },
  verifyAuth: { method: "POST", path: "/auth/verify", auth: "public", body: AuthVerifyBody, response: AuthVerifyResponse },

  // Merchant dashboard (merchant JWT)
  getDashMerchant: { method: "GET", path: "/dash/merchant", auth: "merchant", response: Merchant },
  createDashMerchant: { method: "POST", path: "/dash/merchant", auth: "merchant", body: CreateMerchantBody, response: CreateMerchantResponse },
  rotateKeys: { method: "POST", path: "/dash/keys/rotate", auth: "merchant", body: Empty, response: RotateKeysResponse },
  getDashOverview: { method: "GET", path: "/dash/overview", auth: "merchant", response: DashOverview },
  listDashPayments: { method: "GET", path: "/dash/payments", auth: "merchant", query: ListPaymentsQuery, response: listOf(Payment) },
  listDashSubscriptions: { method: "GET", path: "/dash/subscriptions", auth: "merchant", query: ListSubscriptionsQuery, response: listOf(Subscription) },
  cancelDashSubscription: { method: "POST", path: "/dash/subscriptions/:id/cancel", auth: "merchant", body: Empty, response: Subscription },
  listDashPlans: { method: "GET", path: "/dash/plans", auth: "merchant", response: listOf(Plan) },
  createDashPlan: { method: "POST", path: "/dash/plans", auth: "merchant", body: CreatePlanBody, response: Plan },
  listDashPaymentLinks: { method: "GET", path: "/dash/payment_links", auth: "merchant", response: listOf(PaymentLink) },
  createDashPaymentLink: { method: "POST", path: "/dash/payment_links", auth: "merchant", body: CreatePaymentLinkBody, response: PaymentLink },
  createDashRefund: { method: "POST", path: "/dash/refunds", auth: "merchant", body: CreateRefundBody, response: Refund },
  getRefundTypedData: { method: "POST", path: "/dash/refunds/:id/typed-data", auth: "merchant", body: Empty, response: RefundTypedDataResponse },
  submitRefund: { method: "POST", path: "/dash/refunds/:id/submit", auth: "merchant", body: SubmitSignatureBody, response: Refund },
  listWebhookDeliveries: { method: "GET", path: "/dash/webhooks/deliveries", auth: "merchant", response: listOf(WebhookDelivery) },
  putDashWebhookEndpoint: { method: "PUT", path: "/dash/webhook_endpoint", auth: "merchant", body: PutWebhookEndpointBody, response: PutWebhookEndpointResponse },
  testDashWebhookEndpoint: { method: "POST", path: "/dash/webhook_endpoint/test", auth: "merchant", body: Empty, response: WebhookDelivery },
  exportDashPaymentsCsv: { method: "GET", path: "/dash/exports/payments.csv", auth: "merchant", response: Csv, responseType: "csv" },
  recordGasTopup: { method: "POST", path: "/dash/gas/topup", auth: "merchant", body: GasTopupBody, response: GasSummary },

  // Public: checkout, links, receipts, portal
  getPublicSession: { method: "GET", path: "/public/sessions/:id", auth: "public", response: PublicSession },
  prepareSession: { method: "POST", path: "/public/sessions/:id/prepare", auth: "public", body: PrepareBody, response: PrepareResponse },
  submitSession: { method: "POST", path: "/public/sessions/:id/submit", auth: "public", body: SubmitBody, response: SubmitResponse },
  getSessionStatus: { method: "GET", path: "/public/sessions/:id/status", auth: "public", response: SessionStatusResponse },
  getPublicLink: { method: "GET", path: "/public/links/:slug", auth: "public", response: PublicLinkResponse },
  getReceipt: { method: "GET", path: "/public/receipts/:paymentId", auth: "public", response: Receipt },
  getPortal: { method: "GET", path: "/public/portal", auth: "customer", response: PortalResponse },
  prepareCancelSubscription: { method: "POST", path: "/public/portal/subscriptions/:id/cancel/prepare", auth: "customer", body: Empty, response: CancelPrepareResponse },
  submitCancelSubscription: { method: "POST", path: "/public/portal/subscriptions/:id/cancel/submit", auth: "customer", body: SubmitSignatureBody, response: Subscription },

  // Demo + health
  demoFund: { method: "POST", path: "/demo/fund", auth: "public", body: DemoFundBody, response: DemoFundResponse },
  health: { method: "GET", path: "/health", auth: "public", response: HealthResponse },
} as const satisfies Record<string, EndpointDef>;

export type Endpoints = typeof endpoints;
export type EndpointKey = keyof Endpoints;
export type ResponseOf<K extends EndpointKey> = z.infer<Endpoints[K]["response"]>;
export type BodyOf<K extends EndpointKey> = Endpoints[K] extends { body: infer B extends z.ZodTypeAny } ? z.input<B> : never;
export type QueryOf<K extends EndpointKey> = Endpoints[K] extends { query: infer Q extends z.ZodTypeAny } ? z.input<Q> : never;
