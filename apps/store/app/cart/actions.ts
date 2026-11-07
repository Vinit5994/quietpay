"use server";

import { createOrder, setOrder, type CartItemInput } from "@/lib/orders";
import { qp, STORE_URL } from "@/lib/quietpay";

export async function checkout(items: CartItemInput[]): Promise<{ url: string } | { error: string }> {
  let url: string;
  try {
    const order = createOrder(items);
    const session = await qp.checkout.sessions.create({
      mode: "payment",
      reference: order.id,
      lineItems: order.lines.map((l) => ({ name: l.name, unitAmount: l.unitPrice, quantity: l.qty })),
      successUrl: `${STORE_URL}/orders/${order.id}`,
      cancelUrl: `${STORE_URL}/cart`,
    });
    setOrder(order.id, { sessionId: session.id, checkoutUrl: session.url });
    url = session.url;
  } catch (err) {
    console.error("[checkout]", err);
    return { error: "We couldn't start the payment. Please try again in a moment." };
  }
  // The client opens this in a QuietPay pop-up (or redirects on phones).
  return { url };
}
