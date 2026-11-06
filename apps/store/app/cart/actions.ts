"use server";

import { redirect } from "next/navigation";
import { createOrder, type CartItemInput } from "@/lib/orders";

/**
 * Creates the order in the store's own database. B6 adds the QuietPay part here:
 * `qp.checkout.sessions.create(...)` and a redirect to the hosted checkout.
 */
export async function checkout(items: CartItemInput[]): Promise<{ error: string } | never> {
  let orderId: string;
  try {
    orderId = createOrder(items).id;
  } catch (err) {
    return { error: (err as Error).message };
  }
  redirect(`/orders/${orderId}`);
}
