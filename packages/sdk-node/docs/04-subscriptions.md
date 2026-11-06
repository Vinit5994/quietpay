# Subscriptions

Charge a fixed USDT amount every period, automatically. The customer approves **once**, with a capped spending limit. QuietPay charges each period, handles failed payments with a grace period, and keeps you informed with webhooks.

## 1. Create a plan

```ts
const plan = await qp.plans.create({
  name: "Builder Box",
  amount: "15.00",
  interval: "month", // "month" (30 days), "week" (7 days) or "custom"
});

const demo = await qp.plans.create({
  name: "Builder Box (demo)",
  amount: "15.00",
  interval: "custom",
  periodSeconds: 120, // required when interval is "custom"; at least 60
  graceSeconds: 60, // optional; default 3 days
});
```

Plans are created **on-chain** (`createPlan` on the QuietPay contract), so their terms are public and can't be changed behind the customer's back. `plan.onchainPlanId` is the contract's id. `qp.plans.list()` returns your plans.

Running a demo? Start the API with `DEMO_PERIOD_OVERRIDE=120` and every new plan uses 2-minute periods with a 60-second grace.

## 2. Send the customer to a subscription checkout

```ts
const session = await qp.checkout.sessions.create({
  mode: "subscription",
  planId: plan.id,
  reference: `box_${customer.id}`,
  successUrl: "https://shop.example/box",
  cancelUrl: "https://shop.example/box",
});
redirect(session.url);
```

The hosted page shows the terms in plain words, for example: "15.00 USDT every month. You allow Swag Counter to charge up to 180.00 USDT over 12 periods; you're only charged 15.00 USDT each period." The customer then signs **two messages in a row**:

1. **Subscribe**, on the QuietPay domain: this plan, this wallet, a maximum price per period.
2. **Permit**, on the USDT domain: a spending allowance of 12 × the plan amount, on top of any existing allowance.

The first period is charged **immediately**, inside the same transaction. You receive `subscription.created`, `payment.succeeded` and `checkout.session.completed`.

## 3. The lifecycle

```
             subscribe (first charge now)
                      │
                      ▼
   ┌────────────►  active  ──── period ends, charge succeeds ────► subscription.renewed
   │                  │                                            + payment.succeeded
   │      charge fails (low balance or allowance)
   │                  ▼
   │              past_due  ──► subscription.payment_failed
   │                  │         retried every 30s+ during the grace period
   │   top-up, retry succeeds          │
   └──────────────────┘                │ grace period over, still failing
                                       ▼
                                   canceled (reason "nonpayment") ──► subscription.canceled
```

- **Renewals are automatic.** QuietPay's keeper checks every 10 seconds and charges subscriptions that are due. Customers and merchants do nothing.
- **A failed renewal never reverts.** It's recorded on-chain as past due, so you get a clear event instead of silence.
- **The grace period** starts at the first failure. If the customer adds USDT before it ends, the next retry brings the subscription back to `active` and the schedule keeps its original cadence.
- `failedAttempts` counts failures since the last successful charge.

## 4. Cancel

| Who | How | `cancelReason` |
|---|---|---|
| You | `await qp.subscriptions.cancel("sub_…")` | `merchant` |
| The customer | Signs a `CancelSubscription` message in the QuietPay portal (`/portal`). It's gasless for them too. | `customer` |
| Nonpayment | Automatic, after the grace period | `nonpayment` |

A canceled subscription is never charged again. All three send `subscription.canceled`.

## 5. List

```ts
const { data } = await qp.subscriptions.list({ status: "active" }); // or "past_due", "canceled", or omit
for (const s of data) console.log(s.id, s.status, s.cycle, s.nextChargeAt, s.failedAttempts);
```

## Why customers can trust it

- They approve a **cap** (12 periods), never an unlimited allowance.
- The plan price is fixed on-chain. A plan above the customer's signed maximum is rejected (`plan_above_max`).
- They can cancel any time from the portal with one signature, without paying gas.
