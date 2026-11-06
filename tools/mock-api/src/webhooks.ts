import { createHmac } from "node:crypto";
import { WebhookEvent, type WebhookEventType } from "@quietpay/shared";
import { newId, type DeliveryRec, type MockState } from "./state";

/** Same retry schedule as the real API (docs/SPEC_API.md "Webhooks"). */
const RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 120_000, 600_000];

/** `QuietPay-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<rawBody>")>` */
export function signWebhook(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/**
 * Build an event, check it against the shared schema, then deliver it with retries.
 * Returns the delivery record after the first attempt.
 */
export async function emitWebhook(
  state: MockState,
  merchantId: string,
  type: WebhookEventType,
  data: Record<string, unknown>,
): Promise<DeliveryRec | null> {
  const merchant = state.merchants.find((m) => m.id === merchantId);
  if (!merchant) return null;

  const event = WebhookEvent.parse({ id: newId("evt"), type, createdAt: new Date().toISOString(), data });
  const payload = JSON.stringify(event);
  const delivery: DeliveryRec = {
    id: newId("whd"),
    merchantId,
    eventId: event.id,
    type,
    status: "pending",
    attempts: 0,
    lastStatusCode: null,
    lastError: null,
    payload,
    createdAt: new Date(),
  };
  state.deliveries.unshift(delivery);

  if (!merchant.webhookUrl) {
    delivery.status = "failed";
    delivery.lastError = "No webhook URL set";
    return delivery;
  }
  await attempt(state, delivery, merchant.webhookUrl, merchant.webhookSecret);
  return delivery;
}

async function attempt(state: MockState, d: DeliveryRec, url: string, secret: string): Promise<void> {
  d.attempts += 1;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "quietpay-signature": signWebhook(secret, d.payload) },
      body: d.payload,
      signal: AbortSignal.timeout(5_000),
    });
    d.lastStatusCode = res.status;
    d.lastError = res.ok ? null : `HTTP ${res.status}`;
    if (res.ok) {
      d.status = "succeeded";
      return;
    }
  } catch (err) {
    d.lastStatusCode = null;
    d.lastError = (err as Error).message;
  }
  const delay = RETRY_DELAYS_MS[d.attempts - 1];
  if (delay === undefined) {
    d.status = "failed";
    console.warn(`[mock] webhook ${d.type} to ${url} failed after ${d.attempts} attempts: ${d.lastError}`);
    return;
  }
  setTimeout(() => void attempt(state, d, url, secret), delay).unref?.();
}
