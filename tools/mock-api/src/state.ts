import { randomBytes } from "node:crypto";
import { formatEther, type Address, type Hex } from "viem";
import {
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

/** Pretend contract address used in typed data (no real chain calls happen in the mock). */
export const MOCK_QUIETPAY_ADDRESS = "0x00000000000000000000000000000000000Fa4e0" as Address;
export const GAS_PER_TX_WEI = 800_000_000_000_000n; // 0.0008 WBT, roughly a real relayed call
export const SEEDED = {
  merchantId: "merch_swagcounter",
  secretKey: "sk_test_mock_swagcounter",
  webhookSecret: "whsec_mock_swagcounter",
  payoutAddress: "0x5Ca1ab1E5Ca1ab1E5Ca1ab1E5Ca1ab1E5Ca1ab1E" as Address,
  planId: "plan_builder_box",
  linkSlug: "sticker-pack",
  customer: "0xC0ffee000000000000000000000000000000Beef" as Address,
};

// ── Records (internal; amounts are bigint base units) ──────────────────────

export interface MerchantRec {
  id: string;
  name: string;
  payoutAddress: Address;
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
  id: string;
  onchainId: Hex;
  merchantId: string;
  kind: "checkout" | "subscription";
  reference: string;
  payer: Address;
  amount: bigint;
  fee: bigint;
  refunded: bigint;
  refundCount: number;
  txHash: Hex;
  sessionId: string | null;
  subscriptionId: string | null;
  description: string;
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
  reference: string;
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
  lastStatusCode: number | null;
  lastError: string | null;
  payload: string;
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
  authNonces: Map<string, string>;
  demoFundedAt: Map<string, number>;
  counters: { merchant: bigint; plan: bigint; sub: bigint };
}

// ── Helpers ────────────────────────────────────────────────────────────────

export const newId = (prefix: string) => `${prefix}_${randomBytes(8).toString("hex")}`;
export const randomHash = () => `0x${randomBytes(32).toString("hex")}` as Hex;
export const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const key = (a: string) => a.toLowerCase();

export function getBalance(state: MockState, address: string): bigint {
  return state.balances.get(key(address)) ?? state.config.defaultBalance;
}
export function setBalance(state: MockState, address: string, units: bigint) {
  state.balances.set(key(address), units);
}

export function intervalLabel(interval: PlanRec["interval"], periodSeconds: number): string {
  if (interval === "month") return "every month";
  if (interval === "week") return "every week";
  const units: [number, string][] = [[86_400, "day"], [3_600, "hour"], [60, "minute"], [1, "second"]];
  for (const [secs, name] of units) {
    if (periodSeconds % secs === 0) {
      const n = periodSeconds / secs;
      return `every ${n === 1 ? name : `${n} ${name}s`}${periodSeconds < 3_600 ? " (demo)" : ""}`;
    }
  }
  return `every ${periodSeconds} seconds`;
}

export function recordGas(state: MockState, merchantId: string) {
  const m = state.merchants.find((x) => x.id === merchantId);
  if (!m) return;
  m.gasSpentWei += GAS_PER_TX_WEI;
  m.txCount += 1;
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
    payoutAddress: m.payoutAddress,
    onchainId: m.onchainId.toString(),
    webhookUrl: m.webhookUrl,
    secretKeyPrefix: m.secretKey.slice(0, 12),
    createdAt: iso(m.createdAt),
  };
}

export function toPlan(p: PlanRec): Plan {
  return {
    id: p.id,
    name: p.name,
    amount: fromUnits(p.amount),
    currency: "USDT",
    interval: p.interval,
    periodSeconds: p.periodSeconds,
    graceSeconds: p.graceSeconds,
    intervalLabel: intervalLabel(p.interval, p.periodSeconds),
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
    expiresAt: iso(s.expiresAt),
    paymentId: s.paymentId,
    subscriptionId: s.subscriptionId,
    txHash: s.txHash,
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
          intervalLabel: intervalLabel(plan.interval, plan.periodSeconds),
        }
      : null,
    expiresAt: iso(s.expiresAt),
    successUrl: s.successUrl,
    cancelUrl: s.cancelUrl,
    txHash: s.txHash,
    paymentId: s.paymentId,
  };
}

export function toPayment(p: PaymentRec): Payment {
  const status = p.refunded === 0n ? "paid" : p.refunded >= p.amount ? "refunded" : "partially_refunded";
  return {
    id: p.id,
    kind: p.kind,
    status,
    reference: p.reference,
    payer: p.payer,
    amount: fromUnits(p.amount),
    fee: fromUnits(p.fee),
    refunded: fromUnits(p.refunded),
    net: fromUnits(p.amount - p.fee - p.refunded),
    refundable: fromUnits(p.amount - p.refunded),
    txHash: p.txHash,
    explorerUrl: explorerTx(p.txHash),
    sessionId: p.sessionId,
    subscriptionId: p.subscriptionId,
    description: p.description,
    paidAt: iso(p.paidAt),
  };
}

export function toSubscription(state: MockState, s: SubRec): Subscription {
  const plan = state.plans.find((p) => p.id === s.planId)!;
  return {
    id: s.id,
    planId: s.planId,
    planName: plan.name,
    amount: fromUnits(plan.amount),
    subscriber: s.subscriber,
    customerEmail: s.customerEmail,
    reference: s.reference,
    status: s.status,
    cycle: s.cycle,
    failedAttempts: s.failedAttempts,
    nextChargeAt: isoOrNull(s.nextChargeAt),
    pastDueSince: isoOrNull(s.pastDueSince),
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
    txHash: r.txHash,
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
    currency: "USDT",
    url: `${state.config.webUrl}/l/${l.slug}`,
    qrSvg: l.qrSvg,
    active: l.active,
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
    lastStatusCode: d.lastStatusCode,
    lastError: d.lastError,
    payload: d.payload,
    createdAt: iso(d.createdAt),
  };
}

export function gasSummary(m: MerchantRec) {
  return {
    spentWbt: formatEther(m.gasSpentWei),
    budgetWbt: formatEther(m.gasBudgetWei),
    remainingWbt: formatEther(m.gasBudgetWei - m.gasSpentWei),
    txCount: m.txCount,
  };
}

export function describeLineItems(items: LineItem[]): string {
  return items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(", ");
}
