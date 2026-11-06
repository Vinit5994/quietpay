/**
 * QuietPay HTTP contract: zod schemas + TS types for every endpoint and webhook in docs/SPEC_API.md.
 *
 * The real API (apps/api) and the mock API (tools/mock-api) both validate requests AND responses
 * against these schemas, so the frontend can build against the mock and switch to the real API.
 *
 * Change rule (WORK_SPLIT §7): additive only. Renames/removals need an x/ PR approved by Person B.
 *
 * Conventions
 * - Amounts are decimal strings in USDT. Inputs: max 2 decimals ("25.00"). Outputs: 2–6 decimals ("0.005" fees).
 * - Timestamps are ISO-8601 strings (UTC). On-chain integers (ids, nonces, wei) are decimal strings.
 * - Nullable fields are always present (null), never omitted, unless marked optional.
 * - `/v1/*` accepts either a merchant secret key (`Bearer sk_test_…`, the SDK) or a merchant dashboard
 *   JWT (`Bearer <jwt>`), so the dashboard reuses /v1 for plans, links, refunds, CSV and webhook settings.
 */
import { z } from "zod";

// ================================================================ primitives

export const AmountInput = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Use a decimal USDT amount with at most 2 decimals, e.g. "25.00"');
export const Amount = z.string().regex(/^-?\d+\.\d{2,6}$/, "USDT amount, 2–6 decimals");
export const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "0x address");
export const Hex = z.string().regex(/^0x[0-9a-fA-F]*$/, "0x hex");
export const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "0x bytes32");
export const TxHash = Bytes32;
export const Signature = z.string().regex(/^0x[0-9a-fA-F]{130,}$/, "0x signature");
export const UintString = z.string().regex(/^\d+$/, "unsigned integer as decimal string");
export const IsoDate = z.iso.datetime({ offset: true });
export const Url = z.url();

const prefixed = (prefix: string) => z.string().startsWith(prefix);
export const SessionId = prefixed("sess_");
export const PaymentId = prefixed("pay_");
export const SubscriptionId = prefixed("sub_");
export const PlanId = prefixed("plan_");
export const PaymentLinkId = prefixed("link_");
export const RefundId = prefixed("re_");
export const EventId = prefixed("evt_");
export const MerchantId = prefixed("mer_");
export const DeliveryId = prefixed("whd_");

/** List responses. `nextCursor` is null on the last page. */
export const listOf = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), nextCursor: z.string().nullable() });

