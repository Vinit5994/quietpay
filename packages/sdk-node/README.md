# @quietpay/node

The official Node.js SDK for **QuietPay**: accept **USDT on Whitechain** with hosted checkout, payment links, subscriptions, refunds and signed webhooks. Your customers never pay gas, pick a network or see a seed phrase. They sign in with Google or email and approve a single message. The money lands **directly in your own wallet**.

```ts
import { QuietPay } from "@quietpay/node";

const qp = new QuietPay(process.env.QUIETPAY_SECRET_KEY!);

const session = await qp.checkout.sessions.create({
  mode: "payment",
  reference: "order_1001",
  lineItems: [{ name: "Builder Hoodie", unitAmount: "25.00", quantity: 1 }],
  successUrl: "https://shop.example/orders/1001",
  cancelUrl: "https://shop.example/cart",
});

// send the customer to session.url, then wait for the `payment.succeeded` webhook
```

- **Zero dependencies.** It uses only `fetch` and `node:crypto`, and needs Node 18 or later (22 recommended).
- **Fully typed.** Every request and response type comes from the same schemas the QuietPay API validates against.
- **Server-side only.** Your secret key must never reach a browser.

## Documentation

| Guide | What you'll learn |
|---|---|
| [Getting started](docs/01-getting-started.md) | Keys, environments, your first payment end to end |
| [Checkout](docs/02-checkout.md) | Checkout sessions, line items, amounts, expiry, statuses |
| [Webhooks](docs/03-webhooks.md) | Verifying signatures, every event type, retries, idempotency |
| [Subscriptions](docs/04-subscriptions.md) | Plans, the subscription lifecycle, failed payments, cancellation |
| [Refunds](docs/05-refunds.md) | Partial and full refunds, the payout-wallet signature |
| [Payment links and reporting](docs/06-payment-links-and-reporting.md) | QR payment links, listing payments, CSV export |
| [Errors](docs/07-errors.md) | `QuietPayError`, every error code and what to do |
| [API reference](docs/08-reference.md) | Every SDK method, parameter and returned object |

Runnable, typechecked examples are in [`examples/`](examples).

## How it works, in one paragraph

You create a **checkout session** on your server and redirect the customer to QuietPay's hosted page. The customer signs one EIP-3009 authorization ("move exactly 37.00 USDT to QuietPay for this order") with an embedded wallet. QuietPay's relayer submits it on-chain and pays the gas. The [QuietPay contract](https://explorer.testnet.whitechain.io/address/0x8ed9E91D00CbeB77F492863dc101C073F9152aC5) checks your signed invoice and moves the USDT straight to your payout wallet. A signed `payment.succeeded` webhook then tells your server the order is paid. Nobody, QuietPay included, can move a customer's money without their signature.

## Network

| | |
|---|---|
| Chain | Whitechain Sepolia (testnet), chain ID 1874 |
| Token | USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` (6 decimals) |
| QuietPay contract | `0x8ed9E91D00CbeB77F492863dc101C073F9152aC5` (verified) |
| Explorer | https://explorer.testnet.whitechain.io |
