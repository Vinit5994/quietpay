import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEvent } from "@quietpay/shared/api-types";
import { QuietPayError } from "./errors";

export type QuietPayEvent = WebhookEvent;

/** Same as WEBHOOK_TOLERANCE_SECONDS in @quietpay/shared (copied so the SDK has no runtime dependency). */
const DEFAULT_TOLERANCE_SECONDS = 300;

export type VerifyOptions = {
  /** Max age of the signature in seconds (default 300). */
  toleranceSeconds?: number;
  /** Current unix time in seconds (for tests). */
  now?: number;
};

function hmac(secret: string, timestamp: number | string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Builds a `QuietPay-Signature` header value: `t=<unix>,v1=<hex>`. Used by the API, the mock API and tests. */
export function signWebhook(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmac(secret, timestamp, rawBody)}`;
}

/**
 * Verifies a webhook and returns the parsed event. Throws `QuietPayError("invalid_webhook_signature")`
 * if the header is missing or malformed, the signature doesn't match, or it is older than 5 minutes.
 * Pass the **raw** request body (`await req.text()`), not re-serialized JSON.
 */
export function verifyWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
  options: VerifyOptions = {},
): QuietPayEvent {
  const fail = (message: string): never => {
    throw new QuietPayError("invalid_webhook_signature", message, 400);
  };
  if (!signatureHeader) fail("Missing QuietPay-Signature header");
  if (!secret) fail("Missing webhook secret");

  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of signatureHeader!.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t") timestamp = value;
    else if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) fail("Malformed QuietPay-Signature header");

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - Number(timestamp)) > tolerance) fail("Webhook signature is too old (or from the future)");

  const expected = hmac(secret, timestamp!, rawBody);
  if (!signatures.some((s) => safeEqualHex(s, expected))) fail("Webhook signature does not match");

  try {
    return JSON.parse(rawBody) as QuietPayEvent;
  } catch {
    return fail("Webhook body is not valid JSON");
  }
}
