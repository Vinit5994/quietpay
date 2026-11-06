import type { Context } from "hono";
import { verifyTypedData, type Address, type Hex } from "viem";
import type { z } from "zod";
import {
  CancelSubscriptionTypedData,
  PAYMENTS_CSV_COLUMNS,
  PermitTypedData,
  ReceiveWithAuthorizationTypedData,
  SubscribeTypedData,
  USDT_ADDRESS,
  cancelSubscriptionTypedData,
  explorerTx,
  fromUnits,
  orderIdFromSessionId,
  paymentNonce,
  permitTypedData,
  receiveWithAuthorizationTypedData,
  refundNonce,
  subscribeTypedData,
  toUnits,
  type BodyOf,
  type EndpointName,
  type Endpoints,
  type ResponseOf,
} from "@quietpay/shared";
import { cancelSubscription, scheduleRefundConfirmation, scheduleSessionConfirmation } from "./engine";
import { lineItem, qrSvg } from "./seed";
import {
  CAP_PERIODS,
  GAS_PER_TX_WEI,
  MOCK_QUIETPAY_ADDRESS,
  MOCK_RELAYER_ADDRESS,
  gasSummary,
  getBalance,
  newId,
  paymentStatus,
  randomHash,
  refreshSession,
  setBalance,
  toCheckoutSession,
  toDelivery,
  toLink,
  toMerchant,
  toPayment,
  toPlan,
  toPublicSession,
  toRefund,
  toSubscription,
  type LinkRec,
  type MerchantRec,
  type MockState,
  type PlanRec,
  type RefundRec,
  type SessionRec,
} from "./state";
import { emitWebhook } from "./webhooks";

export class MockError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 = 400,
  ) {
    super(message);
  }
}

export interface Caller {
  merchant?: MerchantRec;
  address?: Address;
}

export interface Ctx<N extends EndpointName> {
  c: Context;
  state: MockState;
  params: Record<string, string>;
  body: [BodyOf<N>] extends [never] ? undefined : BodyOf<N>;
  /** parsed (output) query: app.ts validates it with the shared schema first */
  query: Endpoints[N] extends { query: infer Q extends z.ZodType } ? z.output<Q> : undefined;
  caller: Caller;
}

type Handlers = { [N in EndpointName]: (ctx: Ctx<N>) => ResponseOf<N> | Promise<ResponseOf<N>> };

// ── helpers ────────────────────────────────────────────────────────────────

const MIN_AMOUNT = toUnits("0.50");
const lower = (a: string) => a.toLowerCase();
const unix = (d: Date) => BigInt(Math.floor(d.getTime() / 1000));
const PERIODS: Record<PlanRec["interval"], number> = { month: 2_592_000, week: 604_800, custom: 0 };
/** bigint uints → decimal strings, validated (and typed) by the shared typed-data schema. */
function json<S extends z.ZodType>(schema: S, td: { message: unknown }): z.output<S> {
  const message = Object.fromEntries(
    Object.entries(td.message as Record<string, unknown>).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
  );
  return schema.parse({ ...td, message });
}

function requireMerchant(caller: Caller): MerchantRec {
  if (!caller.merchant) {
    throw new MockError("not_found", "No QuietPay business is linked to this wallet yet. Finish onboarding first.", 404);
  }
  return caller.merchant;
}

function findSession(state: MockState, id: string): SessionRec {
  const s = state.sessions.get(id);
  if (!s) throw new MockError("not_found", "This checkout link doesn't exist. Go back to the store and try again.", 404);
  return refreshSession(s);
}

function requireOpen(s: SessionRec) {
  if (s.status === "expired") throw new MockError("session_expired", "This checkout has expired. Go back to the store to start again.", 409);
  if (s.status !== "open") throw new MockError("session_not_open", "This checkout has already been paid.", 409);
}

function paginate<T>(items: T[], query?: { limit?: number; cursor?: string }) {
  const limit = query?.limit ?? 20;
  const start = query?.cursor ? Number(query.cursor) : 0;
  return { data: items.slice(start, start + limit), nextCursor: start + limit < items.length ? String(start + limit) : null };
}

