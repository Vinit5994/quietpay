import { eq } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  explorerTx,
  fromUnits,
  invoiceTypedData,
  orderIdFromSessionId,
  paymentNonce,
  permitTypedData,
  receiveWithAuthorizationTypedData,
  subscribeTypedData,
  toJsonTypedData,
  toUnits,
  type BodyOf,
  type CheckoutSession,
  type PrepareSessionResponse,
  type PublicSession,
} from "@quietpay/shared";
import { checkoutSessions, merchants, plans } from "../db/schema";
import type { Deps, MerchantRow } from "../deps";
import { decrypt } from "../lib/crypto";
import { ApiError, notFound } from "../lib/errors";
import { isoFromSeconds, newId, nowSeconds } from "../lib/ids";

export type SessionRow = typeof checkoutSessions.$inferSelect;

/** Smallest checkout the relayer will pay gas for (SPEC_API relayer check 5). */
export const MIN_AMOUNT_UNITS = 500_000n; // 0.50 USDT
export const DEFAULT_EXPIRES_IN = 30 * 60;

type StoredLineItem = { name: string; unitAmountUnits: string; quantity: number };

/** Line items → base units. Throws on > 2 decimals (zod already checked the format). */
export function priceLineItems(items: { name: string; unitAmount: string; quantity: number }[]) {
  const stored: StoredLineItem[] = items.map((i) => ({
    name: i.name,
    unitAmountUnits: toUnits(i.unitAmount).toString(),
    quantity: i.quantity,
  }));
  const total = stored.reduce((sum, i) => sum + BigInt(i.unitAmountUnits) * BigInt(i.quantity), 0n);
  return { stored, total };
}

function lineItemsOut(row: SessionRow) {
  return (JSON.parse(row.lineItemsJson) as StoredLineItem[]).map((i) => ({
    name: i.name,
    unitAmount: fromUnits(BigInt(i.unitAmountUnits)),
    quantity: i.quantity,
    amount: fromUnits(BigInt(i.unitAmountUnits) * BigInt(i.quantity)),
  }));
}

/** `open` sessions past their expiry read (and are stored) as `expired`. */
export function effectiveStatus(deps: Deps, row: SessionRow): SessionRow["status"] {
  if (row.status === "open" && nowSeconds() > row.expiresAt) {
    deps.db.update(checkoutSessions).set({ status: "expired" }).where(eq(checkoutSessions.id, row.id)).run();
    return "expired";
  }
  return row.status;
}

export function sessionUrl(deps: Deps, id: string) {
  return `${deps.env.PUBLIC_WEB_URL.replace(/\/$/, "")}/c/${id}`;
}

export function toCheckoutSession(deps: Deps, row: SessionRow): CheckoutSession {
  return {
    id: row.id,
    mode: row.mode,
    status: effectiveStatus(deps, row),
    url: sessionUrl(deps, row.id),
    amount: fromUnits(BigInt(row.amountUnits)),
    currency: "USDT",
    lineItems: lineItemsOut(row),
    planId: row.planId,
    reference: row.reference,
    customerEmail: row.customerEmail,
    successUrl: row.successUrl,
    cancelUrl: row.cancelUrl,
    paymentLinkId: row.paymentLinkId,
    payerAddress: row.payerAddress,
    paymentId: row.paymentId,
    subscriptionId: row.subscriptionId,
    txHash: row.txHash,
    expiresAt: isoFromSeconds(row.expiresAt),
    createdAt: isoFromSeconds(row.createdAt),
  };
}

export function toPublicSession(deps: Deps, row: SessionRow, merchant: MerchantRow): PublicSession {
  return {
    id: row.id,
    mode: row.mode,
    status: effectiveStatus(deps, row),
    merchant: { name: merchant.name },
    lineItems: lineItemsOut(row),
    amount: fromUnits(BigInt(row.amountUnits)),
    currency: "USDT",
    plan: planTerms(deps, row),
    successUrl: row.successUrl,
    cancelUrl: row.cancelUrl,
    paymentId: row.paymentId,
    txHash: row.txHash,
    explorerUrl: row.txHash ? explorerTx(row.txHash) : null,
    expiresAt: isoFromSeconds(row.expiresAt),
  };
}

