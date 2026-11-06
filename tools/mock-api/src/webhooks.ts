import { signWebhook } from "@quietpay/node";
import { WEBHOOK_RETRY_DELAYS_SECONDS, WebhookEvent, type WebhookEventType } from "@quietpay/shared";
import { newId, type DeliveryRec, type MockState } from "./state";

/**
 * Build an event, check it against the shared schema, then deliver it signed with the SDK's
 * `signWebhook` (so the store's `verifyWebhook` accepts it) and the shared retry schedule.
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
  const delivery: DeliveryRec = {
    id: newId("whd"),
    merchantId,
    eventId: event.id,
    type,
    status: "pending",
    attempts: 0,
    nextAttemptAt: null,
    lastStatusCode: null,
    lastError: null,
    url: merchant.webhookUrl ?? state.config.webhookUrl,
    event,
    rawBody: JSON.stringify(event),
    createdAt: new Date(),
  };
  state.deliveries.unshift(delivery);

  if (!merchant.webhookUrl) {
    delivery.status = "failed";
    delivery.lastError = "No webhook URL set";
    return delivery;
  }
  await attempt(delivery, merchant.webhookSecret);
  return delivery;
}

async function attempt(d: DeliveryRec, secret: string): Promise<void> {
  d.attempts += 1;
  d.nextAttemptAt = null;
  try {
    const res = await fetch(d.url, {
      method: "POST",
      headers: { "content-type": "application/json", "quietpay-signature": signWebhook(d.rawBody, secret) },
      body: d.rawBody,
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
  const delaySeconds = WEBHOOK_RETRY_DELAYS_SECONDS[d.attempts - 1];
  if (delaySeconds === undefined) {
    d.status = "failed";
    console.warn(`[mock] webhook ${d.type} to ${d.url} failed after ${d.attempts} attempts: ${d.lastError}`);
    return;
  }
  d.nextAttemptAt = new Date(Date.now() + delaySeconds * 1000);
  setTimeout(() => void attempt(d, secret), delaySeconds * 1000).unref?.();
}
