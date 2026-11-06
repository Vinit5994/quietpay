# QuietPay mock API (port 4010)

A fake QuietPay API so the web app and the store can be built before the real API (Person A) is ready. No blockchain: payments "confirm" after 2 seconds, renewals run on a timer, webhooks are real and signed.

```bash
pnpm install          # from the repo root
pnpm dev:mock         # from the repo root: http://localhost:4010
pnpm --filter @quietpay/mock-api test
```

## What it does
- Implements **every endpoint** in `@quietpay/shared`'s `Endpoints` map, validating requests and responses with the same zod schemas the real API uses. If the mock returns something that doesn't match the contract, it fails with a 500 so drift is caught early.
- Seeds a **Swag Counter** merchant, the **Builder Box** plan (15.00 USDT every 2 minutes, 1 minute grace) and the **Sticker Pack** payment link.
- Sends **real signed webhooks** to `MOCK_WEBHOOK_URL`, signed with the SDK's `signWebhook` and retried on the shared schedule.
- Checks signatures with viem. By default a bad signature is accepted with a warning; set `MOCK_STRICT_SIGNATURES=true` to reject it.

## Ready-made data
| What | Value |
|---|---|
| Secret key (store `.env.local`) | `sk_test_mock_swagcounter` |
| Webhook secret | `whsec_mock_swagcounter` |
| Dashboard token (skip wallet sign-in) | `mock.merchant.demo` |
| Open payment checkout (37.00) | `/c/sess_demo_payment` |
| Open subscription checkout | `/c/sess_demo_subscription` |
| Expired checkout | `/c/sess_demo_expired` |
| Already-paid checkout | `/c/sess_demo_paid` |
| Payment link | `/l/sticker-pack` |

Any new wallet starts with **100.00 USDT** (`MOCK_DEFAULT_BALANCE`). State resets on restart.

## Mock-only controls
| Call | Effect |
|---|---|
| `GET /mock/state` | Sessions, subscriptions and recent webhook deliveries |
| `POST /mock/set-balance {address, amount}` | Set a wallet's USDT balance (e.g. `"4.00"` to test "not enough funds") |
| `GET /mock/balance/:address` | Read a balance |
| `POST /mock/fail-next-renewal/:subId` | Renewals fail from now on: past due, then canceled after grace |
| `POST /mock/recover/:subId` | Stop forcing failures |
| `POST /mock/charge-now/:subId` | Run a renewal attempt immediately |

## Auth in the mock
- Merchant API: `Authorization: Bearer <secret key>`.
- Dashboard and portal: `/auth/verify` returns `mock.<role>.<address>`; send that as the bearer token. `mock.merchant.demo` maps to the seeded merchant. Like the real API, `/v1/*` accepts either a secret key or a merchant token.
