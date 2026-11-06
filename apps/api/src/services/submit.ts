import { and, eq } from "drizzle-orm";
import { getAddress, parseEventLogs, type Hex } from "viem";
import { explorerTx, fromUnits, quietPayAbi, type SessionStatusResponse, type SubmitSessionRequest } from "@quietpay/shared";
import { checkoutSessions } from "../db/schema";
import type { Deps } from "../deps";
import { ApiError } from "../lib/errors";
import type { Relayer } from "../relayer";
import { findCheckoutPayment, recordCheckoutPayment } from "./payments";
import { planById } from "./plans";
import {
  MIN_AMOUNT_UNITS,
  assertOpen,
  loadSession,
  paymentAuthorization,
  type PreparedSubscription,
  type SessionRow,
} from "./sessions";
import { recordSubscriptionPayment, recordSubscriptionStart } from "./subscriptions";

/** Puts a session back to `open` with the error the checkout page should show. */
function release(deps: Deps, id: string, err: ApiError) {
  deps.db
    .update(checkoutSessions)
    .set({ status: "open", lastError: JSON.stringify({ code: err.code, message: err.message }) })
    .where(eq(checkoutSessions.id, id))
    .run();
}

/**
 * POST /public/sessions/:id/submit: SPEC_API relayer checks in order.
 * 1 allowed target (relayer) · 2 session state · 3 signature · 4 balance · 5 minimum · 6 rate limits
 * · 7 gas budget · 8 simulate · 9 send · 10 low-balance alert (relayer).
 */
export async function submitPayment(
  deps: Deps,
  relayer: Relayer,
  sessionId: string,
  body: SubmitSessionRequest,
  ip: string,
): Promise<{ txHash: Hex; status: "processing" }> {
  // 2. session exists, open, not expired, and nobody else is submitting it (atomic claim)
  const { row, merchant } = loadSession(deps, sessionId);
  assertOpen(deps, row);
  const claimed = deps.db
    .update(checkoutSessions)
    .set({ status: "processing", lastError: null })
    .where(and(eq(checkoutSessions.id, sessionId), eq(checkoutSessions.status, "open")))
    .run();
  if (claimed.changes === 0) throw new ApiError(409, "session_not_open", "This checkout is already being paid.");

  try {
    return row.mode === "subscription"
      ? await afterClaimSubscription(deps, relayer, row, merchant, body, ip)
      : await afterClaim(deps, relayer, row, merchant, body, ip);
  } catch (err) {
    const e = err instanceof ApiError ? err : new ApiError(500, "internal_error", "Something went wrong on our side.");
    release(deps, sessionId, e);
    throw err;
  }
}

async function afterClaim(
  deps: Deps,
  relayer: Relayer,
  row: SessionRow,
  merchant: ReturnType<typeof loadSession>["merchant"],
  body: SubmitSessionRequest,
  ip: string,
) {
  // 3. signature: must be the payer from /prepare, over exactly the typed data /prepare returned
  const payer = getAddress(body.payer);
  if (!row.payerAddress || row.payerAddress.toLowerCase() !== payer.toLowerCase()) {
    throw new ApiError(400, "invalid_signature", "Payer does not match this checkout. Reload the page and try again.");
  }
  const signature = body.signatures.payment as Hex | undefined;
  if (!signature) throw new ApiError(400, "bad_request", "Missing signatures.payment.");
  const typedData = paymentAuthorization(deps, row, merchant, payer);
  const valid = await deps.chain.verifyTypedData({ ...typedData, address: payer, signature });
  if (!valid) throw new ApiError(400, "invalid_signature", "The payment signature doesn't match. Sign again.");

  // 4. balance
  const amount = BigInt(row.amountUnits);
  const balance = await deps.chain.usdtBalance(payer);
  if (balance < amount) {
    throw new ApiError(
      402,
      "insufficient_balance",
      `Your wallet has ${fromUnits(balance)} USDT; this order needs ${fromUnits(amount)} USDT. Add funds and try again.`,
    );
  }

  // 5. minimum amount
  if (amount < MIN_AMOUNT_UNITS) {
    throw new ApiError(422, "amount_below_minimum", `Minimum checkout is ${fromUnits(MIN_AMOUNT_UNITS)} USDT.`);
  }

  // 6. rate limits
  checkLimits(relayer, ip, payer);

  // 7–10. gas budget, simulate, send, receipt
  const expiresAt = BigInt(row.expiresAt);
  const txHash = await relayer.relay({
    fn: "pay",
    args: [BigInt(merchant.onchainId), row.orderIdHex, amount, expiresAt, row.invoiceSig, payer, 0n, expiresAt, signature],
    merchant,
    purpose: "pay",
    onReceipt: (receipt, hash) => {
      const log = receipt.status === "success" ? findCheckoutPayment(receipt.logs, row.orderIdHex) : undefined;
      if (!log) {
        release(deps, row.id, new ApiError(500, "transaction_failed", "The payment did not go through. Nothing was charged; try again."));
        return;
      }
      recordCheckoutPayment(deps, row, log.args, { txHash: hash, blockNumber: receipt.blockNumber });
    },
    onError: (err) => release(deps, row.id, err),
  });
  deps.db.update(checkoutSessions).set({ txHash, payerAddress: payer }).where(eq(checkoutSessions.id, row.id)).run();
  return { txHash, status: "processing" as const };
}

