"use client";

import Link from "next/link";
import { CheckoutOverlay, useQuietPayCheckout } from "@/lib/quietpay-checkout";
import { ProductImage } from "@/components/ProductImage";
import { useCart } from "@/lib/cart";
import { findProduct } from "@/lib/products";
import { formatUsdt, lineTotal } from "@/lib/money";
import { checkout } from "./actions";

export function CartView() {
  const cart = useCart();
  const qp = useQuietPayCheckout();
  const pending = qp.phase !== "idle";
  const error = qp.error;

  if (!cart.ready) return <div className="h-40 animate-pulse rounded-xl bg-[var(--color-line)]/40" aria-label="Loading cart" />;

  if (cart.items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-line)] p-12 text-center">
        <p className="text-lg font-semibold text-[var(--color-heading)]">Your cart is empty</p>
        <p className="mt-1 text-[var(--color-muted)]">Pick a hoodie, a tee or a sticker pack to get started.</p>
        <Link href="/#products" className="mt-6 inline-flex rounded-lg bg-[var(--color-primary)] px-5 py-3 font-semibold text-white hover:bg-[var(--color-primary-hover)]">
          Browse collection
        </Link>
      </div>
    );
  }

  const pay = () => qp.start(() => checkout(cart.items));

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
      <ul className="self-start divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
        {cart.items.map((item) => {
          const p = findProduct(item.productId)!;
          return (
            <li key={`${item.productId}-${item.size}`} className="flex gap-4 py-5 sm:gap-6">
              <Link
                href={`/p/${p.id}`}
                className={`relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-cream-line)] bg-[var(--color-cream)] ${p.photos?.length ? "" : "p-2"}`}
              >
                <ProductImage product={p} sizes="96px" />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <Link href={`/p/${p.id}`} className="font-semibold text-[var(--color-heading)] hover:underline">
                    {p.name}
                  </Link>
                  <p className="text-sm text-[var(--color-muted)]">
                    {item.size ? `Size ${item.size} · ` : ""}
                    {formatUsdt(p.price)} each
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="inline-flex items-center rounded-lg border border-[var(--color-line)]">
                    <button type="button" aria-label={`Decrease ${p.name}`} onClick={() => cart.setQty(item.productId, item.size, item.qty - 1)} className="h-9 w-9">
                      −
                    </button>
                    <span className="tabular w-8 text-center">{item.qty}</span>
                    <button type="button" aria-label={`Increase ${p.name}`} onClick={() => cart.setQty(item.productId, item.size, item.qty + 1)} className="h-9 w-9">
                      +
                    </button>
                  </div>
                  <span className="tabular w-28 text-right font-semibold">{formatUsdt(lineTotal(p.price, item.qty))}</span>
                  <button type="button" onClick={() => cart.remove(item.productId, item.size)} className="text-sm text-[var(--color-muted)] underline-offset-2 hover:underline">
                    Remove
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <aside className="h-fit rounded-2xl border border-[var(--color-line)] bg-[#f8f9fb] p-6">
        <h2 className="text-lg font-semibold text-[var(--color-heading)]">Order summary</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--color-muted)]">Items</dt>
            <dd className="tabular">{cart.count}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-muted)]">Pickup at the counter</dt>
            <dd>Free</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-muted)]">Network fees</dt>
            <dd>None</dd>
          </div>
        </dl>
        <div className="mt-4 flex items-baseline justify-between border-t border-[var(--color-line)] pt-4">
          <span className="font-semibold">Total</span>
          <span className="tabular text-2xl font-bold text-[var(--color-heading)]">{formatUsdt(cart.total)}</span>
        </div>
        {error ? (
          <p role="alert" className="mt-4 text-sm font-medium text-[var(--color-bad)]">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          onClick={pay}
          disabled={pending}
          className="mt-5 h-13 w-full rounded-lg bg-[var(--color-primary)] py-3.5 text-lg font-semibold text-white transition hover:bg-[var(--color-primary-hover)] disabled:opacity-70"
        >
          {qp.phase === "preparing" ? "Creating your order…" : qp.phase === "open" ? "Waiting for payment…" : "Pay with USDT"}
        </button>
        <p className="mt-3 text-center text-xs text-[var(--color-muted)]">Secure checkout by QuietPay. Sign in with email or Google; no crypto app needed.</p>
      </aside>
      <CheckoutOverlay phase={qp.phase} onFocus={qp.focus} onCancel={qp.cancel} />
    </div>
  );
}
