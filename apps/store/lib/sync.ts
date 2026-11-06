import "server-only";
import { getOrder, setOrder, type Order } from "./orders";
import { qp } from "./quietpay";

/**
 * Safety net for a missed webhook: when a pending order is viewed, ask QuietPay for the
 * checkout session's status. Webhooks remain the main path; this only fills gaps.
 */
export async function syncPendingOrder(order: Order): Promise<Order> {
  if (order.status !== "pending" || !order.sessionId) return order;
  try {
    const session = await qp.checkout.sessions.retrieve(order.sessionId);
    if (session.status === "complete") {
      return setOrder(order.id, { status: "paid", paymentId: session.paymentId, txHash: session.txHash }) ?? order;
    }
    if (session.status === "expired") return setOrder(order.id, { status: "expired" }) ?? order;
  } catch (err) {
    console.warn("[sync] could not check session", order.sessionId, (err as Error).message);
  }
  return getOrder(order.id) ?? order;
}
