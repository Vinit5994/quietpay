import { and, eq, inArray } from "drizzle-orm";
import { formatEther, getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { fromUnits, type GasSummary, type Merchant, type ResponseOf } from "@quietpay/shared";
import { issueJwt } from "../auth";
import { gasTopups, merchants, payments, refunds, relayerTxs, subscriptions } from "../db/schema";
import type { Deps, JwtClaims, MerchantRow } from "../deps";
import { encrypt, newSecretKey, newWebhookSecret } from "../lib/crypto";
import { ApiError } from "../lib/errors";
import { isoFromSeconds, newId, nowSeconds } from "../lib/ids";
import { RateLimiter } from "../relayer/ratelimit";
import { planById } from "./plans";

/** Demo budget for new merchants (SPEC_API): 0.05 WBT. */
export const NEW_MERCHANT_GAS_BUDGET_WEI = 50_000_000_000_000_000n;
const DAY = 86_400;
const MONTH = 30 * DAY;

export function toMerchant(row: MerchantRow): Merchant {
  return {
    id: row.id,
    name: row.name,
    onchainId: row.onchainId,
    payoutAddress: row.payoutAddress,
    signerAddress: row.signerAddress,
    secretKeyPrefix: row.secretKeyPrefix,
    webhookUrl: row.webhookUrl,
    createdAt: isoFromSeconds(row.createdAt),
  };
}

export function gasSummary(deps: Deps, merchant: MerchantRow): GasSummary {
  const budget = BigInt(merchant.gasBudgetWei);
  const spent = BigInt(merchant.gasSpentWei);
  const remaining = budget > spent ? budget - spent : 0n;
  const txCount = deps.db
    .select()
    .from(relayerTxs)
    .where(and(eq(relayerTxs.merchantId, merchant.id), eq(relayerTxs.status, "succeeded")))
    .all().length;
  return {
    budgetWei: budget.toString(),
    spentWei: spent.toString(),
    remainingWei: remaining.toString(),
    budget: formatEther(budget),
    spent: formatEther(spent),
    remaining: formatEther(remaining),
    txCount,
  };
}

export function overview(deps: Deps, merchant: MerchantRow): ResponseOf<"dashOverview"> {
  const now = nowSeconds();
  const mine = deps.db.select().from(payments).where(eq(payments.merchantId, merchant.id)).all();
  const sum = (since: number) =>
    mine.filter((p) => p.paidAt >= since).reduce((s, p) => s + BigInt(p.amountUnits), 0n);

  const subs = deps.db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.merchantId, merchant.id), inArray(subscriptions.status, ["active", "past_due"])))
    .all();
  // MRR: each active subscription's amount scaled to a 30-day month
  const mrr = subs
    .filter((s) => s.status === "active")
    .reduce((total, s) => {
      const plan = planById(deps, s.planId);
      if (!plan || plan.periodSeconds <= 0) return total;
      return total + (BigInt(plan.amountUnits) * BigInt(MONTH)) / BigInt(plan.periodSeconds);
    }, 0n);

  const done = mine.length
    ? deps.db
        .select()
        .from(refunds)
        .where(and(eq(refunds.status, "succeeded"), inArray(refunds.paymentId, mine.map((p) => p.id))))
        .all()
    : [];

  return {
    volume24h: fromUnits(sum(now - DAY)),
    volume7d: fromUnits(sum(now - 7 * DAY)),
    mrr: fromUnits(mrr),
    activeSubscriptions: subs.filter((s) => s.status === "active").length,
    pastDueSubscriptions: subs.filter((s) => s.status === "past_due").length,
    refundsCount: done.length,
    refundsTotal: fromUnits(done.reduce((s, r) => s + BigInt(r.amountUnits), 0n)),
    paymentsCount: mine.length,
    gas: gasSummary(deps, merchant),
  };
}

/** Onboarding registers a merchant on-chain (relayer pays gas): cap it so sign-ins can't drain the relayer. */
const onboardingLimit = new RateLimiter(5, 60 * 60); // 5 new merchants / hour per instance

