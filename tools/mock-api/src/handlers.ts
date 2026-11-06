import type { Context } from "hono";
import { verifyTypedData, type Address, type Hex } from "viem";
import {
  explorerTx,
  fromUnits,
  orderIdFromSessionId,
  paymentNonce,
  quietPayDomain,
  quietPayTypes,
  refundNonce,
  sumAmounts,
  toSignableTypedData,
  toTypedDataPayload,
  toUnits,
  usdtDomain,
  usdtTypes,
  type BodyOf,
  type EndpointKey,
  type QueryOf,
  type ResponseOf,
  type TypedDataPayload,
} from "@quietpay/shared";
import { cancelSubscription, scheduleRefundConfirmation, scheduleSessionConfirmation } from "./engine";
import { lineItem, qrSvg } from "./seed";
import {
  GAS_PER_TX_WEI,
  MOCK_QUIETPAY_ADDRESS,
  gasSummary,
  getBalance,
  newId,
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
  type MerchantRec,
  type MockState,
  type PlanRec,
  type SessionRec,
} from "./state";
import { emitWebhook } from "./webhooks";

export class MockError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 401 | 402 | 404 | 409 | 422 | 429 | 500 = 400,
  ) {
    super(message);
  }
}

export interface Caller {
  merchant?: MerchantRec;
  address?: Address;
}

export interface Ctx<K extends EndpointKey> {
  c: Context;
  state: MockState;
  params: Record<string, string>;
  body: [BodyOf<K>] extends [never] ? undefined : BodyOf<K>;
  query: [QueryOf<K>] extends [never] ? undefined : QueryOf<K>;
  caller: Caller;
}

type Handlers = { [K in EndpointKey]: (ctx: Ctx<K>) => ResponseOf<K> | Promise<ResponseOf<K>> };

// ── helpers ────────────────────────────────────────────────────────────────

const PERIODS_IN_CAP = 12;
const MIN_AMOUNT = toUnits("0.50");
const lower = (a: string) => a.toLowerCase();
const unix = (d: Date) => BigInt(Math.floor(d.getTime() / 1000));
const PERIODS: Record<PlanRec["interval"], number> = { month: 2_592_000, week: 604_800, custom: 0 };

