import { randomBytes } from "node:crypto";
import { formatEther, type Address, type Hex } from "viem";
import {
  apiPaymentId,
  explorerTx,
  fromUnits,
  toUnits,
  type CheckoutSession,
  type LineItem,
  type Merchant,
  type Payment,
  type PaymentLink,
  type Plan,
  type PublicSession,
  type Refund,
  type Subscription,
  type WebhookDelivery,
  type WebhookEvent,
  type WebhookEventType,
} from "@quietpay/shared";

// ── Config ─────────────────────────────────────────────────────────────────

export interface MockConfig {
  webUrl: string;
  webhookUrl: string;
  confirmMs: number;
  defaultBalance: bigint;
  strictSignatures: boolean;
  /** Retry interval for past-due subscriptions */
  retryMs: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): MockConfig {
  return {
    webUrl: env.MOCK_WEB_URL ?? "http://localhost:3001",
    webhookUrl: env.MOCK_WEBHOOK_URL ?? "http://localhost:3000/api/webhooks/quietpay",
    confirmMs: Number(env.MOCK_CONFIRM_MS ?? 2000),
    defaultBalance: toUnits(env.MOCK_DEFAULT_BALANCE ?? "100.00"),
    strictSignatures: env.MOCK_STRICT_SIGNATURES === "true",
    retryMs: Number(env.MOCK_RETRY_MS ?? 15000),
  };
}

/** Pretend contract address used in typed data (the mock never touches a chain). */
export const MOCK_QUIETPAY_ADDRESS = "0x00000000000000000000000000000000000Fa4e0" as Address;
export const MOCK_RELAYER_ADDRESS = "0x00000000000000000000000000000000000Fa4e1" as Address;
export const GAS_PER_TX_WEI = 800_000_000_000_000n; // 0.0008 WBT, roughly a real relayed call
export const CAP_PERIODS = 12 as const;
export const SEEDED = {
  merchantId: "mer_swagcounter",
  secretKey: "sk_test_mock_swagcounter",
  webhookSecret: "whsec_mock_swagcounter",
  payoutAddress: "0x5Ca1ab1E5Ca1ab1E5Ca1ab1E5Ca1ab1E5Ca1ab1E" as Address,
  signerAddress: "0x5Ca1ab1E5Ca1ab1E5Ca1ab1E5Ca1ab1E5Ca10000" as Address,
  planId: "plan_builder_box",
  linkSlug: "sticker-pack",
  customer: "0xC0ffee000000000000000000000000000000Beef" as Address,
};

// ── Records (internal; amounts are bigint base units) ──────────────────────

export interface MerchantRec {
  id: string;
  name: string;
  payoutAddress: Address;
  signerAddress: Address;
  onchainId: bigint;
  webhookUrl: string | null;
  webhookSecret: string;
  secretKey: string;
  gasBudgetWei: bigint;
  gasSpentWei: bigint;
  txCount: number;
  createdAt: Date;
}
export interface SessionRec {
  id: string;
  merchantId: string;
  mode: "payment" | "subscription";
  status: "open" | "processing" | "complete" | "expired";
  lineItems: LineItem[];
  amount: bigint;
  planId: string | null;
  reference: string;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
  paymentLinkId: string | null;
  paymentId: string | null;
  subscriptionId: string | null;
  txHash: Hex | null;
  payer: Address | null;
  createdAt: Date;
}
export interface PlanRec {
  id: string;
  merchantId: string;
  onchainId: bigint;
  name: string;
  amount: bigint;
  interval: "month" | "week" | "custom";
  periodSeconds: number;
  graceSeconds: number;
  active: boolean;
  createdAt: Date;
}
export interface PaymentRec {
  /** API id: "pay_" + onchainId hex */
  id: string;
  onchainId: Hex;
  merchantId: string;
  kind: "checkout" | "subscription";
  reference: string | null;
  customerEmail: string | null;
  payer: Address;
  amount: bigint;
  fee: bigint;
  refunded: bigint;
  refundCount: number;
  txHash: Hex;
  blockNumber: bigint;
  sessionId: string | null;
  subscriptionId: string | null;
  lineItems: LineItem[];
  planName: string | null;
  paidAt: Date;
}
export interface SubRec {
  id: string;
  onchainId: bigint;
  merchantId: string;
  planId: string;
  subscriber: Address;
  customerEmail: string | null;
  reference: string | null;
  status: "active" | "past_due" | "canceled";
  cycle: number;
  failedAttempts: number;
  nextChargeAt: Date | null;
  pastDueSince: Date | null;
  lastAttemptAt: Date | null;
  cancelReason: "customer" | "nonpayment" | "merchant" | null;
  forceFail: boolean;
  createdAt: Date;
}
export interface RefundRec {
  id: string;
  paymentId: string;
  merchantId: string;
  amount: bigint;
  reason: string | null;
  status: "awaiting_signature" | "submitted" | "succeeded" | "failed";
  seq: number | null;
  txHash: Hex | null;
  error: string | null;
  createdAt: Date;
}
export interface LinkRec {
  id: string;
  merchantId: string;
  slug: string;
  title: string;
  description: string | null;
  amount: bigint;
  active: boolean;
  qrSvg: string;
  createdAt: Date;
}
export interface DeliveryRec {
  id: string;
  merchantId: string;
  eventId: string;
  type: WebhookEventType;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  nextAttemptAt: Date | null;
  lastStatusCode: number | null;
  lastError: string | null;
  url: string;
  event: WebhookEvent;
  /** exact JSON body sent (signed) */
  rawBody: string;
  createdAt: Date;
}

