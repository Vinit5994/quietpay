# QuietPay for developers

**QuietPay** lets any business accept **USDT on Whitechain**: hosted checkout, payment links, subscriptions with failed-payment handling, refunds and signed webhooks. Your customers never pay gas, pick a network or see a seed phrase. They sign in with email or Google (or connect MetaMask) and approve a single message. The money lands **directly in your own wallet**.

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

// redirect the customer to session.url, then wait for the `payment.succeeded` webhook
```

## Start here

| | |
|---|---|
| [**Getting started**](01-getting-started.md) | Keys, the client, your first paid order in about 10 minutes |
| [**Checkout**](02-checkout.md) | One-time payments: sessions, line items, statuses |
| [**Webhooks**](03-webhooks.md) | Signed events, every payload, retries and idempotency |
| [**Subscriptions**](04-subscriptions.md) | Plans, automatic renewals, past due, grace, cancel |
| [**Refunds**](05-refunds.md) | Partial and full refunds, signed by your payout wallet |
| [**Payment links and reporting**](06-payment-links-and-reporting.md) | QR links, listing payments, CSV export |
| [**Errors**](07-errors.md) | Every error code and what to do |
| [**API reference**](08-reference.md) | Every method and object |

## How it works

1. **You** create a checkout session on your server and send the customer to QuietPay's hosted page (a redirect, or a [pop-up over your site](02-checkout.md#open-checkout-in-a-pop-up)).
2. **The customer** signs one EIP-3009 authorization: "move exactly 37.00 USDT to QuietPay for this order". That's free; no gas.
3. **QuietPay's relayer** submits it on-chain and pays the gas from **your business's gas balance** (you top it up with WBT; your customers never pay any).
4. **The [QuietPay contract](https://explorer.testnet.whitechain.io/address/0x8ed9E91D00CbeB77F492863dc101C073F9152aC5)** checks your signed invoice and moves the USDT straight to your payout wallet.
5. **Your server** receives a signed `payment.succeeded` webhook and fulfils the order.

Nobody, QuietPay included, can move a customer's money without their signature, or refund from your wallet without your payout wallet's signature.

## The SDK

- **Zero dependencies.** It uses only `fetch` and `node:crypto`.
- **Fully typed.** Every request and response type comes from the same schemas the API validates against, so the docs, the types and the server can't drift apart.
- **Server-side only.** Your secret key must never reach a browser.
- **Source and examples:** [github.com/Vinit5994/quietpay/packages/sdk-node](https://github.com/Vinit5994/quietpay/tree/main/packages/sdk-node). The [examples](https://github.com/Vinit5994/quietpay/tree/main/packages/sdk-node/examples) are typechecked with the package.

## Network

| | |
|---|---|
| Chain | Whitechain Sepolia (testnet), chain ID 1874 |
| Token | USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` (6 decimals) |
| QuietPay contract | [`0x8ed9E91D00CbeB77F492863dc101C073F9152aC5`](https://explorer.testnet.whitechain.io/address/0x8ed9E91D00CbeB77F492863dc101C073F9152aC5) (verified) |
| Explorer | https://explorer.testnet.whitechain.io |
