import { and, asc, eq, isNotNull, lte } from "drizzle-orm";
import { signWebhook } from "@quietpay/node";
import {
  WEBHOOK_RETRY_DELAYS_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  WebhookEvent,
  type WebhookDelivery,
  type WebhookEventType,
} from "@quietpay/shared";
import { merchants, webhookDeliveries } from "../db/schema";
import type { Deps, MerchantRow } from "../deps";
import { isoFromSeconds, newId, nowSeconds } from "../lib/ids";

/** 5 attempts in total: now, then +1s, +5s, +30s, +2m (SPEC_API "Webhooks"). */
export const MAX_ATTEMPTS = 5;
const TIMEOUT_MS = 5_000;

type DeliveryRow = typeof webhookDeliveries.$inferSelect;
type DataOf<T extends WebhookEventType> = Extract<WebhookEvent, { type: T }>["data"];

/**
 * Builds the envelope, validates it against the shared schema and queues a delivery.
 * Returns null when the merchant has no webhook URL yet.
 */
export function enqueueWebhook<T extends WebhookEventType>(deps: Deps, merchant: MerchantRow, type: T, data: DataOf<T>) {
  if (!merchant.webhookUrl) return null;
  const now = nowSeconds();
  const event = WebhookEvent.parse({ id: newId("evt"), type, createdAt: isoFromSeconds(now), data });
  const row: DeliveryRow = {
    id: newId("whd"),
    merchantId: merchant.id,
    eventId: event.id,
    type,
    url: merchant.webhookUrl,
    payloadJson: JSON.stringify(event),
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    lastStatusCode: null,
    lastError: null,
    createdAt: now,
  };
  deps.db.insert(webhookDeliveries).values(row).run();
  return row;
}

export function toWebhookDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    eventId: row.eventId,
    type: row.type as WebhookEventType,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.status === "pending" && row.nextAttemptAt ? isoFromSeconds(row.nextAttemptAt) : null,
    lastStatusCode: row.lastStatusCode,
    lastError: row.lastError,
    url: row.url,
    payload: JSON.parse(row.payloadJson),
    createdAt: isoFromSeconds(row.createdAt),
  };
}

/** Sends due deliveries with the `QuietPay-Signature` header and reschedules failures. */
export class Dispatcher {
  private running = false;

  constructor(
    private readonly deps: Deps,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly now: () => number = nowSeconds,
  ) {}

  /** One pass over due deliveries. Safe to call on an interval; overlapping calls are skipped. */
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const due = this.deps.db
        .select()
        .from(webhookDeliveries)
        .where(and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, this.now())))
        .orderBy(asc(webhookDeliveries.createdAt))
        .all();
      for (const row of due) await this.attempt(row);
    } finally {
      this.running = false;
    }
  }

  /**
   * Delivers one row now and records the result. The row is claimed first (attempts must still match),
   * so the 1s loop and "send test event" can never both send the same delivery.
   */
  async attempt(row: DeliveryRow): Promise<DeliveryRow> {
    const claimed = this.deps.db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: null })
      .where(
        and(
          eq(webhookDeliveries.id, row.id),
          eq(webhookDeliveries.status, "pending"),
          eq(webhookDeliveries.attempts, row.attempts),
          isNotNull(webhookDeliveries.nextAttemptAt),
        ),
      )
      .run();
    if (claimed.changes === 0) {
      return this.deps.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, row.id)).get() ?? row;
    }
    const merchant = this.deps.db.select().from(merchants).where(eq(merchants.id, row.merchantId)).get();
    const attempts = row.attempts + 1;
    let statusCode: number | null = null;
    let error: string | null = null;

    try {
      const res = await this.fetchImpl(row.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "QuietPay-Webhooks/1",
          [WEBHOOK_SIGNATURE_HEADER]: signWebhook(row.payloadJson, merchant?.webhookSecret ?? "", this.now()),
        },
        body: row.payloadJson,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      statusCode = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const ok = error === null;
    const giveUp = !ok && attempts >= MAX_ATTEMPTS;
    const update = {
      attempts,
      lastStatusCode: statusCode,
      lastError: error,
      status: ok ? ("succeeded" as const) : giveUp ? ("failed" as const) : ("pending" as const),
      nextAttemptAt: ok || giveUp ? null : this.now() + WEBHOOK_RETRY_DELAYS_SECONDS[attempts - 1]!,
    };
    this.deps.db.update(webhookDeliveries).set(update).where(eq(webhookDeliveries.id, row.id)).run();
    if (!ok) console.warn(`[webhooks] ${row.type} ${row.eventId} attempt ${attempts} failed: ${error}`);
    return { ...row, ...update };
  }
}