/** Subscription terms for the checkout page ("15.00 USDT every 2 minutes, cap 180.00 over 12 periods"). */
function planTerms(deps: Deps, row: SessionRow) {
  if (row.mode !== "subscription" || !row.planId) return null;
  const plan = deps.db.select().from(plans).where(eq(plans.id, row.planId)).get();
  if (!plan) return null;
  const amount = BigInt(plan.amountUnits);
  return {
    id: plan.id,
    name: plan.name,
    amount: fromUnits(amount),
    periodSeconds: plan.periodSeconds,
    graceSeconds: plan.graceSeconds,
    spendingCap: fromUnits(amount * BigInt(SPENDING_CAP_PERIODS)),
    capPeriods: SPENDING_CAP_PERIODS,
  };
}

/** Number of periods the Permit allowance covers (SPEC_API: permit value = allowance + amount × 12). */
export const SPENDING_CAP_PERIODS = 12 as const;

async function createSubscriptionSession(
  deps: Deps,
  merchant: MerchantRow,
  body: Extract<BodyOf<"createCheckoutSession">, { mode: "subscription" }>,
): Promise<SessionRow> {
  const plan = deps.db.select().from(plans).where(eq(plans.id, body.planId)).get();
  if (!plan || plan.merchantId !== merchant.id) throw notFound("Plan");
  if (!plan.active) throw new ApiError(409, "plan_inactive", "This plan is no longer available.");

  const id = newId("sess");
  const createdAt = nowSeconds();
  const row: SessionRow = {
    id,
    merchantId: merchant.id,
    mode: "subscription",
    status: "open",
    amountUnits: plan.amountUnits,
    lineItemsJson: JSON.stringify([{ name: plan.name, unitAmountUnits: plan.amountUnits, quantity: 1 }]),
    planId: plan.id,
    reference: body.reference,
    customerEmail: body.customerEmail ?? null,
    orderIdHex: orderIdFromSessionId(id),
    invoiceSig: null,
    expiresAt: createdAt + DEFAULT_EXPIRES_IN,
    successUrl: body.successUrl,
    cancelUrl: body.cancelUrl,
    payerAddress: null,
    paymentId: null,
    subscriptionId: null,
    txHash: null,
    paymentLinkId: null,
    lastError: null,
    preparedJson: null,
    createdAt,
  };
  deps.db.insert(checkoutSessions).values(row).run();
  return row;
}

/** The merchant's invoice signer (key encrypted at rest with ENCRYPTION_KEY). */
export function merchantSigner(deps: Deps, merchant: MerchantRow) {
  return privateKeyToAccount(decrypt(merchant.signerKeyEnc, deps.env.ENCRYPTION_KEY) as Hex);
}

export async function createCheckoutSession(
  deps: Deps,
  merchant: MerchantRow,
  body: BodyOf<"createCheckoutSession">,
  opts: { paymentLinkId?: string } = {},
): Promise<SessionRow> {
  if (body.mode === "subscription") return createSubscriptionSession(deps, merchant, body);
  const { stored, total } = priceLineItems(body.lineItems);
  if (total < MIN_AMOUNT_UNITS) {
    throw new ApiError(422, "amount_below_minimum", `Minimum checkout is ${fromUnits(MIN_AMOUNT_UNITS)} USDT.`);
  }

  const id = newId("sess");
  const orderId = orderIdFromSessionId(id);
  const createdAt = nowSeconds();
  const expiresAt = createdAt + (body.expiresInSeconds ?? DEFAULT_EXPIRES_IN);

  // The merchant signs the invoice now; pay() checks it on-chain.
  const invoiceSig = await merchantSigner(deps, merchant).signTypedData(
    invoiceTypedData(deps.chain.quietPay, {
      merchantId: BigInt(merchant.onchainId),
      orderId,
      amount: total,
      expiresAt: BigInt(expiresAt),
    }),
  );

  const row: SessionRow = {
    id,
    merchantId: merchant.id,
    mode: "payment",
    status: "open",
    amountUnits: total.toString(),
    lineItemsJson: JSON.stringify(stored),
    planId: null,
    reference: body.reference,
    customerEmail: body.customerEmail ?? null,
    orderIdHex: orderId,
    invoiceSig,
    expiresAt,
    successUrl: body.successUrl,
    cancelUrl: body.cancelUrl,
    payerAddress: null,
    paymentId: null,
    subscriptionId: null,
    txHash: null,
    paymentLinkId: opts.paymentLinkId ?? null,
    lastError: null,
    preparedJson: null,
    createdAt,
  };
  deps.db.insert(checkoutSessions).values(row).run();
  return row;
}