async function checkSignature(state: MockState, label: string, typedData: unknown, signer: Address, signature: Hex) {
  let ok = false;
  try {
    ok = await verifyTypedData({ ...(typedData as object), address: signer, signature } as unknown as Parameters<typeof verifyTypedData>[0]);
  } catch {
    ok = false;
  }
  if (ok) return;
  if (state.config.strictSignatures) throw new MockError("invalid_signature", "The signature didn't match. Please try again.", 422);
  console.warn(`[mock] ${label}: signature does not verify for ${signer} (accepted because MOCK_STRICT_SIGNATURES=false)`);
}

/** Typed data with bigint uints (for verifying) for a session + payer. */
function typedDataFor(state: MockState, s: SessionRec, payer: Address) {
  const merchant = state.merchants.find((m) => m.id === s.merchantId)!;
  const deadline = unix(new Date(Date.now() + 30 * 60_000));
  if (s.mode === "payment") {
    return {
      payment: receiveWithAuthorizationTypedData({
        from: payer,
        to: MOCK_QUIETPAY_ADDRESS,
        value: s.amount,
        validAfter: 0n,
        validBefore: unix(s.expiresAt),
        nonce: paymentNonce(MOCK_QUIETPAY_ADDRESS, merchant.onchainId, orderIdFromSessionId(s.id)),
      }),
    } as const;
  }
  const plan = state.plans.find((p) => p.id === s.planId)!;
  return {
    subscribe: subscribeTypedData(MOCK_QUIETPAY_ADDRESS, {
      planId: plan.onchainId,
      subscriber: payer,
      maxAmount: plan.amount,
      nonce: 0n,
      deadline,
    }),
    permit: permitTypedData({
      owner: payer,
      spender: MOCK_QUIETPAY_ADDRESS,
      value: plan.amount * BigInt(CAP_PERIODS),
      nonce: state.permitNonces.get(lower(payer)) ?? 0n,
      deadline,
    }),
  } as const;
}

function createPlanRec(state: MockState, merchant: MerchantRec, body: BodyOf<"createPlan">): PlanRec {
  const periodSeconds = body.interval === "custom" ? body.periodSeconds! : PERIODS[body.interval];
  state.counters.plan += 1n;
  const plan: PlanRec = {
    id: newId("plan"),
    merchantId: merchant.id,
    onchainId: state.counters.plan,
    name: body.name,
    amount: toUnits(body.amount),
    interval: body.interval,
    periodSeconds,
    graceSeconds: body.graceSeconds ?? (periodSeconds < 3_600 ? 60 : 259_200),
    active: true,
    createdAt: new Date(),
  };
  state.plans.push(plan);
  merchant.gasSpentWei += GAS_PER_TX_WEI;
  merchant.txCount += 1;
  return plan;
}

async function createLinkRec(state: MockState, merchant: MerchantRec, body: BodyOf<"createPaymentLink">): Promise<LinkRec> {
  const base = body.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "link";
  let slug = base;
  for (let i = 2; state.links.some((l) => l.slug === slug); i++) slug = `${base}-${i}`;
  const link: LinkRec = {
    id: newId("link"),
    merchantId: merchant.id,
    slug,
    title: body.title,
    description: body.description ?? null,
    amount: toUnits(body.amount),
    active: true,
    qrSvg: await qrSvg(`${state.config.webUrl}/l/${slug}`),
    createdAt: new Date(),
  };
  state.links.unshift(link);
  return link;
}

