# Getting started

This guide takes you from nothing to a paid order in about 10 minutes.

## 1. Get your keys

Every merchant gets two secrets. Both are **shown once**.

| Secret | Looks like | Used for |
|---|---|---|
| Secret key | `sk_test_…` | Authenticating your server's API calls (`Authorization: Bearer sk_test_…`) |
| Webhook secret | `whsec_…` | Verifying that webhooks really come from QuietPay |

You get them when you **onboard in the QuietPay dashboard**: sign in with your payout wallet and enter a business name. If you run the API yourself, `pnpm --filter @quietpay/api seed` prints them for the demo merchant.

- **Lost the secret key?** Rotate it in the dashboard under Developers. The old key stops working immediately.
- **Lost the webhook secret?** Setting the webhook URL again issues a new one.

Store both in environment variables, never in code:

```bash
QUIETPAY_SECRET_KEY=sk_test_...
QUIETPAY_WEBHOOK_SECRET=whsec_...
QUIETPAY_API_URL=http://localhost:4000   # optional, see below
```

## 2. Install and create a client

Inside this monorepo, add it as a workspace dependency, which is how Swag Counter uses it:

```json
{ "dependencies": { "@quietpay/node": "workspace:*" } }
```

The package isn't published to npm yet. Outside this repo, use a path dependency on `packages/sdk-node` together with `packages/shared`: the SDK imports its **types** from `@quietpay/shared`, and nothing at runtime.

```ts
import { QuietPay } from "@quietpay/node";

const qp = new QuietPay(process.env.QUIETPAY_SECRET_KEY!, {
  // optional; default is process.env.QUIETPAY_API_URL, then http://localhost:4000
  baseUrl: "http://localhost:4000",
  // optional; default 15 seconds
  timeoutMs: 15_000,
});
```

**Next.js in this monorepo:** the package ships TypeScript source, so add it to `transpilePackages`:

```js
// next.config.mjs
export default { transpilePackages: ["@quietpay/node", "@quietpay/shared"] };
```

**Create the client lazily** if your build runs without the key (for example `next build` on a CI box). The constructor throws on an empty key, so build the client inside your handler, or behind a function, instead of at module load.

## 3. Create a checkout session and redirect

```ts
const session = await qp.checkout.sessions.create({
  mode: "payment",
  reference: order.id, // your own id; it comes back in every webhook
  lineItems: [
    { name: "Builder Hoodie (L)", unitAmount: "25.00", quantity: 1 },
    { name: "Sticker Pack", unitAmount: "3.00", quantity: 4 },
  ],
  successUrl: `${STORE_URL}/orders/${order.id}`,
  cancelUrl: `${STORE_URL}/cart`,
});

redirect(session.url); // QuietPay's hosted checkout
```

**Amounts are strings** in USDT with at most 2 decimals (`"25.00"`), never JavaScript numbers. See [Checkout](02-checkout.md).

## 4. Receive the webhook

```ts
// POST /api/webhooks/quietpay
export async function POST(req: Request) {
  const event = qp.webhooks.verify(
    await req.text(), // the RAW body, not re-serialized JSON
    req.headers.get("quietpay-signature"),
    process.env.QUIETPAY_WEBHOOK_SECRET!,
  );
  if (await alreadyHandled(event.id)) return new Response("ok"); // deliveries are at least once

  if (event.type === "payment.succeeded") {
    await markPaid(event.data.merchantReference, event.data.txHash);
  }
  return new Response("ok");
}
```

Tell QuietPay where to send events, once:

```ts
const { secret } = await qp.webhookEndpoint.update({ url: "https://shop.example/api/webhooks/quietpay" });
// save `secret` as QUIETPAY_WEBHOOK_SECRET; it changes every time you call update
await qp.webhookEndpoint.test(); // sends a `ping` right away
```

See [Webhooks](03-webhooks.md) for every event.

## 5. Try it

1. Create a session and open `session.url`.
2. Sign in with Google or email. An embedded wallet is created for you.
3. On testnet, fund the wallet from the demo funding page (`/demo/fund`, testnet only), then pay.
4. The checkout shows the explorer link. Within about a second, your webhook gets `payment.succeeded`.

## What the customer experiences

- **No gas, no network, no seed phrase.** They never see WBT, a chain name or a network picker.
- **One signature** for a payment. A subscription needs two in a row: the plan and a capped spending approval.
- **A receipt** with the explorer link, then a redirect back to your `successUrl`.
