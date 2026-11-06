import type { QuietPayEvent } from "@quietpay/node";
import { update } from "./orders";

export type HandleResult = "handled" | "duplicate" | "ignored";

/**
 * Applies a verified QuietPay event to the store's own data.
 * Webhooks are delivered at least once, so the event id is used as an idempotency key.
 * Subscription (Builder Box) events are handled in B7.
 */
export function handleQuietPayEvent(event: QuietPayEvent): HandleResult {
  return update((d) => {
    if (d.handledEvents.includes(event.id)) return "duplicate";
    const now = new Date().toISOString();
    let result: HandleResult = "ignored";

    if (event.type === "payment.succeeded" && event.data.kind === "checkout") {
      const order = d.orders.find((o) => o.id === event.data.merchantReference);
      if (order) {
        if (order.status === "pending" || order.status === "expired") order.status = "paid";
        order.paymentId = event.data.paymentId;
        order.txHash = event.data.txHash;
        order.explorerUrl = event.data.explorerUrl;
        order.updatedAt = now;
        result = "handled";
      }
    }

    if (event.type === "refund.succeeded") {
      const order = d.orders.find((o) => o.id === event.data.merchantReference);
      if (order) {
        order.refunded = event.data.totalRefunded;
        order.status = event.data.fullyRefunded ? "refunded" : "partially_refunded";
        order.updatedAt = now;
        result = "handled";
      }
    }

    d.handledEvents.push(event.id);
    if (d.handledEvents.length > 1000) d.handledEvents.splice(0, d.handledEvents.length - 1000);
    return result;
  });
}