function createRefundRec(state: MockState, merchant: MerchantRec, body: BodyOf<"createRefund">): RefundRec {
  const payment = state.payments.find((p) => p.id === body.paymentId && p.merchantId === merchant.id);
  if (!payment) throw new MockError("not_found", "Payment not found.", 404);
  const amount = toUnits(body.amount);
  const pending = state.refunds
    .filter((r) => r.paymentId === payment.id && (r.status === "awaiting_signature" || r.status === "submitted"))
    .reduce((acc, r) => acc + r.amount, 0n);
  const refundable = payment.amount - payment.refunded - pending;
  if (amount <= 0n) throw new MockError("invalid_amount", "Refund amount must be more than 0.", 400);
  if (amount > refundable) {
    throw new MockError("refund_exceeds_payment", `You can refund at most ${fromUnits(refundable)} USDT for this payment.`, 422);
  }
  const refund: RefundRec = {
    id: newId("re"),
    paymentId: payment.id,
    merchantId: merchant.id,
    amount,
    reason: body.reason ?? null,
    status: "awaiting_signature",
    seq: null,
    txHash: null,
    error: null,
    createdAt: new Date(),
  };
  state.refunds.unshift(refund);
  return refund;
}

function findRefund(state: MockState, merchant: MerchantRec, id: string): RefundRec {
  const refund = state.refunds.find((r) => r.id === id && r.merchantId === merchant.id);
  if (!refund) throw new MockError("not_found", "Refund not found.", 404);
  if (refund.status !== "awaiting_signature") throw new MockError("conflict", "This refund has already been submitted.", 409);
  return refund;
}

function refundTypedData(state: MockState, merchant: MerchantRec, refund: RefundRec) {
  const payment = state.payments.find((p) => p.id === refund.paymentId)!;
  const seq = refund.seq ?? payment.refundCount;
  return receiveWithAuthorizationTypedData({
    from: merchant.payoutAddress,
    to: MOCK_QUIETPAY_ADDRESS,
    value: refund.amount,
    validAfter: 0n,
    validBefore: unix(new Date(refund.createdAt.getTime() + 3_600_000)),
    nonce: refundNonce(MOCK_QUIETPAY_ADDRESS, payment.onchainId, seq),
  });
}

function csv(state: MockState, merchant: MerchantRec): string {
  const rows = state.payments
    .filter((p) => p.merchantId === merchant.id)
    .map((p) => {
      const o = toPayment(p);
      return [o.paidAt, o.id, o.kind, o.reference ?? "", o.payerAddress, o.amount, o.fee, o.refunded, o.net, o.txHash, o.explorerUrl]
        .map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
        .join(",");
    });
  return [PAYMENTS_CSV_COLUMNS.join(","), ...rows].join("\n") + "\n";
}

function overview(state: MockState, merchant: MerchantRec) {
  const mine = state.payments.filter((p) => p.merchantId === merchant.id);
  const since = (ms: number) => mine.filter((p) => Date.now() - p.paidAt.getTime() <= ms);
  const sum = (ps: { amount: bigint }[]) => fromUnits(ps.reduce((a, p) => a + p.amount, 0n));
  const subs = state.subs.filter((s) => s.merchantId === merchant.id);
  const active = subs.filter((s) => s.status === "active");
  // Monthly recurring revenue, normalized to 30 days (per the shared contract).
  const mrr = active.reduce((a, s) => {
    const plan = state.plans.find((p) => p.id === s.planId)!;
    return a + (plan.amount * 2_592_000n) / BigInt(plan.periodSeconds);
  }, 0n);
  const refunds = state.refunds.filter((r) => r.merchantId === merchant.id && r.status === "succeeded");
  return {
    volume24h: sum(since(86_400_000)),
    volume7d: sum(since(7 * 86_400_000)),
    mrr: fromUnits(mrr),
    activeSubscriptions: active.length,
    pastDueSubscriptions: subs.filter((s) => s.status === "past_due").length,
    refundsCount: refunds.length,
    refundsTotal: fromUnits(refunds.reduce((a, r) => a + r.amount, 0n)),
    paymentsCount: mine.length,
    gas: gasSummary(merchant),
  };
}

function merchantSubs(state: MockState, merchant: MerchantRec, query?: { status?: string; limit?: number; cursor?: string }) {
  const list = state.subs.filter((s) => s.merchantId === merchant.id && (!query?.status || s.status === query.status)).map((s) => toSubscription(state, s));
  return paginate(list, query);
}

function paymentsList(state: MockState, merchant: MerchantRec, query?: { limit?: number; cursor?: string; reference?: string }) {
  const list = state.payments.filter((p) => p.merchantId === merchant.id && (!query?.reference || p.reference === query.reference)).map(toPayment);
  return paginate(list, query);
}