export const ListQuery = z.object({
  limit: z.coerce.number<string | number>().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const IdParams = z.object({ id: z.string() });

// ================================================================ errors

export const ErrorCodes = [
  // generic
  "bad_request",
  "validation_failed",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "internal_error",
  // checkout / relayer
  "session_expired",
  "session_not_open",
  "invalid_signature",
  "insufficient_balance",
  "insufficient_allowance",
  "amount_below_minimum",
  "merchant_gas_budget_exhausted",
  "simulation_failed",
  "transaction_failed",
  // refunds / subscriptions
  "refund_exceeds_payment",
  "plan_inactive",
  "subscription_not_active",
  // demo
  "demo_disabled",
  "demo_fund_cooldown",
  // decoded contract errors (QuietPay custom errors, snake_case)
  "merchant_inactive",
  "invoice_expired",
  "order_already_paid",
  "invalid_merchant_signature",
  "unknown_payment",
  "plan_above_max",
  "signature_expired",
  "invalid_subscriber_signature",
  "not_chargeable",
  "not_due",
  "not_operator",
  "fee_too_high",
  "invalid_amount",
  "enforced_pause",
] as const;
export const ErrorCode = z.enum(ErrorCodes);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** `{ error: { code, message } }` with HTTP 400/401/402/404/409/422/429/500. `code` may be a new value; treat unknown codes as generic. */
export const ErrorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

// ================================================================ shared objects

export const SessionMode = z.enum(["payment", "subscription"]);
export const SessionStatus = z.enum(["open", "processing", "complete", "expired"]);
export const PaymentKind = z.enum(["checkout", "subscription"]);
/** Dashboard chip: Paid / Partially refunded / Refunded. */
export const PaymentStatus = z.enum(["paid", "partially_refunded", "refunded"]);
export const SubscriptionStatus = z.enum(["active", "past_due", "canceled"]);
export const CancelReason = z.enum(["customer", "nonpayment", "merchant"]);
export const RefundStatus = z.enum(["awaiting_signature", "submitted", "succeeded", "failed"]);
export const PlanInterval = z.enum(["month", "week", "custom"]);
export const DeliveryStatus = z.enum(["pending", "succeeded", "failed"]);

export const LineItemInput = z.object({
  name: z.string().min(1).max(200),
  unitAmount: AmountInput,
  quantity: z.number().int().min(1).max(1000),
});

export const LineItem = z.object({
  name: z.string(),
  unitAmount: Amount,
  quantity: z.number().int(),
  /** unitAmount × quantity */
  amount: Amount,
});
export type LineItem = z.infer<typeof LineItem>;

export const CheckoutSession = z.object({
  id: SessionId,
  mode: SessionMode,
  status: SessionStatus,
  /** Hosted checkout URL: `${PUBLIC_WEB_URL}/c/${id}` */
  url: Url,
  amount: Amount,
  currency: z.literal("USDT"),
  lineItems: z.array(LineItem),
  planId: PlanId.nullable(),
  reference: z.string(),
  customerEmail: z.string().nullable(),
  successUrl: Url,
  cancelUrl: Url,
  paymentLinkId: PaymentLinkId.nullable(),
  payerAddress: Address.nullable(),
  paymentId: PaymentId.nullable(),
  subscriptionId: SubscriptionId.nullable(),
  txHash: TxHash.nullable(),
  expiresAt: IsoDate,
  createdAt: IsoDate,
});
export type CheckoutSession = z.infer<typeof CheckoutSession>;

export const PaymentLink = z.object({
  id: PaymentLinkId,
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  amount: Amount,
  active: z.boolean(),
  /** Public URL: `${PUBLIC_WEB_URL}/l/${slug}` */
  url: Url,
  createdAt: IsoDate,
});
export type PaymentLink = z.infer<typeof PaymentLink>;

export const Plan = z.object({
  id: PlanId,
  onchainPlanId: UintString,
  name: z.string(),
  amount: Amount,
  interval: PlanInterval,
  periodSeconds: z.number().int(),
  graceSeconds: z.number().int(),
  active: z.boolean(),
  createdAt: IsoDate,
});
export type Plan = z.infer<typeof Plan>;

export const Payment = z.object({
  id: PaymentId,
  /** bytes32 paymentId on-chain */
  onchainPaymentId: Bytes32,
  kind: PaymentKind,
  status: PaymentStatus,
  sessionId: SessionId.nullable(),
  subscriptionId: SubscriptionId.nullable(),
  reference: z.string().nullable(),
  customerEmail: z.string().nullable(),
  payerAddress: Address,
  amount: Amount,
  fee: Amount,
  refunded: Amount,
  /** amount − fee − refunded */
  net: Amount,
  /** amount − refunded (what the Refund modal may still refund) */
  refundable: Amount,
  txHash: TxHash,
  explorerUrl: Url,
  blockNumber: UintString,
  paidAt: IsoDate,
});
export type Payment = z.infer<typeof Payment>;

export const Subscription = z.object({
  id: SubscriptionId,
  onchainSubId: UintString,
  planId: PlanId,
  planName: z.string(),
  amount: Amount,
  periodSeconds: z.number().int(),
  graceSeconds: z.number().int(),
  subscriberAddress: Address,
  customerEmail: z.string().nullable(),
  reference: z.string().nullable(),
  status: SubscriptionStatus,
  /** 0 after the first charge, +1 per renewal */
  cycle: z.number().int(),
  nextChargeAt: IsoDate.nullable(),
  pastDueSince: IsoDate.nullable(),
  /** RenewalFailed count since the last successful charge */
  failedAttempts: z.number().int(),
  cancelReason: CancelReason.nullable(),
  createdAt: IsoDate,
});
export type Subscription = z.infer<typeof Subscription>;

export const Refund = z.object({
  id: RefundId,
  paymentId: PaymentId,
  amount: Amount,
  reason: z.string().nullable(),
  status: RefundStatus,
  /** on-chain refund sequence (refundCount at signing time); null until typed data is built */
  seq: z.number().int().nullable(),
  txHash: TxHash.nullable(),
  explorerUrl: Url.nullable(),
  error: z.string().nullable(),
  createdAt: IsoDate,
});
export type Refund = z.infer<typeof Refund>;

export const Merchant = z.object({
  id: MerchantId,
  name: z.string(),
  onchainId: UintString,
  payoutAddress: Address,
  signerAddress: Address,
  /** e.g. "sk_test_ab12" — the full key is only shown once */
  secretKeyPrefix: z.string(),
  webhookUrl: Url.nullable(),
  createdAt: IsoDate,
});
export type Merchant = z.infer<typeof Merchant>;

export const GasSummary = z.object({
  budgetWei: UintString,
  spentWei: UintString,
  remainingWei: UintString,
  /** WBT decimal strings for display, e.g. "0.004" */
  budget: z.string(),
  spent: z.string(),
  remaining: z.string(),
  txCount: z.number().int(),
});
export type GasSummary = z.infer<typeof GasSummary>;

// ================================================================ EIP-712 typed data over HTTP
// Every uint is a decimal string. The frontend passes these objects straight to signTypedData.

export const TypedDataDomain = z.object({
  name: z.string(),
  version: z.string(),
  chainId: z.number().int(),
  verifyingContract: Address,
});

const TypeField = z.object({ name: z.string(), type: z.string() });

const typedData = <P extends string, M extends z.ZodRawShape>(primaryType: P, message: M) =>
  z.object({
    domain: TypedDataDomain,
    types: z.record(z.string(), z.array(TypeField)),
    primaryType: z.literal(primaryType),
    message: z.object(message),
  });

export const ReceiveWithAuthorizationTypedData = typedData("ReceiveWithAuthorization", {
  from: Address,
  to: Address,
  value: UintString,
  validAfter: UintString,
  validBefore: UintString,
  nonce: Bytes32,
});
export type ReceiveWithAuthorizationTypedData = z.infer<typeof ReceiveWithAuthorizationTypedData>;

export const PermitTypedData = typedData("Permit", {
  owner: Address,
  spender: Address,
  value: UintString,
  nonce: UintString,
  deadline: UintString,
});
export type PermitTypedData = z.infer<typeof PermitTypedData>;

export const SubscribeTypedData = typedData("Subscribe", {
  planId: UintString,
  subscriber: Address,
  maxAmount: UintString,
  nonce: UintString,
  deadline: UintString,
});
export type SubscribeTypedData = z.infer<typeof SubscribeTypedData>;

export const CancelSubscriptionTypedData = typedData("CancelSubscription", {
  subId: UintString,
  nonce: UintString,
  deadline: UintString,
});
export type CancelSubscriptionTypedData = z.infer<typeof CancelSubscriptionTypedData>;

// ================================================================ auth (wallet sign-in)

export const AuthRole = z.enum(["merchant", "customer"]);

export const AuthNonceQuery = z.object({ address: Address });
/** Sign `message` (exactly `"Sign in to QuietPay\nNonce: <nonce>"`) with personal_sign. */
export const AuthNonceResponse = z.object({ nonce: z.string(), message: z.string(), expiresAt: IsoDate });

export const AuthVerifyRequest = z.object({ address: Address, signature: Hex, role: AuthRole });
export const AuthVerifyResponse = z.object({
  token: z.string(),
  role: AuthRole,
  address: Address,
  /** merchant role only: null until onboarding (POST /dash/merchant) is done */
  merchantId: MerchantId.nullable(),
  expiresAt: IsoDate,
});

// ================================================================ merchant API (/v1)

const sessionCommon = {
  reference: z.string().min(1).max(200),
  customerEmail: z.email().optional(),
  successUrl: Url,
  cancelUrl: Url,
};

export const CreateCheckoutSessionRequest = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("payment"),
    lineItems: z.array(LineItemInput).min(1).max(50),
    expiresInSeconds: z.number().int().min(60).max(86_400).optional(),
    ...sessionCommon,
  }),
  z.object({
    mode: z.literal("subscription"),
    planId: PlanId,
    ...sessionCommon,
  }),
]);
export type CreateCheckoutSessionParams = z.input<typeof CreateCheckoutSessionRequest>;

