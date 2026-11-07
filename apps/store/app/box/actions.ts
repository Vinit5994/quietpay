"use server";

import { cookies } from "next/headers";
import { createBox, setBox } from "@/lib/orders";
import { BOX_COOKIE } from "@/lib/box-cookie";
import { qp, STORE_URL } from "@/lib/quietpay";

/** Starts a Builder Box subscription: QuietPay subscription checkout, reference = box id. */
export async function subscribeToBox(): Promise<{ url: string } | { error: string }> {
  let url: string;
  try {
    const box = createBox();
    const session = await qp.checkout.sessions.create({
      mode: "subscription",
      planId: process.env.QUIETPAY_BOX_PLAN_ID!,
      reference: box.id,
      successUrl: `${STORE_URL}/box`,
      cancelUrl: `${STORE_URL}/box`,
    });
    setBox(box.id, { sessionId: session.id, checkoutUrl: session.url });
    (await cookies()).set(BOX_COOKIE, box.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    url = session.url;
  } catch (err) {
    console.error("[box]", err);
    return { error: "We couldn't start the subscription. Please try again in a moment." };
  }
  // The client opens this in a QuietPay pop-up (or redirects on phones).
  return { url };
}