export interface MockState {
  config: MockConfig;
  merchants: MerchantRec[];
  sessions: Map<string, SessionRec>;
  plans: PlanRec[];
  payments: PaymentRec[];
  subs: SubRec[];
  refunds: RefundRec[];
  links: LinkRec[];
  deliveries: DeliveryRec[];
  balances: Map<string, bigint>;
  permitNonces: Map<string, bigint>;
  demoFundedAt: Map<string, number>;
  counters: { merchant: bigint; plan: bigint; sub: bigint; block: bigint };
}

// ── Helpers ────────────────────────────────────────────────────────────────

export const newId = (prefix: string) => `${prefix}_${randomBytes(8).toString("hex")}`;
export const randomHash = () => `0x${randomBytes(32).toString("hex")}` as Hex;
export const newPaymentIds = () => {
  const onchainId = randomHash();
  return { onchainId, id: apiPaymentId(onchainId) };
};
const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const key = (a: string) => a.toLowerCase();

export function getBalance(state: MockState, address: string): bigint {
  return state.balances.get(key(address)) ?? state.config.defaultBalance;
}
export function setBalance(state: MockState, address: string, units: bigint) {
  state.balances.set(key(address), units);
}

export function recordGas(state: MockState, merchantId: string) {
  const m = state.merchants.find((x) => x.id === merchantId);
  if (!m) return;
  m.gasSpentWei += GAS_PER_TX_WEI;
  m.txCount += 1;
}

export function nextBlock(state: MockState): bigint {
  state.counters.block += 1n;
  return state.counters.block;
}

/** Sessions expire lazily when read. */
export function refreshSession(s: SessionRec): SessionRec {
  if (s.status === "open" && s.expiresAt.getTime() < Date.now()) s.status = "expired";
  return s;
}

// ── Serializers (internal record → API shape from @quietpay/shared) ────────

export function toMerchant(m: MerchantRec): Merchant {
  return {
    id: m.id,
    name: m.name,
    onchainId: m.onchainId.toString(),
    payoutAddress: m.payoutAddress,
    signerAddress: m.signerAddress,
    secretKeyPrefix: m.secretKey.slice(0, 12),
    webhookUrl: m.webhookUrl,
    createdAt: iso(m.createdAt),
  };
}

export function toPlan(p: PlanRec): Plan {
  return {
    id: p.id,
    onchainPlanId: p.onchainId.toString(),
    name: p.name,
    amount: fromUnits(p.amount),
    interval: p.interval,
    periodSeconds: p.periodSeconds,
    graceSeconds: p.graceSeconds,
    active: p.active,
    createdAt: iso(p.createdAt),
  };
}

export function toCheckoutSession(state: MockState, s: SessionRec): CheckoutSession {
  refreshSession(s);
  return {
    id: s.id,
    mode: s.mode,
    status: s.status,
    url: `${state.config.webUrl}/c/${s.id}`,
    amount: fromUnits(s.amount),
    currency: "USDT",
    lineItems: s.lineItems,
    planId: s.planId,
    reference: s.reference,
    customerEmail: s.customerEmail,
    successUrl: s.successUrl,
    cancelUrl: s.cancelUrl,
    paymentLinkId: s.paymentLinkId,
    payerAddress: s.payer,
    paymentId: s.paymentId,
    subscriptionId: s.subscriptionId,
    txHash: s.txHash,
    expiresAt: iso(s.expiresAt),
    createdAt: iso(s.createdAt),
  };
}