export const CreateCheckoutSessionResponse = CheckoutSession;

export const CreatePaymentLinkRequest = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  amount: AmountInput,
});
export type CreatePaymentLinkParams = z.input<typeof CreatePaymentLinkRequest>;
export const CreatePaymentLinkResponse = PaymentLink.extend({ qrSvg: z.string() });
export type CreatedPaymentLink = z.infer<typeof CreatePaymentLinkResponse>;

export const CreatePlanRequest = z
  .object({
    name: z.string().min(1).max(200),
    amount: AmountInput,
    interval: PlanInterval,
    periodSeconds: z.number().int().min(60).optional(),
    /** default 3 days (demo: 60) */
    graceSeconds: z.number().int().min(0).optional(),
  })
  .refine((p) => p.interval !== "custom" || p.periodSeconds !== undefined, {
    message: 'periodSeconds is required when interval is "custom"',
    path: ["periodSeconds"],
  });
export type CreatePlanParams = z.input<typeof CreatePlanRequest>;

export const ListPaymentsQuery = ListQuery.extend({ reference: z.string().optional() });
export type ListPaymentsParams = z.input<typeof ListPaymentsQuery>;

export const ListSubscriptionsQuery = ListQuery.extend({ status: SubscriptionStatus.optional() });
export type ListSubscriptionsParams = z.input<typeof ListSubscriptionsQuery>;