const merchantName = (state: MockState, id: string) => state.merchants.find((m) => m.id === id)?.name ?? "Unknown business";

function customerSub(state: MockState, caller: Caller, id: string) {
  const sub = state.subs.find((s) => s.id === id && lower(s.subscriber) === lower(caller.address!));
  if (!sub) throw new MockError("not_found", "Subscription not found.", 404);
  return sub;
}

// ── Handlers: one per endpoint in @quietpay/shared's Endpoints map (TypeScript enforces completeness) ──

export const handlers: Handlers = {
  // ---- auth (mock: the token encodes role + address; see app.ts)
  authNonce: () => {
    const nonce = newId("nonce");
    return { nonce, message: `Sign in to QuietPay\nNonce: ${nonce}`, expiresAt: new Date(Date.now() + 600_000).toISOString() };
  },
  authVerify: ({ state, body }) => {
    const merchant = state.merchants.find((m) => lower(m.payoutAddress) === lower(body.address));
    return {
      token: `mock.${body.role}.${body.address}`,
      role: body.role,
      address: body.address,
      merchantId: body.role === "merchant" ? (merchant?.id ?? null) : null,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
  },

  // ---- merchant API (secret key or merchant JWT)
  createCheckoutSession: ({ state, caller, body }) => {
    const merchant = requireMerchant(caller);
    const id = newId("sess");
    const base = {
      id,
      merchantId: merchant.id,
      status: "open" as const,
      reference: body.reference,
      customerEmail: body.customerEmail ?? null,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
      paymentLinkId: null,
      paymentId: null,
      subscriptionId: null,
      txHash: null,
      payer: null,
      createdAt: new Date(),
    };
    let s: SessionRec;
    if (body.mode === "payment") {
      const items = body.lineItems.map((i) => lineItem(i.name, i.unitAmount, i.quantity));
      s = {
        ...base,
        mode: "payment",
        lineItems: items,
        amount: items.reduce((a, i) => a + toUnits(i.amount), 0n),
        planId: null,
        expiresAt: new Date(Date.now() + (body.expiresInSeconds ?? 1_800) * 1000),
      };
    } else {
      const plan = state.plans.find((p) => p.id === body.planId && p.merchantId === merchant.id);
      if (!plan) throw new MockError("not_found", `Plan ${body.planId} not found.`, 404);
      if (!plan.active) throw new MockError("plan_inactive", "This plan is no longer available.", 409);
      s = {
        ...base,
        mode: "subscription",
        lineItems: [lineItem(plan.name, fromUnits(plan.amount))],
        amount: plan.amount,
        planId: plan.id,
        expiresAt: new Date(Date.now() + 1_800_000),
      };
    }
    state.sessions.set(id, s);
    return toCheckoutSession(state, s);
  },
  getCheckoutSession: ({ state, caller, params }) => {
    const merchant = requireMerchant(caller);
    const s = findSession(state, params.id!);
    if (s.merchantId !== merchant.id) throw new MockError("not_found", "Session not found.", 404);
    return toCheckoutSession(state, s);
  },
  createPaymentLink: async ({ state, caller, body }) => {
    const link = await createLinkRec(state, requireMerchant(caller), body);
    return { ...toLink(state, link), qrSvg: link.qrSvg };
  },
  listPaymentLinks: ({ state, caller, query }) => {
    const m = requireMerchant(caller);
    return paginate(state.links.filter((l) => l.merchantId === m.id).map((l) => toLink(state, l)), query);
  },
  createPlan: ({ state, caller, body }) => toPlan(createPlanRec(state, requireMerchant(caller), body)),
  listPlans: ({ state, caller, query }) => {
    const m = requireMerchant(caller);
    return paginate(state.plans.filter((p) => p.merchantId === m.id).map(toPlan), query);
  },
  listPayments: ({ state, caller, query }) => paymentsList(state, requireMerchant(caller), query),
  listSubscriptions: ({ state, caller, query }) => merchantSubs(state, requireMerchant(caller), query),
  cancelSubscription: async ({ state, caller, params }) => {
    const m = requireMerchant(caller);
    const sub = state.subs.find((s) => s.id === params.id && s.merchantId === m.id);
    if (!sub) throw new MockError("not_found", "Subscription not found.", 404);
    if (sub.status === "canceled") throw new MockError("subscription_not_active", "This subscription is already canceled.", 409);
    await cancelSubscription(state, sub, "merchant");
    return toSubscription(state, sub);
  },
  createRefund: ({ state, caller, body }) => {
    const r = createRefundRec(state, requireMerchant(caller), body);
    return { ...toRefund(r), signUrl: `${state.config.webUrl}/dashboard/payments?refund=${r.id}` };
  },
  exportPaymentsCsv: ({ state, caller }) => csv(state, requireMerchant(caller)),
  updateWebhookEndpoint: ({ caller, body }) => {
    const m = requireMerchant(caller);
    m.webhookUrl = body.url;
    return { url: body.url, secret: m.webhookSecret };
  },
  testWebhookEndpoint: async ({ state, caller }) => {
    const m = requireMerchant(caller);
    const d = await emitWebhook(state, m.id, "ping", { merchantReference: null, txHash: null, explorerUrl: null, message: "Test event from QuietPay" });
    return toDelivery(d!);
  },

  // ---- dashboard (merchant JWT)
  dashGetMerchant: ({ caller }) => toMerchant(requireMerchant(caller)),
  dashOnboard: ({ state, caller, body }) => {
    if (caller.merchant) throw new MockError("conflict", "This wallet already has a QuietPay business.", 409);
    if (!caller.address || lower(caller.address) !== lower(body.payoutAddress)) {
      throw new MockError("forbidden", "The payout wallet must be the wallet you signed in with.", 403);
    }
    state.counters.merchant += 1n;
    const merchant: MerchantRec = {
      id: newId("mer"),
      name: body.name,
      payoutAddress: body.payoutAddress as Address,
      signerAddress: `0x${randomHash().slice(2, 42)}` as Address,
      onchainId: state.counters.merchant,
      webhookUrl: null,
      webhookSecret: newId("whsec"),
      secretKey: newId("sk_test"),
      gasBudgetWei: 50_000_000_000_000_000n,
      gasSpentWei: GAS_PER_TX_WEI,
      txCount: 1,
      createdAt: new Date(),
    };
    state.merchants.push(merchant);
    return {
      merchant: toMerchant(merchant),
      secretKey: merchant.secretKey,
      webhookSecret: merchant.webhookSecret,
      token: `mock.merchant.${merchant.payoutAddress}`,
    };
  },
  dashOverview: ({ state, caller }) => overview(state, requireMerchant(caller)),
  dashPayments: ({ state, caller, query }) => paymentsList(state, requireMerchant(caller), query),
  dashSubscriptions: ({ state, caller, query }) => merchantSubs(state, requireMerchant(caller), query),
  dashWebhookDeliveries: ({ state, caller, query }) => {
    const m = requireMerchant(caller);
    return paginate(state.deliveries.filter((d) => d.merchantId === m.id).map(toDelivery), query);
  },
  dashRefundTypedData: ({ state, caller, params }) => {
    const m = requireMerchant(caller);
    const refund = findRefund(state, m, params.id!);
    const payment = state.payments.find((p) => p.id === refund.paymentId)!;
    refund.seq = refund.seq ?? payment.refundCount;
    return { refund: toRefund(refund), signer: m.payoutAddress, typedData: json(ReceiveWithAuthorizationTypedData, refundTypedData(state, m, refund)) };
  },
  dashRefundSubmit: async ({ state, caller, params, body }) => {
    const m = requireMerchant(caller);
    const refund = findRefund(state, m, params.id!);
    await checkSignature(state, "refund", refundTypedData(state, m, refund), m.payoutAddress, body.signature as Hex);
    refund.status = "submitted";
    refund.txHash = randomHash();
    scheduleRefundConfirmation(state, refund);
    return { refund: toRefund(refund), txHash: refund.txHash };
  },
  dashRotateKey: ({ caller }) => {
    const m = requireMerchant(caller);
    m.secretKey = newId("sk_test");
    return { secretKey: m.secretKey, secretKeyPrefix: m.secretKey.slice(0, 12) };
  },
  dashGasTopup: ({ caller }) => {
    const m = requireMerchant(caller);
    m.gasBudgetWei += 50_000_000_000_000_000n;
    return gasSummary(m);
  },

  // ---- public: checkout
  publicGetSession: ({ state, params }) => toPublicSession(state, findSession(state, params.id!)),
  publicPrepareSession: ({ state, params, body }) => {
    const s = findSession(state, params.id!);
    requireOpen(s);
    const payer = body.payer as Address;
    const balance = getBalance(state, payer);
    const common = { payer, amount: fromUnits(s.amount), balance: fromUnits(balance), sufficientBalance: balance >= s.amount };
    const td = typedDataFor(state, s, payer);
    if ("payment" in td) return { mode: "payment" as const, ...common, typedData: { payment: json(ReceiveWithAuthorizationTypedData, td.payment as { message: unknown }) } };
    return {
      mode: "subscription" as const,
      ...common,
      spendingCap: fromUnits(s.amount * BigInt(CAP_PERIODS)),
      typedData: { subscribe: json(SubscribeTypedData, td.subscribe), permit: json(PermitTypedData, td.permit) },
    };
  },
  publicSubmitSession: async ({ state, params, body }) => {
    const s = findSession(state, params.id!);
    requireOpen(s);
    const payer = body.payer as Address;
    if (s.amount < MIN_AMOUNT) throw new MockError("amount_below_minimum", "The minimum payment is 0.50 USDT.", 422);
    if (getBalance(state, payer) < s.amount) {
      throw new MockError("insufficient_balance", `Your wallet has ${fromUnits(getBalance(state, payer))} USDT; this needs ${fromUnits(s.amount)} USDT.`, 402);
    }
    const td = typedDataFor(state, s, payer);
    if ("payment" in td) {
      if (!body.signatures.payment) throw new MockError("validation_failed", "Missing payment signature.", 400);
      await checkSignature(state, "payment", td.payment, payer, body.signatures.payment as Hex);
    } else {
      if (!body.signatures.subscribe || !body.signatures.permit) throw new MockError("validation_failed", "Missing subscription signatures.", 400);
      await checkSignature(state, "subscribe", td.subscribe, payer, body.signatures.subscribe as Hex);
      await checkSignature(state, "permit", td.permit, payer, body.signatures.permit as Hex);
      state.permitNonces.set(lower(payer), (state.permitNonces.get(lower(payer)) ?? 0n) + 1n);
    }
    s.status = "processing";
    s.payer = payer;
    s.txHash = randomHash();
    scheduleSessionConfirmation(state, s);
    return { txHash: s.txHash, status: s.status };
  },
  publicSessionStatus: ({ state, params }) => {
    const s = findSession(state, params.id!);
    const done = s.status === "complete";
    return {
      status: s.status,
      txHash: s.txHash,
      explorerUrl: s.txHash ? explorerTx(s.txHash) : null,
      paymentId: s.paymentId,
      subscriptionId: s.subscriptionId,
      receiptUrl: done && s.paymentId ? `${state.config.webUrl}/r/${s.paymentId}` : null,
      redirectUrl: done ? s.successUrl : null,
      error: null,
    };
  },
  publicLink: ({ state, params }) => {
    const link = state.links.find((l) => l.slug === params.slug && l.active);
    if (!link) throw new MockError("not_found", "This payment link doesn't exist or has been turned off.", 404);
    const id = newId("sess");
    state.sessions.set(id, {
      id,
      merchantId: link.merchantId,
      mode: "payment",
      status: "open",
      lineItems: [lineItem(link.title, fromUnits(link.amount))],
      amount: link.amount,
      planId: null,
      reference: `link:${link.slug}:${id.slice(5, 13)}`,
      customerEmail: null,
      successUrl: `${state.config.webUrl}/l/${link.slug}?status=paid`,
      cancelUrl: `${state.config.webUrl}/l/${link.slug}`,
      expiresAt: new Date(Date.now() + 1_800_000),
      paymentLinkId: link.id,
      paymentId: null,
      subscriptionId: null,
      txHash: null,
      payer: null,
      createdAt: new Date(),
    });
    return { sessionId: id, sessionUrl: `${state.config.webUrl}/c/${id}`, title: link.title, amount: fromUnits(link.amount) };
  },
  publicReceipt: ({ state, params }) => {
    const p = state.payments.find((x) => x.id === params.paymentId);
    if (!p) throw new MockError("not_found", "Receipt not found.", 404);
    return {
      paymentId: p.id,
      merchant: { name: merchantName(state, p.merchantId) },
      kind: p.kind,
      status: paymentStatus(p),
      lineItems: p.lineItems,
      planName: p.planName,
      reference: p.reference,
      amount: fromUnits(p.amount),
      refunded: fromUnits(p.refunded),
      payerAddress: p.payer,
      txHash: p.txHash,
      explorerUrl: explorerTx(p.txHash),
      paidAt: p.paidAt.toISOString(),
      refunds: state.refunds
        .filter((r) => r.paymentId === p.id && r.status === "succeeded")
        .map((r) => ({ id: r.id, amount: fromUnits(r.amount), txHash: r.txHash, explorerUrl: r.txHash ? explorerTx(r.txHash) : null, createdAt: r.createdAt.toISOString() })),
    };
  },
  publicPortal: ({ state, caller }) => {
    const address = caller.address!;
    return {
      address,
      subscriptions: state.subs
        .filter((s) => lower(s.subscriber) === lower(address))
        .map((s) => ({ ...toSubscription(state, s), merchantName: merchantName(state, s.merchantId) })),
      payments: state.payments
        .filter((p) => lower(p.payer) === lower(address))
        .map((p) => ({ ...toPayment(p), merchantName: merchantName(state, p.merchantId), receiptUrl: `${state.config.webUrl}/r/${p.id}` })),
    };
  },
  publicPortalCancelPrepare: ({ state, caller, params }) => {
    const sub = customerSub(state, caller, params.id!);
    if (sub.status === "canceled") throw new MockError("subscription_not_active", "This subscription is already canceled.", 409);
    const typedData = json(CancelSubscriptionTypedData, cancelSubscriptionTypedData(MOCK_QUIETPAY_ADDRESS, { subId: sub.onchainId, nonce: 0n, deadline: unix(new Date(Date.now() + 1_800_000)) }));
    return { subscriptionId: sub.id, typedData };
  },
  publicPortalCancelSubmit: async ({ state, caller, params }) => {
    const sub = customerSub(state, caller, params.id!);
    if (sub.status === "canceled") throw new MockError("subscription_not_active", "This subscription is already canceled.", 409);
    const txHash = await cancelSubscription(state, sub, "customer");
    return { txHash, subscription: { ...toSubscription(state, sub), merchantName: merchantName(state, sub.merchantId) } };
  },

  // ---- demo + health
  demoFund: ({ state, body }) => {
    const last = state.demoFundedAt.get(lower(body.address));
    if (last && Date.now() - last < 10 * 60_000) {
      throw new MockError("demo_fund_cooldown", "This wallet got test USDT less than 10 minutes ago. Try again later.", 429);
    }
    state.demoFundedAt.set(lower(body.address), Date.now());
    setBalance(state, body.address, getBalance(state, body.address) + toUnits("50.00"));
    const txHash = randomHash();
    return { txHash, explorerUrl: explorerTx(txHash), amount: "50.00" };
  },
  health: ({ state }) => ({
    ok: true,
    chainId: 1874,
    rpc: { ok: true, blockNumber: state.counters.block.toString() },
    relayer: { address: MOCK_RELAYER_ADDRESS, balanceWei: "420000000000000000", balance: "0.42", low: false },
    indexer: { lastBlock: state.counters.block.toString(), lagBlocks: 0 },
    contract: { quietPay: MOCK_QUIETPAY_ADDRESS, usdt: USDT_ADDRESS },
  }),
};
