/** Plans and subscription checkout. */
import { QuietPay } from "../src";

const qp = new QuietPay(process.env.QUIETPAY_SECRET_KEY!);

export async function setUpBuilderBox() {
  const plan = await qp.plans.create({ name: "Builder Box", amount: "15.00", interval: "month" });
  return plan.id; // store as QUIETPAY_BOX_PLAN_ID
}

export async function subscribe(customerId: string, planId: string) {
  const session = await qp.checkout.sessions.create({
    mode: "subscription",
    planId,
    reference: `box_${customerId}`,
    successUrl: "https://shop.example/box",
    cancelUrl: "https://shop.example/box",
  });
  return session.url;
}

export async function pastDueCustomers() {
  const { data } = await qp.subscriptions.list({ status: "past_due" });
  return data.map((s) => ({ id: s.id, reference: s.reference, failedAttempts: s.failedAttempts, since: s.pastDueSince }));
}

export const cancel = (subscriptionId: string) => qp.subscriptions.cancel(subscriptionId);
