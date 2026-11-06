# Webhooks

QuietPay tells your server what happened by POSTing signed JSON events to your webhook URL. **This is how you fulfil orders.** Webhooks are signed, retried, and independent of the customer's browser.

## Set your endpoint

```ts
const { url, secret } = await qp.webhookEndpoint.update({ url: "https://shop.example/api/webhooks/quietpay" });
```

- Save `secret` as `QUIETPAY_WEBHOOK_SECRET`. **Every `update` issues a new secret**, and the old one stops verifying.
- `await qp.webhookEndpoint.test()` sends a `ping` immediately and returns the delivery, including `lastStatusCode`.

## Verify every request

```ts
const event = qp.webhooks.verify(rawBody, signatureHeader, process.env.QUIETPAY_WEBHOOK_SECRET!);
```

`verify` returns the typed event, or throws `QuietPayError` with code `invalid_webhook_signature` when:
- the `QuietPay-Signature` header is missing or malformed,
- the signature doesn't match the body and secret, or
- the signature is **older than 5 minutes**, which stops replays.

**Pass the raw body.** The signature covers the exact bytes QuietPay sent, so `JSON.stringify(req.body)` won't verify.

| Framework | Raw body |
|---|---|
| Next.js route handler | `await req.text()` |
| Hono | `await c.req.text()` |
| Express | `app.post(path, express.raw({ type: "application/json" }), …)`, then `req.body.toString("utf8")` |

### Signature format

```
QuietPay-Signature: t=1793990000,v1=5f2c…e1
```

`v1` is `hex(HMAC-SHA256(secret, "<t>.<rawBody>"))`. You only need this to verify without the SDK. `signWebhook(rawBody, secret)` from `@quietpay/node` builds a valid header, which is handy for tests.

## Delivery rules

- **At least once.** The same event can arrive more than once, so treat `event.id` (`evt_…`) as an idempotency key and skip ids you've already handled.
- **Different events have different ids.** One checkout produces both `payment.succeeded` and `checkout.session.completed`; both are expected.
- **Answer 2xx within 5 seconds.** Do slow work after you respond.
- **Retries:** if your endpoint fails or times out, QuietPay retries after 1s, 5s, 30s and 2min. After 5 attempts the delivery is marked `failed`. The dashboard's Developers page shows the delivery log with status codes and payloads.

## The envelope

```json
{
  "id": "evt_0wf9BxWAjUhYIZPLBN0Dw9rn",
  "type": "payment.succeeded",
  "createdAt": "2026-11-06T20:23:05.000Z",
  "data": { "…": "depends on the type" }
}
```

Every `data` includes `merchantReference` (your `reference`), plus `txHash` and `explorerUrl`. Amounts are USDT decimal strings.

## Event types

| Type | When |
|---|---|
| `payment.succeeded` | Money arrived: a checkout, a payment link, a subscription's first charge, or a renewal |
| `checkout.session.completed` | A checkout session finished (payment or subscription mode) |
| `refund.succeeded` | A refund reached the customer |
| `subscription.created` | A customer subscribed; the first period is already charged |
| `subscription.renewed` | A renewal charge succeeded |
| `subscription.payment_failed` | A renewal failed; the subscription is `past_due` and is retried during the grace period |
| `subscription.canceled` | Canceled by the customer, by you, or for nonpayment after the grace period |
| `ping` | Sent by `webhookEndpoint.test()` |

### `payment.succeeded`

```json
{
  "merchantReference": "order_1001",
  "paymentId": "pay_374063332822cd827316d76cb37933c836d1a28ab695c44d74c95404fba87ec5",
  "kind": "checkout",
  "sessionId": "sess_C1J3xy2ZVIgbf5vtYR2mYFFN",
  "subscriptionId": null,
  "payerAddress": "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "amount": "37.00",
  "fee": "0.00",
  "net": "37.00",
  "paidAt": "2026-11-06T20:23:05.000Z",
  "txHash": "0xde3c…8665",
  "explorerUrl": "https://explorer.testnet.whitechain.io/tx/0xde3c…8665"
}
```

`kind` is `"subscription"` for subscription charges. Those set `subscriptionId`, and `sessionId` only on the first charge.

### `checkout.session.completed`

```json
{
  "merchantReference": "order_1001",
  "sessionId": "sess_C1J3xy2ZVIgbf5vtYR2mYFFN",
  "mode": "payment",
  "paymentId": "pay_3740…7ec5",
  "subscriptionId": null,
  "payerAddress": "0x90F7…b906",
  "amount": "37.00",
  "txHash": "0xde3c…8665",
  "explorerUrl": "https://explorer.testnet.whitechain.io/tx/0xde3c…8665"
}
```

### `refund.succeeded`

```json
{
  "merchantReference": "order_1001",
  "refundId": "re_Q2v…",
  "paymentId": "pay_3740…7ec5",
  "amount": "8.00",
  "totalRefunded": "8.00",
  "paymentAmount": "37.00",
  "fullyRefunded": false,
  "txHash": "0x82ee…42d9",
  "explorerUrl": "https://explorer.testnet.whitechain.io/tx/0x82ee…42d9"
}
```

### `subscription.*`

All four subscription events share one shape, so a single handler can sync your copy:

```json
{
  "merchantReference": "box_42",
  "subscriptionId": "sub_DRHYnGBJBBGObTJf4nGf9k7A",
  "planId": "plan_fRNzek0on4daPS3Su2f1QMp3",
  "subscriberAddress": "0x15d3…6A65",
  "status": "past_due",
  "cycle": 1,
  "amount": "15.00",
  "nextChargeAt": "2026-11-06T21:05:22.000Z",
  "pastDueSince": "2026-11-06T21:04:22.000Z",
  "cancelReason": null,
  "paymentId": null,
  "attemptedCycle": 2,
  "txHash": "0x5d16…8e4f",
  "explorerUrl": "https://explorer.testnet.whitechain.io/tx/0x5d16…8e4f"
}
```

- `status`: `active`, `past_due` or `canceled`.
- `cancelReason`: `customer`, `nonpayment`, `merchant` or `null`.
- `paymentId` is set on `created` and `renewed`; `attemptedCycle` is set on `payment_failed`.
- `nextChargeAt` is `null` once canceled.

### `ping`

```json
{ "merchantReference": null, "txHash": null, "explorerUrl": null, "message": "Hello from QuietPay, Swag Counter!" }
```

## A complete handler

```ts
export async function POST(req: Request) {
  let event;
  try {
    event = qp.webhooks.verify(await req.text(), req.headers.get("quietpay-signature"), process.env.QUIETPAY_WEBHOOK_SECRET!);
  } catch {
    return new Response("bad signature", { status: 400 });
  }
  if (await alreadyHandled(event.id)) return new Response("ok");

  switch (event.type) {
    case "payment.succeeded":
      await markPaid(event.data.merchantReference, event.data.txHash);
      break;
    case "refund.succeeded":
      await markRefunded(event.data.merchantReference, event.data.totalRefunded, event.data.fullyRefunded);
      break;
    case "subscription.created":
    case "subscription.renewed":
    case "subscription.payment_failed":
    case "subscription.canceled":
      await syncSubscription(event.data); // same shape for all four
      break;
  }
  await rememberHandled(event.id);
  return new Response("ok");
}
```

## Testing locally

From the QuietPay repo:

```bash
WEBHOOK_SECRET=whsec_... pnpm webhook-receiver        # listens on http://localhost:3999/hook, verifies and prints events
FAIL_FIRST=2 WEBHOOK_SECRET=whsec_... pnpm webhook-receiver   # answers 500 twice to watch the retries
```
