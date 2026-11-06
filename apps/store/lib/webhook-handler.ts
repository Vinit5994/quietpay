import type { QuietPayEvent } from "@quietpay/node";
import { update } from "./orders";

export type HandleResult = "handled" | "duplicate" | "ignored";

/**
 * Applies a verified QuietPay event to the store's own data.
 * Webhooks are delivered at least once, so the event id is used as an idempotency key.
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

    if (
      event.type === "subscription.created" ||
      event.type === "subscription.renewed" ||
      event.type === "subscription.payment_failed" ||
      event.type === "subscription.canceled"
    ) {
      const box = d.boxes.find((b) => b.id === event.data.merchantReference);
      if (box) {
        // Events can arrive out of order on retries: never move a canceled box back, never lower the cycle.
        if (box.status !== "canceled") {
          box.status = event.data.status === "past_due" ? "past_due" : event.data.status === "canceled" ? "canceled" : "active";
          box.cycle = Math.max(box.cycle, event.data.cycle);
          box.nextChargeAt = event.data.nextChargeAt;
          box.pastDueSince = event.data.pastDueSince;
          box.cancelReason = event.data.cancelReason;
        }
        box.subscriptionId = event.data.subscriptionId;
        if (event.data.explorerUrl) box.lastTxUrl = event.data.explorerUrl;
        box.updatedAt = now;
        result = "handled";
      }
    }

    d.handledEvents.push(event.id);
    if (d.handledEvents.length > 1000) d.handledEvents.splice(0, d.handledEvents.length - 1000);
    return result;
  });
}
