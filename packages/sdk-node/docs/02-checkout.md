# Checkout

A **checkout session** is one attempt to pay. You create it on your server, then the customer completes it on QuietPay's hosted page at `session.url`.

## Create a one-time payment

```ts
const session = await qp.checkout.sessions.create({
  mode: "payment",
  reference: "order_1001",
  lineItems: [{ name: "Builder Hoodie (L)", unitAmount: "25.00", quantity: 1 }],
  successUrl: "https://shop.example/orders/1001",
  cancelUrl: "https://shop.example/cart",
  customerEmail: "ada@example.com", // optional
  expiresInSeconds: 1800, // optional, default 30 minutes
});
```

| Field | Rules |
|---|---|
| `reference` | Your id for this order, 1–200 characters. Every webhook includes it as `merchantReference`. |
| `lineItems` | 1–50 items. `name` up to 200 characters, `quantity` 1–1000. |
| `unitAmount` | USDT as a decimal string with **at most 2 decimals**: `"25.00"`, `"3"` and `"0.5"` are fine; `"1.005"` is rejected. |
| total | The sum of `unitAmount × quantity`. Must be at least **0.50 USDT**. |
| `expiresInSeconds` | 60 to 86,400 (24 hours). |
| `successUrl` / `cancelUrl` | Where the customer goes after paying, or when they back out. |

The response is a [`CheckoutSession`](08-reference.md#checkoutsession). `session.url` is the page to redirect to, and `session.amount` is the computed total (`"37.00"`).

## Session statuses

| Status | Meaning |
|---|---|
| `open` | Waiting for the customer |
| `processing` | The customer signed; the transaction is on its way (usually about 2 seconds) |
| `complete` | Paid. `paymentId` and `txHash` are set. |
| `expired` | Not paid before `expiresAt`. Create a new session to retry. |

If a submitted transaction fails, the session goes back to `open` and the customer can try again. Nothing was charged.

```ts
const s = await qp.checkout.sessions.retrieve("sess_…");
if (s.status === "complete") console.log(s.paymentId, s.txHash);
```

**Don't poll for fulfilment. Use the `payment.succeeded` webhook.** The webhook is signed, retried, and arrives even if the customer closes the tab before the redirect.

## Subscriptions

Pass `mode: "subscription"` and a plan id instead of line items. See [Subscriptions](04-subscriptions.md).

```ts
await qp.checkout.sessions.create({
  mode: "subscription",
  planId: "plan_…",
  reference: "box_42",
  successUrl: "https://shop.example/box",
  cancelUrl: "https://shop.example/box",
});
```

## What happens on the hosted page

1. QuietPay shows your business name and icon, the items and the total. The icon is your site's own (`/icon.svg`, then `/favicon.ico`, on the origin of your `cancelUrl`); without one, the first letter of your business name is shown.
2. The customer signs in with email or Google and gets an embedded wallet, or connects MetaMask.
3. If their USDT balance is too low, the page says exactly how much they have and need.
4. They sign one `ReceiveWithAuthorization` message for exactly this amount, to QuietPay, for this order.
5. QuietPay's relayer submits it and pays the gas. The contract checks **your invoice signature** (QuietPay signs it with your merchant key when the session is created), then moves the USDT to your payout wallet.
6. The customer sees the explorer link and returns to your `successUrl` (or, in a pop-up, the window closes and your page is told; see below).

**Safety:** a signature can only pay **this order, once, to QuietPay**. The nonce is derived from your merchant id and the order id, and the token only lets QuietPay redeem it. Copying it can't redirect the money.

## Open checkout in a pop-up

Instead of redirecting, you can open the hosted checkout in a pop-up window over your site, so the customer never leaves your page. Add `popup=1` to the session URL and open it with `window.open`. When the customer finishes or cancels, the checkout sends your page one message and closes itself:

```ts
{ type: "quietpay:checkout", status: "completed" | "canceled", sessionId: "sess_…", redirectUrl: "https://shop.example/orders/1001" }
```

The message is posted only to the origin of your `successUrl`. A minimal client helper:

```ts
// In the click handler: open the window first (before any await), or browsers block it.
const popup = window.open("", "quietpay-checkout", "popup=yes,width=460,height=760");
const { url } = await createCheckout(); // your server calls qp.checkout.sessions.create and returns session.url
if (!popup) return location.assign(url); // pop-up blocked or a phone: fall back to the redirect

const target = new URL(url);
target.searchParams.set("popup", "1");
popup.location.href = target.href;

window.addEventListener("message", (e) => {
  if (e.origin !== target.origin || e.data?.type !== "quietpay:checkout") return; // only trust QuietPay
  if (e.data.status === "completed") location.assign(e.data.redirectUrl); // e.g. your order page
});
```

- **Fulfil from the webhook, not the message.** The message only moves the customer along; `payment.succeeded` is still the source of truth.
- **Only navigate within your own site.** Check that `redirectUrl` is on your origin before using it.
- A real window (not an iframe) is required, so the customer's login and wallet keep working.
- On small screens, just redirect: pop-ups open as new tabs on phones anyway.

Swag Counter's full helper, with an overlay and close detection, is in [`apps/store/lib/quietpay-checkout.tsx`](https://github.com/Vinit5994/quietpay/blob/main/apps/store/lib/quietpay-checkout.tsx).
