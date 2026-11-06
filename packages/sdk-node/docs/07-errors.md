# Errors

Every failed call throws a `QuietPayError`:

```ts
import { QuietPayError } from "@quietpay/node";

try {
  await qp.refunds.create({ paymentId, amount: "99.00" });
} catch (err) {
  if (err instanceof QuietPayError) {
    err.code; // "refund_exceeds_payment"
    err.status; // 422 (0 when the request never got a response)
    err.message; // "Only 12.00 USDT of this 37.00 USDT payment can still be refunded."
  }
}
```

The API's error body is always `{ "error": { "code": "…", "message": "…" } }`. Messages are written for people ("Your wallet has 4.00 USDT; this order needs 37.00 USDT. Add funds and try again."), so you can show them to customers as they are. **Branch on `code`, not on `message`.** New codes may be added over time, so treat an unknown code as a generic failure.

## SDK-side codes

| Code | When |
|---|---|
| `missing_secret_key` | `new QuietPay("")`. The constructor needs a key; create the client lazily if your build runs without env vars. |
| `network_error` | QuietPay couldn't be reached, or the request timed out (`timeoutMs`, default 15s) |
| `invalid_webhook_signature` | `webhooks.verify` rejected the request: missing or malformed header, wrong secret, a tampered body, or an expired signature |
| `api_error` | A non-JSON error response |

## API codes

| Code | HTTP | Meaning | What to do |
|---|---|---|---|
| `validation_failed` | 400 | A field is missing or malformed. The message names the field, e.g. `lineItems.0.unitAmount`. | Fix the request |
| `bad_request` | 400 | The request makes no sense in this state | Read the message |
| `unauthorized` | 401 | Missing, wrong or rotated secret key, or an expired dashboard sign-in | Check `QUIETPAY_SECRET_KEY` |
| `forbidden` | 403 | Signed in, but not allowed (e.g. a customer token on merchant routes) | |
| `not_found` | 404 | No such object **for your merchant account** | Check the id |
| `conflict` | 409 | Already done, or state changed (e.g. this wallet is already onboarded, a top-up already counted, a refund needs re-signing) | Reload and retry |
| `session_expired` | 409 | The checkout expired | Create a new session |
| `session_not_open` | 409 | The checkout is already processing or complete | Wait for the webhook |
| `plan_inactive` | 409 | The plan was deactivated | |
| `subscription_not_active` | 409 | Already canceled | |
| `signature_expired` | 409 | A signed approval passed its deadline | Ask the user to sign again |
| `invalid_signature` | 400/401 | A signature doesn't match the expected wallet or message | Sign again with the right wallet |
| `insufficient_balance` | 402 | The customer's (or, for refunds, the payout wallet's) USDT is too low. The message gives both amounts. | Add funds |
| `merchant_gas_budget_exhausted` | 402 | Your prepaid gas budget is used up | Top up in the dashboard |
| `amount_below_minimum` | 422 | Checkouts, plans and links must be at least 0.50 USDT | |
| `invalid_amount` | 422 | An amount of zero, or not a valid amount | |
| `refund_exceeds_payment` | 422 | More than what's left to refund | Refund at most `refundable` |
| `simulation_failed` | 422 | The transaction would fail on-chain for an unexpected reason | Read the message |
| `rate_limited` | 429 | Too many attempts (per IP, per wallet or global) | Wait a minute |
| `demo_disabled`, `demo_fund_cooldown` | 403, 429 | Testnet funding helper only | |
| `transaction_failed` | 500 | The network didn't confirm the transaction. Nothing was charged. | Retry |
| `internal_error` | 500 | Our bug | Retry, and tell us |

## Contract errors

When a transaction would fail on-chain, QuietPay simulates it first and **sends nothing**. The contract's reason comes back as a code (HTTP 422):

`order_already_paid`, `invoice_expired`, `merchant_inactive`, `invalid_merchant_signature`, `plan_above_max`, `invalid_subscriber_signature`, `insufficient_allowance`, `not_chargeable`, `not_due`, `unknown_payment`, `enforced_pause` (payments are paused; refunds still work).
