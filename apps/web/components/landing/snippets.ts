import type { CodeTab } from "./CodeTabs";

/** The integration code shown on the landing page and the dashboard Integrate tab. Mirrors apps/store. */
export const integrationSnippets: CodeTab[] = [
  {
    id: "checkout",
    file: "checkout.ts",
    code: `import { QuietPay } from "@quietpay/node";

const qp = new QuietPay(process.env.QUIETPAY_SECRET_KEY!);

// On your server: create a checkout and send the customer to it
export async function checkout(order: Order) {
  const session = await qp.checkout.sessions.create({
    mode: "payment",
    reference: order.id,
    lineItems: order.lineItems, // name, unitAmount, quantity
    successUrl: \`https://yourstore.com/orders/\${order.id}\`,
    cancelUrl: "https://yourstore.com/cart",
  });
  redirect(session.url);
}`,
  },
  {
    id: "webhook",
    file: "webhook.ts",
    code: `// app/api/webhooks/quietpay/route.ts
export async function POST(req: Request) {
  const event = qp.webhooks.verify(
    await req.text(),
    req.headers.get("quietpay-signature"),
    process.env.QUIETPAY_WEBHOOK_SECRET!,
  );

  if (event.type === "payment.succeeded") {
    await markPaid(event.data.merchantReference, event.data.txHash);
  }
  return Response.json({ received: true });
}`,
  },
  {
    id: "subscription",
    file: "subscription.ts",
    code: `// Same call, subscription mode: renewals, grace period and cancels are handled for you
const session = await qp.checkout.sessions.create({
  mode: "subscription",
  planId: process.env.QUIETPAY_PLAN_ID!,
  reference: customer.id,
  successUrl: "https://yourstore.com/account",
  cancelUrl: "https://yourstore.com/pricing",
});
redirect(session.url);

// Then listen for subscription.renewed, subscription.payment_failed and subscription.canceled`,
  },
];