export function toPublicSession(state: MockState, s: SessionRec): PublicSession {
  refreshSession(s);
  const merchant = state.merchants.find((m) => m.id === s.merchantId)!;
  const plan = s.planId ? state.plans.find((p) => p.id === s.planId) : undefined;
  return {
    id: s.id,
    mode: s.mode,
    status: s.status,
    merchant: { name: merchant.name },
    lineItems: s.lineItems,
    amount: fromUnits(s.amount),
    currency: "USDT",
    plan: plan
      ? {
          id: plan.id,
          name: plan.name,
          amount: fromUnits(plan.amount),
          periodSeconds: plan.periodSeconds,
          graceSeconds: plan.graceSeconds,
          spendingCap: fromUnits(plan.amount * BigInt(CAP_PERIODS)),
          capPeriods: CAP_PERIODS,
        }
      : null,
    successUrl: s.successUrl,
    cancelUrl: s.cancelUrl,
    paymentId: s.paymentId,
    txHash: s.txHash,
    explorerUrl: s.txHash ? explorerTx(s.txHash) : null,
    expiresAt: iso(s.expiresAt),
  };
}

export function paymentStatus(p: PaymentRec) {
  return p.refunded === 0n ? "paid" : p.refunded >= p.amount ? "refunded" : "partially_refunded";
}

export function toPayment(p: PaymentRec): Payment {
  return {
    id: p.id,
    onchainPaymentId: p.onchainId,
    kind: p.kind,
    status: paymentStatus(p),
    sessionId: p.sessionId,
    subscriptionId: p.subscriptionId,
    reference: p.reference,
    customerEmail: p.customerEmail,
    payerAddress: p.payer,
    amount: fromUnits(p.amount),
    fee: fromUnits(p.fee),
    refunded: fromUnits(p.refunded),
    net: fromUnits(p.amount - p.fee - p.refunded),
    refundable: fromUnits(p.amount - p.refunded),
    txHash: p.txHash,
    explorerUrl: explorerTx(p.txHash),
    blockNumber: p.blockNumber.toString(),
    paidAt: iso(p.paidAt),
  };
}

export function toSubscription(state: MockState, s: SubRec): Subscription {
  const plan = state.plans.find((p) => p.id === s.planId)!;
  return {
    id: s.id,
    onchainSubId: s.onchainId.toString(),
    planId: s.planId,
    planName: plan.name,
    amount: fromUnits(plan.amount),
    periodSeconds: plan.periodSeconds,
    graceSeconds: plan.graceSeconds,
    subscriberAddress: s.subscriber,
    customerEmail: s.customerEmail,
    reference: s.reference,
    status: s.status,
    cycle: s.cycle,
    nextChargeAt: isoOrNull(s.nextChargeAt),
    pastDueSince: isoOrNull(s.pastDueSince),
    failedAttempts: s.failedAttempts,
    cancelReason: s.cancelReason,
    createdAt: iso(s.createdAt),
  };
}

export function toRefund(r: RefundRec): Refund {
  return {
    id: r.id,
    paymentId: r.paymentId,
    amount: fromUnits(r.amount),
    reason: r.reason,
    status: r.status,
    seq: r.seq,
    txHash: r.txHash,
    explorerUrl: r.txHash ? explorerTx(r.txHash) : null,
    error: r.error,
    createdAt: iso(r.createdAt),
  };
}

export function toLink(state: MockState, l: LinkRec): PaymentLink {
  return {
    id: l.id,
    slug: l.slug,
    title: l.title,
    description: l.description,
    amount: fromUnits(l.amount),
    active: l.active,
    url: `${state.config.webUrl}/l/${l.slug}`,
    createdAt: iso(l.createdAt),
  };
}

export function toDelivery(d: DeliveryRec): WebhookDelivery {
  return {
    id: d.id,
    eventId: d.eventId,
    type: d.type,
    status: d.status,
    attempts: d.attempts,
    nextAttemptAt: isoOrNull(d.nextAttemptAt),
    lastStatusCode: d.lastStatusCode,
    lastError: d.lastError,
    url: d.url,
    payload: d.event,
    createdAt: iso(d.createdAt),
  };
}

export function gasSummary(m: MerchantRec) {
  const remaining = m.gasBudgetWei - m.gasSpentWei;
  return {
    budgetWei: m.gasBudgetWei.toString(),
    spentWei: m.gasSpentWei.toString(),
    remainingWei: remaining.toString(),
    budget: formatEther(m.gasBudgetWei),
    spent: formatEther(m.gasSpentWei),
    remaining: formatEther(remaining),
    txCount: m.txCount,
  };
}