export const CreateRefundRequest = z.object({
  paymentId: PaymentId,
  amount: AmountInput,
  reason: z.string().max(500).optional(),
});
export type CreateRefundParams = z.input<typeof CreateRefundRequest>;
/** The payout wallet must sign it in the dashboard at `signUrl`. */
export const CreateRefundResponse = Refund.extend({ signUrl: Url });
export type CreatedRefund = z.infer<typeof CreateRefundResponse>;

/** Columns: date,payment_id,kind,reference,payer,amount,fee,refunded,net,tx_hash,explorer_url */
export const PAYMENTS_CSV_COLUMNS = [
  "date",
  "payment_id",
  "kind",
  "reference",
  "payer",
  "amount",
  "fee",
  "refunded",
  "net",
  "tx_hash",
  "explorer_url",
] as const;

export const UpdateWebhookEndpointRequest = z.object({ url: Url });
export type UpdateWebhookEndpointParams = z.input<typeof UpdateWebhookEndpointRequest>;
/** `secret` is returned once, on every PUT (it rotates). */
export const UpdateWebhookEndpointResponse = z.object({ url: Url, secret: z.string() });

// ================================================================ webhooks

const base = {
  /** The merchant's `reference` from the session / subscription (null for ping). */
  merchantReference: z.string().nullable(),
  txHash: TxHash.nullable(),
  explorerUrl: Url.nullable(),
};

export const PaymentSucceededData = z.object({
  ...base,
  paymentId: PaymentId,
  kind: PaymentKind,
  sessionId: SessionId.nullable(),
  subscriptionId: SubscriptionId.nullable(),
  payerAddress: Address,
  amount: Amount,
  fee: Amount,
  net: Amount,
  paidAt: IsoDate,
});

export const CheckoutSessionCompletedData = z.object({
  ...base,
  sessionId: SessionId,
  mode: SessionMode,
  paymentId: PaymentId,
  subscriptionId: SubscriptionId.nullable(),
  payerAddress: Address,
  amount: Amount,
});

export const RefundSucceededData = z.object({
  ...base,
  refundId: RefundId,
  paymentId: PaymentId,
  /** this refund */
  amount: Amount,
  /** sum of all refunds on the payment */
  totalRefunded: Amount,
  paymentAmount: Amount,
  fullyRefunded: z.boolean(),
});

/** Same shape for subscription.created / renewed / payment_failed / canceled. */
export const SubscriptionEventData = z.object({
  ...base,
  subscriptionId: SubscriptionId,
  planId: PlanId,
  subscriberAddress: Address,
  status: SubscriptionStatus,
  cycle: z.number().int(),
  amount: Amount,
  nextChargeAt: IsoDate.nullable(),
  pastDueSince: IsoDate.nullable(),
  cancelReason: CancelReason.nullable(),
  /** subscription.created / subscription.renewed: the charge's payment */
  paymentId: PaymentId.nullable(),
  /** subscription.payment_failed: the cycle that could not be charged */
  attemptedCycle: z.number().int().nullable(),
});

