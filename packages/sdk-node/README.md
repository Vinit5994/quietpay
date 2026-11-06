# @quietpay/node

Server-side client for the QuietPay API. It has no runtime dependencies beyond `fetch` and `node:crypto` (it imports types only from `@quietpay/shared`).

```ts
import { QuietPay } from "@quietpay/node";

const qp = new QuietPay(process.env.QUIETPAY_SECRET_KEY!, {
  // optional; default: process.env.QUIETPAY_API_URL ?? "http://localhost:4000"
  baseUrl: "http://localhost:4010", // the mock API, before the real one is ready
});
```

| Call | Endpoint |
|---|---|
| `qp.checkout.sessions.create(params)` / `.retrieve(id)` | `POST/GET /v1/checkout/sessions` |
| `qp.paymentLinks.create(params)` / `.list()` | `/v1/payment_links` |
| `qp.plans.create(params)` / `.list()` | `/v1/plans` |
| `qp.payments.list({ reference })` | `GET /v1/payments` |
| `qp.subscriptions.list({ status })` / `.cancel(id)` | `/v1/subscriptions` |
| `qp.refunds.create({ paymentId, amount, reason })` | `POST /v1/refunds` |
| `qp.exports.paymentsCsv()` | `GET /v1/exports/payments.csv` |
| `qp.webhookEndpoint.update({ url })` / `.test()` | `/v1/webhook_endpoint` |
| `qp.webhooks.verify(rawBody, header, secret)` | local: checks `QuietPay-Signature` and returns the typed event |

Amounts are decimal strings (`"25.00"`, max 2 decimals). Errors throw `QuietPayError` with `code` (for example `session_expired`), `message` and HTTP `status`. Network failures use code `network_error`, and bad webhook signatures use `invalid_webhook_signature`.

Webhooks are delivered **at least once**, so treat `event.id` as an idempotency key. Signatures older than 5 minutes are rejected. `signWebhook(rawBody, secret)` builds a valid header, which the mock API and tests can use.

## Store integration (Swag Counter)

```ts
// apps/store/app/cart/actions.ts
"use server";
import { redirect } from "next/navigation";
import { QuietPay } from "@quietpay/node";
import { createOrder } from "@/lib/orders";

const qp = new QuietPay(process.env.QUIETPAY_SECRET_KEY!);

export async function checkout(cart: CartItem[]) {
  const order = await createOrder(cart);
  const session = await qp.checkout.sessions.create({
    mode: "payment",
    reference: order.id,
    lineItems: cart.map((i) => ({ name: i.name, unitAmount: i.price, quantity: i.qty })),
    successUrl: `${process.env.STORE_URL}/orders/${order.id}`,
    cancelUrl: `${process.env.STORE_URL}/cart`,
  });
  redirect(session.url);
}
```

```ts
// apps/store/app/api/webhooks/quietpay/route.ts
export async function POST(req: Request) {
  const event = qp.webhooks.verify(await req.text(), req.headers.get("quietpay-signature")!, process.env.QUIETPAY_WEBHOOK_SECRET!);
  if (await alreadyHandled(event.id)) return new Response("ok");
  if (event.type === "payment.succeeded") await markPaid(event.data.merchantReference, event.data.txHash);
  if (event.type === "refund.succeeded") await markRefunded(event.data.merchantReference, event.data.amount);
  if (event.type.startsWith("subscription.")) await syncBox(event.data);
  return new Response("ok");
}
```

## Using it from a Next.js app in this monorepo

The package ships TypeScript source, so add it to `transpilePackages`:

```js
// next.config.mjs
export default { transpilePackages: ["@quietpay/node", "@quietpay/shared"] };
```
