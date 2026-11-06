# Refunds

Refund all or part of any payment, a checkout or a subscription charge, back to **the wallet that paid**. Refunds come out of your **payout wallet** (you received the money there), so that wallet signs each refund. Your server only requests it.

## 1. Request a refund (your server)

```ts
const refund = await qp.refunds.create({
  paymentId: "pay_…", // from the payment.succeeded webhook, or qp.payments.list()
  amount: "8.00",
  reason: "wrong size", // optional
});

refund.status; // "awaiting_signature"
refund.signUrl; // where the payout wallet approves it in the QuietPay dashboard
```

QuietPay checks the amount **before anything is signed or sent**:

```
refundable = amount paid − already refunded − refunds currently being sent
```

A larger amount fails with `refund_exceeds_payment` and a message like "Only 12.00 USDT of this 37.00 USDT payment can still be refunded."

## 2. The payout wallet approves it (dashboard)

The merchant opens `signUrl`, or the Refund button on the Payments page, signed in with the **payout wallet**.
1. The dashboard shows the refund and the maximum refundable.
2. The payout wallet signs one EIP-3009 authorization moving exactly that amount to QuietPay.
3. QuietPay's relayer submits `refund()` and pays the gas. The contract sends the USDT **only to the original payer**.

If you build your own refund UI instead, these are the dashboard endpoints (merchant JWT):
- `POST /dash/refunds/:id/typed-data` returns `{ refund, signer, typedData }`; sign `typedData` with the payout wallet.
- `POST /dash/refunds/:id/submit` with `{ signature }` returns `{ refund, txHash }`.

## 3. Get notified

You receive `refund.succeeded` with `amount`, the running `totalRefunded`, and `fullyRefunded`:

```ts
if (event.type === "refund.succeeded") {
  await markRefunded(event.data.merchantReference, event.data.totalRefunded, event.data.fullyRefunded);
}
```

## Statuses

| Status | Meaning |
|---|---|
| `awaiting_signature` | Requested; waiting for the payout wallet |
| `submitted` | Signed and sent on-chain |
| `succeeded` | The customer has the money (`refund.succeeded` sent) |
| `failed` | The transaction failed; see `error`. Request a new refund. |

## Rules enforced on-chain

- The refund total can never exceed the payment (`RefundExceedsPayment`), even if two refunds race.
- Each refund has a sequence number (`seq`: 0, 1, 2…), and the payout wallet's signature is bound to it. If two refunds were signed against the same sequence, the second is rejected with a clear "sign again" error, and its next signature uses the next number.
- **Refunds work even when QuietPay is paused.** Customers can always get money back.
- The payout wallet needs enough USDT for the refund, or the API says how much it has and needs.