export const PingData = z.object({ ...base, message: z.string() });

const event = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.object({ id: EventId, type: z.literal(type), createdAt: IsoDate, data });

export const WebhookEvent = z.discriminatedUnion("type", [
  event("checkout.session.completed", CheckoutSessionCompletedData),
  event("payment.succeeded", PaymentSucceededData),
  event("refund.succeeded", RefundSucceededData),
  event("subscription.created", SubscriptionEventData),
  event("subscription.renewed", SubscriptionEventData),
  event("subscription.payment_failed", SubscriptionEventData),
  event("subscription.canceled", SubscriptionEventData),
  event("ping", PingData),
]);
export type WebhookEvent = z.infer<typeof WebhookEvent>;
export type WebhookEventType = WebhookEvent["type"];
export const WEBHOOK_EVENT_TYPES = [
  "checkout.session.completed",
  "payment.succeeded",
  "refund.succeeded",
  "subscription.created",
  "subscription.renewed",
  "subscription.payment_failed",
  "subscription.canceled",
  "ping",
] as const satisfies readonly WebhookEventType[];

/** Header name (case-insensitive): `QuietPay-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<rawBody>")>` */
export const WEBHOOK_SIGNATURE_HEADER = "QuietPay-Signature";
export const WEBHOOK_TOLERANCE_SECONDS = 300;
/** Retry delays after the first attempt fails (5 attempts total). */
export const WEBHOOK_RETRY_DELAYS_SECONDS = [1, 5, 30, 120, 600] as const;

export const WebhookDelivery = z.object({
  id: DeliveryId,
  eventId: EventId,
  type: z.enum(WEBHOOK_EVENT_TYPES),
  status: DeliveryStatus,
  attempts: z.number().int(),
  nextAttemptAt: IsoDate.nullable(),
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  url: Url,
  payload: WebhookEvent,
  createdAt: IsoDate,
});
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;

// ================================================================ dashboard (/dash, merchant JWT)

export const DashOverviewResponse = z.object({
  volume24h: Amount,
  volume7d: Amount,
  /** monthly recurring revenue from active subscriptions, normalized to 30 days */
  mrr: Amount,
  activeSubscriptions: z.number().int(),
  pastDueSubscriptions: z.number().int(),
  refundsCount: z.number().int(),
  refundsTotal: Amount,
  paymentsCount: z.number().int(),
  gas: GasSummary,
});

export const OnboardMerchantRequest = z.object({
  name: z.string().min(1).max(100),
  /** must equal the signed-in wallet */
  payoutAddress: Address,
});
/** `secretKey` and `webhookSecret` are shown once. `token` replaces the onboarding JWT (now carries merchantId). */
export const OnboardMerchantResponse = z.object({
  merchant: Merchant,
  secretKey: z.string().startsWith("sk_test_"),
  webhookSecret: z.string(),
  token: z.string(),
});

export const RotateKeyResponse = z.object({
  secretKey: z.string().startsWith("sk_test_"),
  secretKeyPrefix: z.string(),
});

export const GasTopupRequest = z.object({ txHash: TxHash });
export const GasTopupResponse = GasSummary;

export const RefundTypedDataResponse = z.object({
  refund: Refund,
  /** the merchant payout wallet that must sign */
  signer: Address,
  typedData: ReceiveWithAuthorizationTypedData,
});

export const SubmitSignatureRequest = z.object({ signature: Signature });

export const SubmitRefundResponse = z.object({ refund: Refund, txHash: TxHash });

// ================================================================ public (checkout, links, receipts, portal)

export const PublicPlanTerms = z.object({
  id: PlanId,
  name: z.string(),
  amount: Amount,
  periodSeconds: z.number().int(),
  graceSeconds: z.number().int(),
  /** amount × 12, what the Permit allows */
  spendingCap: Amount,
  capPeriods: z.literal(12),
});

