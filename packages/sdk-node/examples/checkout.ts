/**
 * One-time checkout: create a session on your server and redirect the customer.
 * Typechecked with the package (`pnpm --filter @quietpay/node typecheck`), so it can't drift from the SDK.
 */
import { QuietPay, QuietPayError } from "../src";

declare function redirect(url: string): never;
declare const STORE_URL: string;
type Order = { id: string; items: { name: string; price: string; qty: number }[] };

// Create the client lazily so builds without env vars don't throw at import time.
let client: QuietPay | undefined;
export const qp = () => (client ??= new QuietPay(process.env.QUIETPAY_SECRET_KEY!));

export async function checkout(order: Order) {
  try {
    const session = await qp().checkout.sessions.create({
      mode: "payment",
      reference: order.id,
      lineItems: order.items.map((i) => ({ name: i.name, unitAmount: i.price, quantity: i.qty })),
      successUrl: `${STORE_URL}/orders/${order.id}`,
      cancelUrl: `${STORE_URL}/cart`,
    });
    redirect(session.url);
  } catch (err) {
    if (err instanceof QuietPayError && err.code === "amount_below_minimum") {
      throw new Error("Orders must be at least 0.50 USDT.");
    }
    throw err;
  }
}

export async function orderStatus(sessionId: string) {
  const s = await qp().checkout.sessions.retrieve(sessionId);
  return s.status === "complete" ? { paid: true, tx: s.txHash, payment: s.paymentId } : { paid: false, status: s.status };
}
