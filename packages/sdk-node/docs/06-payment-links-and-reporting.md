# Payment links and reporting

## Payment links

A payment link is a fixed-price URL, with a QR code, that anyone can pay. It needs no code on your side: print it at a counter, put it in a chat, or add it to an invoice.

```ts
const link = await qp.paymentLinks.create({
  title: "Sticker Pack",
  amount: "3.00",
  description: "Five holographic stickers", // optional
});

link.url; // https://pay.example/l/sticker-pack
link.qrSvg; // an SVG QR code for link.url, ready to render or print
```

- **Every visit creates a fresh checkout session,** so one printed QR can be paid any number of times.
- **Payments are recorded with `reference: "link:<slug>"`,** and the webhooks carry that as `merchantReference`.
- **Slugs come from the title** (`sticker-pack`). If a slug is taken, a suffix is added (`sticker-pack-2`).
- **After paying, the customer lands on their receipt** (there's no store page to return to). The receipt shows the items, the amount and the explorer link, and stays available in the customer portal.

`qp.paymentLinks.list()` returns your links.

## Listing payments

```ts
const page = await qp.payments.list({ limit: 20 });
for (const p of page.data) {
  console.log(p.paidAt, p.reference, p.amount, p.status, p.refundable, p.explorerUrl);
}
if (page.nextCursor) {
  const next = await qp.payments.list({ limit: 20, cursor: page.nextCursor });
}

// look up the payment for one of your orders
const { data: [payment] } = await qp.payments.list({ reference: "order_1001" });
```

- **Newest first.** `limit` is 1–100 (default 20). Pass `nextCursor` back as `cursor` for the next page; it's `null` on the last page.
- **Status:** `paid`, `partially_refunded` or `refunded`.
- **`net`** = amount − fee − refunded. **`refundable`** = amount − refunded.

## CSV export

```ts
const csv = await qp.exports.paymentsCsv();
```

The columns are `date, payment_id, kind, reference, payer, amount, fee, refunded, net, tx_hash, explorer_url`, one row per payment, newest first. Cells that a spreadsheet could run as a formula (they start with `=`, `+`, `-` or `@`) are quoted, so a hostile order reference can't execute in Excel.
