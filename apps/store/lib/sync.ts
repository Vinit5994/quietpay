import "server-only";
import { getOrder, setBox, setOrder, findBox, type Box, type Order } from "./orders";
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

/** Same safety net for a Builder Box that is still waiting for its first payment. */
export async function syncPendingBox(box: Box): Promise<Box> {
  if (box.status !== "pending" || !box.sessionId) return box;
  try {
    const session = await qp.checkout.sessions.retrieve(box.sessionId);
    if (session.status === "complete") return setBox(box.id, { status: "active", subscriptionId: session.subscriptionId }) ?? box;
    if (session.status === "expired") return setBox(box.id, { status: "canceled", cancelReason: null }) ?? box;
  } catch (err) {
    console.warn("[sync] could not check session", box.sessionId, (err as Error).message);
  }
  return findBox(box.id) ?? box;
}