export const PublicSession = z.object({
  id: SessionId,
  mode: SessionMode,
  status: SessionStatus,
  merchant: z.object({ name: z.string() }),
  lineItems: z.array(LineItem),
  amount: Amount,
  currency: z.literal("USDT"),
  plan: PublicPlanTerms.nullable(),
  successUrl: Url,
  cancelUrl: Url,
  paymentId: PaymentId.nullable(),
  txHash: TxHash.nullable(),
  explorerUrl: Url.nullable(),
  expiresAt: IsoDate,
});
export type PublicSession = z.infer<typeof PublicSession>;

export const PrepareSessionRequest = z.object({ payer: Address });

const prepareCommon = {
  payer: Address,
  amount: Amount,
  /** payer's current USDT balance */
  balance: Amount,
  /** balance ≥ amount */
  sufficientBalance: z.boolean(),
};

/** Payment: sign `typedData.payment`. Subscription: sign `typedData.subscribe`, then `typedData.permit`. */
export const PrepareSessionResponse = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("payment"),
    ...prepareCommon,
    typedData: z.object({ payment: ReceiveWithAuthorizationTypedData }),
  }),
  z.object({
    mode: z.literal("subscription"),
    ...prepareCommon,
    spendingCap: Amount,
    typedData: z.object({ subscribe: SubscribeTypedData, permit: PermitTypedData }),
  }),
]);
export type PrepareSessionResponse = z.infer<typeof PrepareSessionResponse>;

export const SubmitSessionRequest = z.object({
  payer: Address,
  signatures: z.object({
    payment: Signature.optional(),
    subscribe: Signature.optional(),
    permit: Signature.optional(),
  }),
});
export type SubmitSessionRequest = z.infer<typeof SubmitSessionRequest>;
export const SubmitSessionResponse = z.object({ txHash: TxHash, status: SessionStatus });

/** Poll every 1s. `receiptUrl` / `redirectUrl` are set once complete. */
export const SessionStatusResponse = z.object({
  status: SessionStatus,
  txHash: TxHash.nullable(),
  explorerUrl: Url.nullable(),
  paymentId: PaymentId.nullable(),
  subscriptionId: SubscriptionId.nullable(),
  receiptUrl: Url.nullable(),
  redirectUrl: Url.nullable(),
  /** set when the submitted tx failed; the session goes back to `open` */
  error: ErrorEnvelope.shape.error.nullable(),
});
export type SessionStatusResponse = z.infer<typeof SessionStatusResponse>;

export const SlugParams = z.object({ slug: z.string() });
export const PublicLinkResponse = z.object({
  sessionId: SessionId,
  /** `${PUBLIC_WEB_URL}/c/${sessionId}` */
  sessionUrl: Url,
  title: z.string(),
  amount: Amount,
});

export const PaymentIdParams = z.object({ paymentId: z.string() });
export const Receipt = z.object({
  paymentId: PaymentId,
  merchant: z.object({ name: z.string() }),
  kind: PaymentKind,
  status: PaymentStatus,
  lineItems: z.array(LineItem),
  planName: z.string().nullable(),
  reference: z.string().nullable(),
  amount: Amount,
  refunded: Amount,
  payerAddress: Address,
  txHash: TxHash,
  explorerUrl: Url,
  paidAt: IsoDate,
  refunds: z.array(
    z.object({ id: RefundId, amount: Amount, txHash: TxHash.nullable(), explorerUrl: Url.nullable(), createdAt: IsoDate }),
  ),
});
export type Receipt = z.infer<typeof Receipt>;

export const PortalResponse = z.object({
  address: Address,
  subscriptions: z.array(Subscription.extend({ merchantName: z.string() })),
  payments: z.array(Payment.extend({ merchantName: z.string(), receiptUrl: Url })),
});
export type PortalResponse = z.infer<typeof PortalResponse>;

export const PortalCancelPrepareResponse = z.object({
  subscriptionId: SubscriptionId,
  typedData: CancelSubscriptionTypedData,
});
export const PortalCancelSubmitResponse = z.object({ txHash: TxHash, subscription: Subscription.extend({ merchantName: z.string() }) });

// ================================================================ demo + health

export const DemoFundRequest = z.object({ address: Address });
export const DemoFundResponse = z.object({ txHash: TxHash, explorerUrl: Url, amount: Amount });