export function loadSession(deps: Deps, id: string) {
  const row = deps.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, id)).get();
  if (!row) throw notFound("Checkout session");
  const merchant = deps.db.select().from(merchants).where(eq(merchants.id, row.merchantId)).get();
  if (!merchant) throw notFound("Merchant");
  return { row, merchant };
}

/** Session must be open and unexpired to sign or submit. */
export function assertOpen(deps: Deps, row: SessionRow) {
  const status = effectiveStatus(deps, row);
  if (status === "expired") throw new ApiError(409, "session_expired", "This checkout has expired. Go back to the store and try again.");
  if (status !== "open") throw new ApiError(409, "session_not_open", "This checkout is already being paid or is complete.");
}

/** EIP-3009 typed data the payer signs: to = QuietPay, nonce = paymentNonce, validBefore = session expiry. */
export function paymentAuthorization(deps: Deps, row: SessionRow, merchant: MerchantRow, payer: Address) {
  return receiveWithAuthorizationTypedData({
    from: payer,
    to: deps.chain.quietPay,
    value: BigInt(row.amountUnits),
    validAfter: 0n,
    validBefore: BigInt(row.expiresAt),
    nonce: paymentNonce(deps.chain.quietPay, BigInt(merchant.onchainId), row.orderIdHex as Hex),
  });
}

export async function prepareSession(deps: Deps, id: string, payerInput: string): Promise<PrepareSessionResponse> {
  const { row, merchant } = loadSession(deps, id);
  assertOpen(deps, row);
  if (row.mode === "subscription") return prepareSubscription(deps, row, getAddress(payerInput));

  const payer = getAddress(payerInput);
  const amount = BigInt(row.amountUnits);
  const balance = await deps.chain.usdtBalance(payer);
  deps.db.update(checkoutSessions).set({ payerAddress: payer }).where(eq(checkoutSessions.id, id)).run();

  return {
    mode: "payment",
    payer,
    amount: fromUnits(amount),
    balance: fromUnits(balance),
    sufficientBalance: balance >= amount,
    typedData: { payment: toJsonTypedData(paymentAuthorization(deps, row, merchant, payer)) as never },
  };
}

/** What the subscriber signs: Subscribe (QuietPay domain) then Permit (USDT domain). Stored for /submit. */
export type PreparedSubscription = {
  payer: Address;
  onchainPlanId: string;
  subscribe: ReturnType<typeof toJsonTypedData<ReturnType<typeof subscribeTypedData>>>;
  permit: ReturnType<typeof toJsonTypedData<ReturnType<typeof permitTypedData>>>;
};

async function prepareSubscription(deps: Deps, row: SessionRow, payer: Address): Promise<PrepareSessionResponse> {
  const plan = deps.db.select().from(plans).where(eq(plans.id, row.planId!)).get();
  if (!plan) throw notFound("Plan");
  if (!plan.active) throw new ApiError(409, "plan_inactive", "This plan is no longer available.");

  const amount = BigInt(plan.amountUnits);
  const cap = amount * BigInt(SPENDING_CAP_PERIODS);
  const deadline = BigInt(row.expiresAt);
  const [balance, sigNonce, allowance, permitNonce] = await Promise.all([
    deps.chain.usdtBalance(payer),
    deps.chain.sigNonce(payer),
    deps.chain.usdtAllowance(payer),
    deps.chain.usdtNonce(payer),
  ]);

  const prepared: PreparedSubscription = {
    payer,
    onchainPlanId: plan.onchainPlanId,
    subscribe: toJsonTypedData(
      subscribeTypedData(deps.chain.quietPay, {
        planId: BigInt(plan.onchainPlanId),
        subscriber: payer,
        maxAmount: amount,
        nonce: sigNonce,
        deadline,
      }),
    ),
    permit: toJsonTypedData(
      permitTypedData({ owner: payer, spender: deps.chain.quietPay, value: allowance + cap, nonce: permitNonce, deadline }),
    ),
  };
  deps.db
    .update(checkoutSessions)
    .set({ payerAddress: payer, preparedJson: JSON.stringify(prepared) })
    .where(eq(checkoutSessions.id, row.id))
    .run();

  return {
    mode: "subscription",
    payer,
    amount: fromUnits(amount),
    balance: fromUnits(balance),
    sufficientBalance: balance >= amount,
    spendingCap: fromUnits(cap),
    typedData: { subscribe: prepared.subscribe as never, permit: prepared.permit as never },
  };
}