function checkLimits(relayer: Relayer, ip: string, payer: string) {
  if (!relayer.limits.perIp.take(ip) || !relayer.limits.perPayer.take(payer.toLowerCase()) || !relayer.limits.global.take("all")) {
    throw new ApiError(429, "rate_limited", "Too many payment attempts. Wait a minute and try again.");
  }
}

/** Subscription mode: same ordered checks; relays `subscribe` (first period is charged inside it). */
async function afterClaimSubscription(
  deps: Deps,
  relayer: Relayer,
  row: SessionRow,
  merchant: ReturnType<typeof loadSession>["merchant"],
  body: SubmitSessionRequest,
  ip: string,
) {
  // 3. both signatures, over exactly what /prepare returned, from the prepared payer
  const payer = getAddress(body.payer);
  const prepared = row.preparedJson ? (JSON.parse(row.preparedJson) as PreparedSubscription) : null;
  if (!prepared || prepared.payer.toLowerCase() !== payer.toLowerCase()) {
    throw new ApiError(400, "invalid_signature", "Payer does not match this checkout. Reload the page and try again.");
  }
  const subscribeSig = body.signatures.subscribe as Hex | undefined;
  const permitSig = body.signatures.permit as Hex | undefined;
  if (!subscribeSig || !permitSig) throw new ApiError(400, "bad_request", "Missing signatures.subscribe or signatures.permit.");
  const [subOk, permitOk] = await Promise.all([
    deps.chain.verifyTypedData({ ...(prepared.subscribe as object), address: payer, signature: subscribeSig } as never),
    deps.chain.verifyTypedData({ ...(prepared.permit as object), address: payer, signature: permitSig } as never),
  ]);
  if (!subOk || !permitOk) throw new ApiError(400, "invalid_signature", "A subscription signature doesn't match. Sign again.");

  // 4. balance covers the first period
  const plan = planById(deps, row.planId!);
  if (!plan) throw new ApiError(409, "plan_inactive", "This plan is no longer available.");
  const amount = BigInt(plan.amountUnits);
  const balance = await deps.chain.usdtBalance(payer);
  if (balance < amount) {
    throw new ApiError(
      402,
      "insufficient_balance",
      `Your wallet has ${fromUnits(balance)} USDT; the first period needs ${fromUnits(amount)} USDT. Add funds and try again.`,
    );
  }
  // 5. minimum
  if (amount < MIN_AMOUNT_UNITS) throw new ApiError(422, "amount_below_minimum", `Minimum is ${fromUnits(MIN_AMOUNT_UNITS)} USDT.`);
  // 6. rate limits
  checkLimits(relayer, ip, payer);

  // 7–10
  const s = prepared.subscribe.message;
  const p = prepared.permit.message;
  const txHash = await relayer.relay({
    fn: "subscribe",
    args: [BigInt(s.planId), payer, BigInt(s.maxAmount), BigInt(s.deadline), subscribeSig, BigInt(p.value), BigInt(p.deadline), permitSig],
    merchant,
    purpose: "subscribe",
    onReceipt: async (receipt, hash) => {
      const subscribed = receipt.status === "success"
        ? parseEventLogs({ abi: quietPayAbi, eventName: "Subscribed", logs: receipt.logs })[0]
        : undefined;
      if (!subscribed) {
        release(deps, row.id, new ApiError(500, "transaction_failed", "The subscription did not go through. Nothing was charged; try again."));
        return;
      }
      const onchain = await deps.chain.readSub(subscribed.args.subId);
      const { row: sub } = recordSubscriptionStart(deps, {
        subId: subscribed.args.subId,
        plan,
        subscriber: payer,
        nextChargeAt: Number(onchain.nextChargeAt),
        txHash: hash,
      });
      const paid = parseEventLogs({ abi: quietPayAbi, eventName: "PaymentReceived", logs: receipt.logs }).find((l) => l.args.kind === 1);
      if (paid) recordSubscriptionPayment(deps, sub, paid.args, { txHash: hash, blockNumber: receipt.blockNumber });
    },
    onError: (err) => release(deps, row.id, err),
  });
  deps.db.update(checkoutSessions).set({ txHash, payerAddress: payer }).where(eq(checkoutSessions.id, row.id)).run();
  return { txHash, status: "processing" as const };
}

/** GET /public/sessions/:id/status (polled every 1s by the checkout page). */
export function sessionStatus(deps: Deps, sessionId: string): SessionStatusResponse {
  const { row } = loadSession(deps, sessionId);
  // re-read the row after effectiveStatus may have expired it
  const status = row.status === "open" && Math.floor(Date.now() / 1000) > row.expiresAt ? "expired" : row.status;
  const web = deps.env.PUBLIC_WEB_URL.replace(/\/$/, "");
  const complete = status === "complete";
  const error = status === "open" && row.lastError ? (JSON.parse(row.lastError) as { code: string; message: string }) : null;
  return {
    status,
    txHash: row.txHash,
    explorerUrl: row.txHash ? explorerTx(row.txHash) : null,
    paymentId: row.paymentId,
    subscriptionId: row.subscriptionId,
    receiptUrl: complete && row.paymentId ? `${web}/r/${row.paymentId}` : null,
    redirectUrl: complete ? row.successUrl : null,
    error,
  };
}