export const HealthResponse = z.object({
  ok: z.boolean(),
  chainId: z.number().int(),
  rpc: z.object({ ok: z.boolean(), blockNumber: UintString.nullable() }),
  relayer: z.object({ address: Address, balanceWei: UintString, balance: z.string(), low: z.boolean() }),
  indexer: z.object({ lastBlock: UintString.nullable(), lagBlocks: z.number().int().nullable() }),
  contract: z.object({ quietPay: Address.nullable(), usdt: Address }),
});

// ================================================================ endpoint map

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
/**
 * - `secret`: `Bearer sk_test_…` or merchant JWT (see header comment)
 * - `merchant`: merchant dashboard JWT
 * - `customer`: customer portal JWT
 * - `none`: public
 */
export type EndpointAuth = "secret" | "merchant" | "customer" | "none";

export type EndpointDef = {
  method: HttpMethod;
  /** Hono-style path, e.g. `/v1/checkout/sessions/:id` */
  path: string;
  auth: EndpointAuth;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  /** JSON response schema, or `"csv"` for text/csv */
  response: z.ZodType | "csv";
  /** HTTP status on success (default 200) */
  status?: number;
};

const ep = <const E extends EndpointDef>(e: E) => e;

export const Endpoints = {
  // ---- auth
  authNonce: ep({ method: "GET", path: "/auth/nonce", auth: "none", query: AuthNonceQuery, response: AuthNonceResponse }),
  authVerify: ep({ method: "POST", path: "/auth/verify", auth: "none", body: AuthVerifyRequest, response: AuthVerifyResponse }),

  // ---- merchant API
  createCheckoutSession: ep({
    method: "POST",
    path: "/v1/checkout/sessions",
    auth: "secret",
    body: CreateCheckoutSessionRequest,
    response: CreateCheckoutSessionResponse,
    status: 201,
  }),
  getCheckoutSession: ep({
    method: "GET",
    path: "/v1/checkout/sessions/:id",
    auth: "secret",
    params: IdParams,
    response: CheckoutSession,
  }),
  createPaymentLink: ep({
    method: "POST",
    path: "/v1/payment_links",
    auth: "secret",
    body: CreatePaymentLinkRequest,
    response: CreatePaymentLinkResponse,
    status: 201,
  }),
  listPaymentLinks: ep({
    method: "GET",
    path: "/v1/payment_links",
    auth: "secret",
    query: ListQuery,
    response: listOf(PaymentLink),
  }),
  createPlan: ep({ method: "POST", path: "/v1/plans", auth: "secret", body: CreatePlanRequest, response: Plan, status: 201 }),
  listPlans: ep({ method: "GET", path: "/v1/plans", auth: "secret", query: ListQuery, response: listOf(Plan) }),
  listPayments: ep({ method: "GET", path: "/v1/payments", auth: "secret", query: ListPaymentsQuery, response: listOf(Payment) }),
  listSubscriptions: ep({
    method: "GET",
    path: "/v1/subscriptions",
    auth: "secret",
    query: ListSubscriptionsQuery,
    response: listOf(Subscription),
  }),
  cancelSubscription: ep({
    method: "POST",
    path: "/v1/subscriptions/:id/cancel",
    auth: "secret",
    params: IdParams,
    response: Subscription,
  }),
  createRefund: ep({
    method: "POST",
    path: "/v1/refunds",
    auth: "secret",
    body: CreateRefundRequest,
    response: CreateRefundResponse,
    status: 201,
  }),
  exportPaymentsCsv: ep({ method: "GET", path: "/v1/exports/payments.csv", auth: "secret", response: "csv" }),
  updateWebhookEndpoint: ep({
    method: "PUT",
    path: "/v1/webhook_endpoint",
    auth: "secret",
    body: UpdateWebhookEndpointRequest,
    response: UpdateWebhookEndpointResponse,
  }),
  testWebhookEndpoint: ep({ method: "POST", path: "/v1/webhook_endpoint/test", auth: "secret", response: WebhookDelivery }),

  // ---- dashboard
  dashGetMerchant: ep({ method: "GET", path: "/dash/merchant", auth: "merchant", response: Merchant }),
  dashOnboard: ep({
    method: "POST",
    path: "/dash/merchant",
    auth: "merchant",
    body: OnboardMerchantRequest,
    response: OnboardMerchantResponse,
    status: 201,
  }),
  dashOverview: ep({ method: "GET", path: "/dash/overview", auth: "merchant", response: DashOverviewResponse }),
  dashPayments: ep({ method: "GET", path: "/dash/payments", auth: "merchant", query: ListPaymentsQuery, response: listOf(Payment) }),
  dashSubscriptions: ep({
    method: "GET",
    path: "/dash/subscriptions",
    auth: "merchant",
    query: ListSubscriptionsQuery,
    response: listOf(Subscription),
  }),
  dashWebhookDeliveries: ep({
    method: "GET",
    path: "/dash/webhooks/deliveries",
    auth: "merchant",
    query: ListQuery,
    response: listOf(WebhookDelivery),
  }),
  dashRefundTypedData: ep({
    method: "POST",
    path: "/dash/refunds/:id/typed-data",
    auth: "merchant",
    params: IdParams,
    response: RefundTypedDataResponse,
  }),
  dashRefundSubmit: ep({
    method: "POST",
    path: "/dash/refunds/:id/submit",
    auth: "merchant",
    params: IdParams,
    body: SubmitSignatureRequest,
    response: SubmitRefundResponse,
  }),
  dashRotateKey: ep({ method: "POST", path: "/dash/keys/rotate", auth: "merchant", response: RotateKeyResponse }),
  dashGasTopup: ep({ method: "POST", path: "/dash/gas/topup", auth: "merchant", body: GasTopupRequest, response: GasTopupResponse }),

  // ---- public
  publicGetSession: ep({ method: "GET", path: "/public/sessions/:id", auth: "none", params: IdParams, response: PublicSession }),
  publicPrepareSession: ep({
    method: "POST",
    path: "/public/sessions/:id/prepare",
    auth: "none",
    params: IdParams,
    body: PrepareSessionRequest,
    response: PrepareSessionResponse,
  }),
  publicSubmitSession: ep({
    method: "POST",
    path: "/public/sessions/:id/submit",
    auth: "none",
    params: IdParams,
    body: SubmitSessionRequest,
    response: SubmitSessionResponse,
    status: 202,
  }),
  publicSessionStatus: ep({
    method: "GET",
    path: "/public/sessions/:id/status",
    auth: "none",
    params: IdParams,
    response: SessionStatusResponse,
  }),
  publicLink: ep({ method: "GET", path: "/public/links/:slug", auth: "none", params: SlugParams, response: PublicLinkResponse }),
  publicReceipt: ep({ method: "GET", path: "/public/receipts/:paymentId", auth: "none", params: PaymentIdParams, response: Receipt }),
  publicPortal: ep({ method: "GET", path: "/public/portal", auth: "customer", response: PortalResponse }),
  publicPortalCancelPrepare: ep({
    method: "POST",
    path: "/public/portal/subscriptions/:id/cancel/prepare",
    auth: "customer",
    params: IdParams,
    response: PortalCancelPrepareResponse,
  }),
  publicPortalCancelSubmit: ep({
    method: "POST",
    path: "/public/portal/subscriptions/:id/cancel/submit",
    auth: "customer",
    params: IdParams,
    body: SubmitSignatureRequest,
    response: PortalCancelSubmitResponse,
  }),

  // ---- demo + health
  demoFund: ep({ method: "POST", path: "/demo/fund", auth: "none", body: DemoFundRequest, response: DemoFundResponse }),
  health: ep({ method: "GET", path: "/health", auth: "none", response: HealthResponse }),
} as const satisfies Record<string, EndpointDef>;

export type Endpoints = typeof Endpoints;
export type EndpointName = keyof Endpoints;

type Out<S> = S extends z.ZodType ? z.output<S> : S extends "csv" ? string : never;
type In<S> = S extends z.ZodType ? z.input<S> : never;

/** Response type of an endpoint: `ResponseOf<"createCheckoutSession">`. */
export type ResponseOf<N extends EndpointName> = Out<Endpoints[N]["response"]>;
/** Request body type of an endpoint (input side, before defaults). */
export type BodyOf<N extends EndpointName> = Endpoints[N] extends { body: infer B } ? In<B> : never;
export type QueryOf<N extends EndpointName> = Endpoints[N] extends { query: infer Q } ? In<Q> : never;
export type ParamsOf<N extends EndpointName> = Endpoints[N] extends { params: infer P } ? In<P> : never;