function requireMerchant(caller: Caller): MerchantRec {
  if (!caller.merchant) {
    throw new MockError("merchant_not_found", "No QuietPay business is linked to this wallet yet. Finish onboarding first.", 404);
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

function paginate<T>(items: T[], limit = 20, cursor?: string) {
  const start = cursor ? Number(cursor) : 0;
  const page = items.slice(start, start + limit);
  const next = start + limit < items.length ? String(start + limit) : null;
  return { data: page, nextCursor: next };
}

async function warnOrRejectSignature(state: MockState, label: string, payload: TypedDataPayload, signer: Address, signature: Hex) {
  let ok = false;
  try {
    ok = await verifyTypedData({
      ...(toSignableTypedData(payload) as Omit<Parameters<typeof verifyTypedData>[0], "address" | "signature">),
      address: signer,
      signature,
    } as Parameters<typeof verifyTypedData>[0]);
  } catch {
    ok = false;
  }
  if (ok) return;
  if (state.config.strictSignatures) throw new MockError("invalid_signature", "The signature didn't match. Please try again.", 422);
  console.warn(`[mock] ${label}: signature does not verify for ${signer} (accepted because MOCK_STRICT_SIGNATURES=false)`);
}

function buildPrepare(state: MockState, s: SessionRec, payer: Address) {
  const merchant = state.merchants.find((m) => m.id === s.merchantId)!;
  const balance = getBalance(state, payer);
  const base = { payer, amount: fromUnits(s.amount), balance: fromUnits(balance), sufficientFunds: balance >= s.amount };
  const deadline = unix(new Date(Date.now() + 30 * 60_000));

  if (s.mode === "payment") {
    const payment = toTypedDataPayload({
      domain: usdtDomain(),
      types: { ReceiveWithAuthorization: usdtTypes.ReceiveWithAuthorization },
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: payer,
        to: MOCK_QUIETPAY_ADDRESS,
        value: s.amount,
        validAfter: 0n,
        validBefore: unix(s.expiresAt),
        nonce: paymentNonce(MOCK_QUIETPAY_ADDRESS, merchant.onchainId, orderIdFromSessionId(s.id)),
      },
    });
    return { mode: "payment" as const, ...base, toSign: { payment } };
  }

  const plan = state.plans.find((p) => p.id === s.planId)!;
  const cap = plan.amount * BigInt(PERIODS_IN_CAP);
  const subscribe = toTypedDataPayload({
    domain: quietPayDomain(MOCK_QUIETPAY_ADDRESS),
    types: { Subscribe: quietPayTypes.Subscribe },
    primaryType: "Subscribe",
    message: { planId: plan.onchainId, subscriber: payer, maxAmount: plan.amount, nonce: 0n, deadline },
  });
  const permit = toTypedDataPayload({
    domain: usdtDomain(),
    types: { Permit: usdtTypes.Permit },
    primaryType: "Permit",
    message: {
      owner: payer,
      spender: MOCK_QUIETPAY_ADDRESS,
      value: cap,
      nonce: state.permitNonces.get(lower(payer)) ?? 0n,
      deadline,
    },
  });
  return {
    mode: "subscription" as const,
    ...base,
    spendingCap: fromUnits(cap),
    periods: PERIODS_IN_CAP,
    toSign: { subscribe, permit },
  };
}

function createPlanRec(state: MockState, merchant: MerchantRec, body: BodyOf<"createPlan">): PlanRec {
  const periodSeconds = body.interval === "custom" ? body.periodSeconds : PERIODS[body.interval];
  if (!periodSeconds) throw new MockError("bad_request", "Custom plans need periodSeconds (at least 60).", 400);
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

async function createLinkRec(state: MockState, merchant: MerchantRec, body: BodyOf<"createPaymentLink">) {
  const base = body.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "link";
  let slug = base;
  for (let i = 2; state.links.some((l) => l.slug === slug); i++) slug = `${base}-${i}`;
  const link = {
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

function createRefundRec(state: MockState, merchant: MerchantRec, body: BodyOf<"createRefund">) {
  const payment = state.payments.find((p) => p.id === body.paymentId && p.merchantId === merchant.id);
  if (!payment) throw new MockError("not_found", "Payment not found.", 404);
  const amount = toUnits(body.amount);
  const pending = state.refunds
    .filter((r) => r.paymentId === payment.id && (r.status === "awaiting_signature" || r.status === "submitted"))
    .reduce((acc, r) => acc + r.amount, 0n);
  const refundable = payment.amount - payment.refunded - pending;
  if (amount <= 0n) throw new MockError("bad_request", "Refund amount must be more than 0.", 400);
  if (amount > refundable) {
    throw new MockError("refund_exceeds_payment", `You can refund at most ${fromUnits(refundable)} USDT for this payment.`, 422);
  }
  const refund = {
    id: newId("re"),
    paymentId: payment.id,
    merchantId: merchant.id,
    amount,
    reason: body.reason ?? null,
    status: "awaiting_signature" as const,
    txHash: null,
    error: null,
    createdAt: new Date(),
  };
  state.refunds.unshift(refund);
  return refund;
}

function csv(state: MockState, merchant: MerchantRec): string {
  const header = "date,payment_id,kind,reference,payer,amount,fee,refunded,net,tx_hash,explorer_url";
  const rows = state.payments
    .filter((p) => p.merchantId === merchant.id)
    .map((p) => {
      const out = toPayment(p);
      return [out.paidAt, out.id, out.kind, out.reference, out.payer, out.amount, out.fee, out.refunded, out.net, out.txHash, out.explorerUrl]
        .map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
        .join(",");
    });
  return [header, ...rows].join("\n") + "\n";
}

function overview(state: MockState, merchant: MerchantRec) {
  const since = (ms: number) => state.payments.filter((p) => p.merchantId === merchant.id && Date.now() - p.paidAt.getTime() <= ms);
  const sum = (ps: { amount: bigint }[]) => fromUnits(ps.reduce((a, p) => a + p.amount, 0n));
  const subs = state.subs.filter((s) => s.merchantId === merchant.id);
  const active = subs.filter((s) => s.status === "active");
  const refunded7d = state.refunds
    .filter((r) => r.merchantId === merchant.id && r.status === "succeeded" && Date.now() - r.createdAt.getTime() <= 7 * 86_400_000)
    .reduce((a, r) => a + r.amount, 0n);
  return {
    volume24h: sum(since(86_400_000)),
    volume7d: sum(since(7 * 86_400_000)),
    // Sum of active subscription amounts per billing period.
    mrr: fromUnits(active.reduce((a, s) => a + state.plans.find((p) => p.id === s.planId)!.amount, 0n)),
    activeSubscriptions: active.length,
    pastDueSubscriptions: subs.filter((s) => s.status === "past_due").length,
    refunded7d: fromUnits(refunded7d),
    paymentsCount: state.payments.filter((p) => p.merchantId === merchant.id).length,
    gas: gasSummary(merchant),
    customerGasPaidWbt: "0" as const,
  };
}

function merchantSubs(state: MockState, merchant: MerchantRec, status?: string) {
  return state.subs.filter((s) => s.merchantId === merchant.id && (!status || s.status === status)).map((s) => toSubscription(state, s));
}

function findMerchantSub(state: MockState, merchant: MerchantRec, id: string) {
  const sub = state.subs.find((s) => s.id === id && s.merchantId === merchant.id);
  if (!sub) throw new MockError("not_found", "Subscription not found.", 404);
  if (sub.status === "canceled") throw new MockError("bad_request", "This subscription is already canceled.", 409);
  return sub;
}

async function putWebhook(state: MockState, merchant: MerchantRec, url: string) {
  merchant.webhookUrl = url;
  return { url, secret: merchant.webhookSecret };
}

async function testWebhook(state: MockState, merchant: MerchantRec) {
  const d = await emitWebhook(state, merchant.id, "ping", { message: "Test event from QuietPay" });
  return toDelivery(d!);
}

function paymentsList(state: MockState, merchant: MerchantRec, query: { limit?: number; cursor?: string; reference?: string } | undefined) {
  const list = state.payments
    .filter((p) => p.merchantId === merchant.id && (!query?.reference || p.reference === query.reference))
    .map(toPayment);
  return paginate(list, query?.limit, query?.cursor);
}

// ── Handlers: one per endpoint in @quietpay/shared's map (TypeScript enforces completeness) ──

export const handlers: Handlers = {
  // Merchant API
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
        amount: toUnits(sumAmounts(items.map((i) => i.amount))),
        planId: null,
        expiresAt: new Date(Date.now() + (body.expiresInSeconds ?? 1_800) * 1000),
      };
    } else {
      const plan = state.plans.find((p) => p.id === body.planId && p.merchantId === merchant.id && p.active);
      if (!plan) throw new MockError("not_found", `Plan ${body.planId} not found.`, 404);
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
  createPaymentLink: async ({ state, caller, body }) => toLink(state, await createLinkRec(state, requireMerchant(caller), body)),
  listPaymentLinks: ({ state, caller }) => {
    const m = requireMerchant(caller);
    return { data: state.links.filter((l) => l.merchantId === m.id).map((l) => toLink(state, l)), nextCursor: null };
  },
  createPlan: ({ state, caller, body }) => toPlan(createPlanRec(state, requireMerchant(caller), body)),
  listPlans: ({ state, caller }) => {
    const m = requireMerchant(caller);
    return { data: state.plans.filter((p) => p.merchantId === m.id).map(toPlan), nextCursor: null };
  },
  listPayments: ({ state, caller, query }) => paymentsList(state, requireMerchant(caller), query),
  listSubscriptions: ({ state, caller, query }) => ({ data: merchantSubs(state, requireMerchant(caller), query?.status), nextCursor: null }),
  cancelSubscription: async ({ state, caller, params }) => {
    const sub = findMerchantSub(state, requireMerchant(caller), params.id!);
    await cancelSubscription(state, sub, "merchant");
    return toSubscription(state, sub);
  },
  createRefund: ({ state, caller, body }) => {
    const r = createRefundRec(state, requireMerchant(caller), body);
    return { ...toRefund(r), signUrl: `${state.config.webUrl}/dashboard/payments?refund=${r.id}` };
  },
  exportPaymentsCsv: ({ state, caller }) => csv(state, requireMerchant(caller)),
  putWebhookEndpoint: ({ state, caller, body }) => putWebhook(state, requireMerchant(caller), body.url),
  testWebhookEndpoint: ({ state, caller }) => testWebhook(state, requireMerchant(caller)),

  // Wallet sign-in (mock: the token encodes role + address; signatures are checked but only warned on)
  getAuthNonce: ({ state, query }) => {
    const nonce = newId("nonce");
    state.authNonces.set(lower(query.address), nonce);
    return { nonce, message: `Sign in to QuietPay\nNonce: ${nonce}` };
  },
  verifyAuth: ({ state, body }) => {
    const merchant = state.merchants.find((m) => lower(m.payoutAddress) === lower(body.address));
    return {
      token: `mock.${body.role}.${body.address}`,
      role: body.role,
      address: body.address,
      merchantId: body.role === "merchant" ? (merchant?.id ?? null) : null,
    };
  },

  // Dashboard
  getDashMerchant: ({ caller }) => toMerchant(requireMerchant(caller)),
  createDashMerchant: ({ state, caller, body }) => {
    if (caller.merchant) throw new MockError("bad_request", "This wallet already has a QuietPay business.", 409);
    if (!caller.address || lower(caller.address) !== lower(body.payoutAddress)) {
      throw new MockError("bad_request", "The payout wallet must be the wallet you signed in with.", 400);
    }
    state.counters.merchant += 1n;
    const merchant: MerchantRec = {
      id: newId("merch"),
      name: body.name,
      payoutAddress: body.payoutAddress as Address,
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
    return { merchant: toMerchant(merchant), secretKey: merchant.secretKey, webhookSecret: merchant.webhookSecret };
  },
  rotateKeys: ({ caller }) => {
    const m = requireMerchant(caller);
    m.secretKey = newId("sk_test");
    return { secretKey: m.secretKey };
  },
  getDashOverview: ({ state, caller }) => overview(state, requireMerchant(caller)),
  listDashPayments: ({ state, caller, query }) => paymentsList(state, requireMerchant(caller), query),
  listDashSubscriptions: ({ state, caller, query }) => ({ data: merchantSubs(state, requireMerchant(caller), query?.status), nextCursor: null }),
  cancelDashSubscription: async ({ state, caller, params }) => {
    const sub = findMerchantSub(state, requireMerchant(caller), params.id!);
    await cancelSubscription(state, sub, "merchant");
    return toSubscription(state, sub);
  },
  listDashPlans: ({ state, caller }) => {
    const m = requireMerchant(caller);
    return { data: state.plans.filter((p) => p.merchantId === m.id).map(toPlan), nextCursor: null };
  },
  createDashPlan: ({ state, caller, body }) => toPlan(createPlanRec(state, requireMerchant(caller), body)),
  listDashPaymentLinks: ({ state, caller }) => {
    const m = requireMerchant(caller);
    return { data: state.links.filter((l) => l.merchantId === m.id).map((l) => toLink(state, l)), nextCursor: null };
  },
  createDashPaymentLink: async ({ state, caller, body }) => toLink(state, await createLinkRec(state, requireMerchant(caller), body)),
  createDashRefund: ({ state, caller, body }) => toRefund(createRefundRec(state, requireMerchant(caller), body)),
  getRefundTypedData: ({ state, caller, params }) => {
    const m = requireMerchant(caller);
    const refund = state.refunds.find((r) => r.id === params.id && r.merchantId === m.id);
    if (!refund) throw new MockError("not_found", "Refund not found.", 404);
    if (refund.status !== "awaiting_signature") throw new MockError("bad_request", "This refund has already been submitted.", 409);
    const payment = state.payments.find((p) => p.id === refund.paymentId)!;
    const toSign = toTypedDataPayload({
      domain: usdtDomain(),
      types: { ReceiveWithAuthorization: usdtTypes.ReceiveWithAuthorization },
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: m.payoutAddress,
        to: MOCK_QUIETPAY_ADDRESS,
        value: refund.amount,
        validAfter: 0n,
        validBefore: unix(new Date(Date.now() + 3_600_000)),
        nonce: refundNonce(MOCK_QUIETPAY_ADDRESS, payment.onchainId, payment.refundCount),
      },
    });
    return { refund: toRefund(refund), toSign };
  },
  submitRefund: ({ state, caller, params }) => {
    const m = requireMerchant(caller);
    const refund = state.refunds.find((r) => r.id === params.id && r.merchantId === m.id);
    if (!refund) throw new MockError("not_found", "Refund not found.", 404);
    if (refund.status !== "awaiting_signature") throw new MockError("bad_request", "This refund has already been submitted.", 409);
    refund.status = "submitted";
    refund.txHash = randomHash();
    scheduleRefundConfirmation(state, refund);
    return toRefund(refund);
  },
  listWebhookDeliveries: ({ state, caller }) => {
    const m = requireMerchant(caller);
    return { data: state.deliveries.filter((d) => d.merchantId === m.id).slice(0, 100).map(toDelivery), nextCursor: null };
  },
  putDashWebhookEndpoint: ({ state, caller, body }) => putWebhook(state, requireMerchant(caller), body.url),
  testDashWebhookEndpoint: ({ state, caller }) => testWebhook(state, requireMerchant(caller)),
  exportDashPaymentsCsv: ({ state, caller }) => csv(state, requireMerchant(caller)),
  recordGasTopup: ({ caller }) => {
    const m = requireMerchant(caller);
    m.gasBudgetWei += 50_000_000_000_000_000n;
    return gasSummary(m);
  },

  // Public: checkout
  getPublicSession: ({ state, params }) => toPublicSession(state, findSession(state, params.id!)),
  prepareSession: ({ state, params, body }) => {
    const s = findSession(state, params.id!);
    requireOpen(s);
    return buildPrepare(state, s, body.payer as Address);
  },
  submitSession: async ({ state, params, body }) => {
    const s = findSession(state, params.id!);
    requireOpen(s);
    const payer = body.payer as Address;
    if (s.amount < MIN_AMOUNT) throw new MockError("amount_below_minimum", "The minimum payment is 0.50 USDT.", 422);
    if (getBalance(state, payer) < s.amount) {
      throw new MockError("insufficient_balance", `Your wallet has ${fromUnits(getBalance(state, payer))} USDT; this needs ${fromUnits(s.amount)} USDT.`, 402);
    }
    const prepared = buildPrepare(state, s, payer);
    if (prepared.mode === "payment") {
      if (!body.signatures.payment) throw new MockError("bad_request", "Missing payment signature.", 400);
      await warnOrRejectSignature(state, "payment", prepared.toSign.payment, payer, body.signatures.payment as Hex);
    } else {
      if (!body.signatures.subscribe || !body.signatures.permit) {
        throw new MockError("bad_request", "Missing subscription signatures.", 400);
      }
      await warnOrRejectSignature(state, "subscribe", prepared.toSign.subscribe, payer, body.signatures.subscribe as Hex);
      await warnOrRejectSignature(state, "permit", prepared.toSign.permit, payer, body.signatures.permit as Hex);
      state.permitNonces.set(lower(payer), (state.permitNonces.get(lower(payer)) ?? 0n) + 1n);
    }
    s.status = "processing";
    s.payer = payer;
    s.txHash = randomHash();
    scheduleSessionConfirmation(state, s);
    return { txHash: s.txHash };
  },
  getSessionStatus: ({ state, params }) => {
    const s = findSession(state, params.id!);
    const done = s.status === "complete";
    return {
      status: s.status,
      txHash: s.txHash,
      paymentId: s.paymentId,
      subscriptionId: s.subscriptionId,
      receiptUrl: done && s.paymentId ? `${state.config.webUrl}/r/${s.paymentId}` : null,
      redirectUrl: done ? s.successUrl : null,
      explorerUrl: s.txHash ? explorerTx(s.txHash) : null,
    };
  },
  getPublicLink: ({ state, params }) => {
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
      paymentId: null,
      subscriptionId: null,
      txHash: null,
      payer: null,
      createdAt: new Date(),
    });
    return { sessionId: id, sessionUrl: `${state.config.webUrl}/c/${id}` };
  },
  getReceipt: ({ state, params }) => {
    const p = state.payments.find((x) => x.id === params.paymentId);
    if (!p) throw new MockError("not_found", "Receipt not found.", 404);
    const merchant = state.merchants.find((m) => m.id === p.merchantId)!;
    return {
      paymentId: p.id,
      merchant: { name: merchant.name },
      kind: p.kind,
      description: p.description,
      lineItems: p.lineItems,
      amount: fromUnits(p.amount),
      refunded: fromUnits(p.refunded),
      payer: p.payer,
      paidAt: p.paidAt.toISOString(),
      txHash: p.txHash,
      explorerUrl: explorerTx(p.txHash),
      planName: p.planName,
    };
  },
  getPortal: ({ state, caller }) => {
    const address = caller.address!;
    const merchantName = (id: string) => state.merchants.find((m) => m.id === id)?.name ?? "Unknown business";
    return {
      address,
      subscriptions: state.subs
        .filter((s) => lower(s.subscriber) === lower(address))
        .map((s) => ({ ...toSubscription(state, s), merchantName: merchantName(s.merchantId) })),
      payments: state.payments
        .filter((p) => lower(p.payer) === lower(address))
        .map((p) => ({ ...toPayment(p), merchantName: merchantName(p.merchantId), receiptUrl: `${state.config.webUrl}/r/${p.id}` })),
    };
  },
  prepareCancelSubscription: ({ state, caller, params }) => {
    const sub = state.subs.find((s) => s.id === params.id && lower(s.subscriber) === lower(caller.address!));
    if (!sub) throw new MockError("not_found", "Subscription not found.", 404);
    const toSign = toTypedDataPayload({
      domain: quietPayDomain(MOCK_QUIETPAY_ADDRESS),
      types: { CancelSubscription: quietPayTypes.CancelSubscription },
      primaryType: "CancelSubscription",
      message: { subId: sub.onchainId, nonce: 0n, deadline: unix(new Date(Date.now() + 1_800_000)) },
    });
    return { toSign };
  },
  submitCancelSubscription: async ({ state, caller, params }) => {
    const sub = state.subs.find((s) => s.id === params.id && lower(s.subscriber) === lower(caller.address!));
    if (!sub) throw new MockError("not_found", "Subscription not found.", 404);
    if (sub.status === "canceled") throw new MockError("bad_request", "This subscription is already canceled.", 409);
    await cancelSubscription(state, sub, "customer");
    return toSubscription(state, sub);
  },

  // Demo + health
  demoFund: ({ state, body }) => {
    const last = state.demoFundedAt.get(lower(body.address));
    if (last && Date.now() - last < 10 * 60_000) {
      throw new MockError("rate_limited", "This wallet got test USDT less than 10 minutes ago. Try again later.", 429);
    }
    state.demoFundedAt.set(lower(body.address), Date.now());
    setBalance(state, body.address, getBalance(state, body.address) + toUnits("50.00"));
    return { txHash: randomHash(), amount: "50.00" };
  },
  health: () => ({ ok: true, rpc: true, relayerWbt: "0.4200", indexerLagBlocks: 0 }),
};