/** POST /dash/merchant: first dashboard visit. Payout = the signed-in wallet. Secret key + webhook secret shown once. */
export async function onboardMerchant(deps: Deps, jwt: JwtClaims, body: { name: string; payoutAddress: string }) {
  if (jwt.mid) throw new ApiError(409, "conflict", "This wallet already has a merchant account.");
  const payout = getAddress(body.payoutAddress);
  if (payout.toLowerCase() !== jwt.sub.toLowerCase()) {
    throw new ApiError(400, "bad_request", "The payout wallet must be the wallet you signed in with.");
  }
  if (deps.db.select().from(merchants).where(eq(merchants.payoutAddressLc, payout.toLowerCase())).get()) {
    throw new ApiError(409, "conflict", "This wallet already has a merchant account. Sign in again.");
  }
  if (!onboardingLimit.take("all")) throw new ApiError(429, "rate_limited", "Too many new merchants right now. Try again later.");

  const signerKey = generatePrivateKey();
  const signer = privateKeyToAccount(signerKey);
  const { merchantId } = await deps.chain.registerMerchant(payout, signer.address);

  const sk = newSecretKey();
  const webhookSecret = newWebhookSecret();
  const row: MerchantRow = {
    id: newId("mer"),
    name: body.name,
    onchainId: merchantId.toString(),
    payoutAddress: payout,
    payoutAddressLc: payout.toLowerCase(),
    signerAddress: signer.address,
    signerKeyEnc: encrypt(signerKey, deps.env.ENCRYPTION_KEY),
    secretKeyHash: sk.hash,
    secretKeyPrefix: sk.prefix,
    webhookUrl: null,
    webhookSecret,
    gasBudgetWei: NEW_MERCHANT_GAS_BUDGET_WEI.toString(),
    gasSpentWei: "0",
    createdAt: nowSeconds(),
  };
  deps.db.insert(merchants).values(row).run();
  const { token } = await issueJwt(deps, { sub: jwt.sub, role: "merchant", mid: row.id });
  return { merchant: toMerchant(row), secretKey: sk.key, webhookSecret, token };
}

/** POST /dash/keys/rotate: the old secret key stops working immediately. */
export function rotateKey(deps: Deps, merchant: MerchantRow) {
  const sk = newSecretKey();
  deps.db.update(merchants).set({ secretKeyHash: sk.hash, secretKeyPrefix: sk.prefix }).where(eq(merchants.id, merchant.id)).run();
  return { secretKey: sk.key, secretKeyPrefix: sk.prefix };
}

/**
 * POST /dash/gas/topup: a successful WBT transfer from the merchant's payout wallet to the relayer
 * raises the gas budget by its value. Each tx counts once.
 */
export async function gasTopup(deps: Deps, merchant: MerchantRow, txHash: Hex) {
  if (deps.db.select().from(gasTopups).where(eq(gasTopups.txHash, txHash.toLowerCase())).get()) {
    throw new ApiError(409, "conflict", "This top-up was already counted.");
  }
  const tx = await deps.chain.nativeTransfer(txHash);
  if (!tx || !tx.success) throw new ApiError(404, "not_found", "Transaction not found or not successful yet.");
  if (tx.to?.toLowerCase() !== deps.chain.relayerAddress.toLowerCase()) {
    throw new ApiError(400, "bad_request", `Send WBT to the relayer ${deps.chain.relayerAddress}.`);
  }
  if (tx.from.toLowerCase() !== merchant.payoutAddress.toLowerCase()) {
    throw new ApiError(400, "bad_request", "The top-up must come from your payout wallet.");
  }
  if (tx.value <= 0n) throw new ApiError(400, "bad_request", "The transaction sent no WBT.");

  deps.db.insert(gasTopups).values({ txHash: txHash.toLowerCase(), merchantId: merchant.id, valueWei: tx.value.toString(), createdAt: nowSeconds() }).run();
  const budget = (BigInt(merchant.gasBudgetWei) + tx.value).toString();
  deps.db.update(merchants).set({ gasBudgetWei: budget }).where(eq(merchants.id, merchant.id)).run();
  return gasSummary(deps, deps.db.select().from(merchants).where(eq(merchants.id, merchant.id)).get()!);
}

