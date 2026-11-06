import { eq } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  explorerTx,
  fromUnits,
  invoiceTypedData,
  orderIdFromSessionId,
  paymentNonce,
  receiveWithAuthorizationTypedData,
  toJsonTypedData,
  toUnits,
  type BodyOf,
  type CheckoutSession,
  type PrepareSessionResponse,
  type PublicSession,
} from "@quietpay/shared";
import { checkoutSessions, merchants } from "../db/schema";
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
    plan: null, // subscription terms arrive with A9
    successUrl: row.successUrl,
    cancelUrl: row.cancelUrl,
    paymentId: row.paymentId,
    txHash: row.txHash,
    explorerUrl: row.txHash ? explorerTx(row.txHash) : null,
    expiresAt: isoFromSeconds(row.expiresAt),
  };
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
  if (body.mode !== "payment") {
    throw new ApiError(400, "bad_request", "Subscription checkout is not available yet.");
  }
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
  if (row.mode !== "payment") throw new ApiError(400, "bad_request", "Subscription checkout is not available yet.");

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
