# API reference

All amounts are **USDT decimal strings**. Inputs take at most 2 decimals (`"25.00"`); outputs show 2–6 decimals (`"0.005"` for a sub-cent fee). Timestamps are ISO-8601 strings in UTC. Nullable fields are always present as `null`, never omitted.

## Client

```ts
new QuietPay(secretKey: string, options?: {
  baseUrl?: string; // default process.env.QUIETPAY_API_URL ?? "http://localhost:4000"
  timeoutMs?: number; // default 15000
  fetch?: typeof fetch; // custom fetch (tests, proxies)
})
```

Every method sends `Authorization: Bearer <secretKey>` and returns a Promise, except `webhooks.verify`, which is synchronous and local.

## Methods

| Method | HTTP | Returns |
|---|---|---|
| `checkout.sessions.create(params)` | `POST /v1/checkout/sessions` | [`CheckoutSession`](#checkoutsession) |
| `checkout.sessions.retrieve(id)` | `GET /v1/checkout/sessions/:id` | `CheckoutSession` |
| `paymentLinks.create({ title, amount, description? })` | `POST /v1/payment_links` | [`PaymentLink`](#paymentlink) + `qrSvg` |
| `paymentLinks.list({ limit?, cursor? })` | `GET /v1/payment_links` | `List<PaymentLink>` |
| `plans.create({ name, amount, interval, periodSeconds?, graceSeconds? })` | `POST /v1/plans` | [`Plan`](#plan) |
| `plans.list({ limit?, cursor? })` | `GET /v1/plans` | `List<Plan>` |
| `payments.list({ limit?, cursor?, reference? })` | `GET /v1/payments` | `List<Payment>` |
| `subscriptions.list({ status?, limit?, cursor? })` | `GET /v1/subscriptions` | `List<Subscription>` |
| `subscriptions.cancel(id)` | `POST /v1/subscriptions/:id/cancel` | [`Subscription`](#subscription) |
| `refunds.create({ paymentId, amount, reason? })` | `POST /v1/refunds` | [`Refund`](#refund) + `signUrl` |
| `exports.paymentsCsv()` | `GET /v1/exports/payments.csv` | `string` (CSV) |
| `webhookEndpoint.update({ url })` | `PUT /v1/webhook_endpoint` | `{ url, secret }` (the secret rotates) |
| `webhookEndpoint.test()` | `POST /v1/webhook_endpoint/test` | [`WebhookDelivery`](#webhookdelivery) |
| `webhooks.verify(rawBody, header, secret, { toleranceSeconds?, now? })` | local | [`QuietPayEvent`](03-webhooks.md) |

`List<T>` is `{ data: T[]; nextCursor: string | null }`.

Also exported: `QuietPayError`, `verifyWebhook` (same as `webhooks.verify`), `signWebhook(rawBody, secret, timestamp?)` (builds a valid header for tests), and every type below.

### `checkout.sessions.create` params

Payment mode:

| Field | Type | |
|---|---|---|
| `mode` | `"payment"` | |
| `lineItems` | `{ name: string; unitAmount: string; quantity: number }[]` | 1–50 items; quantity 1–1000; total ≥ 0.50 |
| `reference` | `string` | 1–200 chars; echoed as `merchantReference` |
| `successUrl`, `cancelUrl` | `string` (URL) | |
| `customerEmail?` | `string` (email) | |
| `expiresInSeconds?` | `number` | 60–86400, default 1800 |

Subscription mode: `{ mode: "subscription", planId, reference, successUrl, cancelUrl, customerEmail? }`. Sessions expire after 30 minutes.

### `plans.create` params

| Field | Type | |
|---|---|---|
| `name` | `string` | |
| `amount` | `string` | ≥ 0.50, charged every period |
| `interval` | `"month" \| "week" \| "custom"` | 30 days / 7 days / `periodSeconds` |
| `periodSeconds?` | `number` | required for `custom`; ≥ 60 |
| `graceSeconds?` | `number` | how long past-due payments are retried; default 259200 (3 days) |

## Objects

### CheckoutSession

| Field | Type | |
|---|---|---|
| `id` | `string` | `sess_…` |
| `mode` | `"payment" \| "subscription"` | |
| `status` | `"open" \| "processing" \| "complete" \| "expired"` | |
| `url` | `string` | hosted checkout; redirect the customer here |
| `amount`, `currency` | `string`, `"USDT"` | |
| `lineItems` | `{ name, unitAmount, quantity, amount }[]` | subscriptions have one line (the plan) |
| `planId` | `string \| null` | |
| `reference`, `customerEmail` | `string`, `string \| null` | |
| `successUrl`, `cancelUrl` | `string` | |
| `paymentLinkId` | `string \| null` | set when created from a payment link |
| `payerAddress` | `string \| null` | the customer wallet, once known |
| `paymentId`, `subscriptionId`, `txHash` | `string \| null` | set when complete |
| `expiresAt`, `createdAt` | `string` | |

### Payment

| Field | Type | |
|---|---|---|
| `id` | `string` | `pay_` + the on-chain payment id |
| `onchainPaymentId` | `string` | bytes32 |
| `kind` | `"checkout" \| "subscription"` | |
| `status` | `"paid" \| "partially_refunded" \| "refunded"` | |
| `sessionId`, `subscriptionId` | `string \| null` | |
| `reference`, `customerEmail` | `string \| null` | |
| `payerAddress` | `string` | refunds go back here |
| `amount`, `fee`, `refunded` | `string` | |
| `net` | `string` | amount − fee − refunded |
| `refundable` | `string` | amount − refunded |
| `txHash`, `explorerUrl`, `blockNumber` | `string` | |
| `paidAt` | `string` | |

### Plan

`{ id, onchainPlanId, name, amount, interval, periodSeconds, graceSeconds, active, createdAt }`

### Subscription

| Field | Type | |
|---|---|---|
| `id`, `onchainSubId`, `planId`, `planName` | `string` | |
| `amount`, `periodSeconds`, `graceSeconds` | `string`, `number`, `number` | |
| `subscriberAddress` | `string` | |
| `customerEmail`, `reference` | `string \| null` | |
| `status` | `"active" \| "past_due" \| "canceled"` | |
| `cycle` | `number` | 0 after the first charge, +1 per renewal |
| `nextChargeAt` | `string \| null` | null once canceled |
| `pastDueSince` | `string \| null` | |
| `failedAttempts` | `number` | failures since the last successful charge |
| `cancelReason` | `"customer" \| "nonpayment" \| "merchant" \| null` | |
| `createdAt` | `string` | |

### Refund

`{ id, paymentId, amount, reason, status, seq, txHash, explorerUrl, error, createdAt }`. `status` is `awaiting_signature`, `submitted`, `succeeded` or `failed`. `refunds.create` also returns `signUrl`.

### PaymentLink

`{ id, slug, title, description, amount, active, url, createdAt }`. `paymentLinks.create` also returns `qrSvg`.

### WebhookDelivery

`{ id, eventId, type, status, attempts, nextAttemptAt, lastStatusCode, lastError, url, payload, createdAt }`. `status` is `pending`, `succeeded` or `failed`.

## Source of truth

These types are generated from the zod schemas in `@quietpay/shared` (`api-types.ts`). The QuietPay API validates **every request and response** against the same schemas, so these docs and the SDK types can't drift from what the server actually does.
