"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/lib/cart";
import type { Product } from "@/lib/products";

export function AddToCart({ product }: { product: Product }) {
  const { add } = useCart();
  const [size, setSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const onAdd = () => {
    if (product.sizes && !size) {
      setError("Pick a size first.");
      return;
    }
    add({ productId: product.id, size: product.sizes ? size : null, qty });
    setError(null);
    setAdded(true);
  };

  return (
    <div className="flex flex-col gap-5">
      {product.sizes ? (
        <fieldset>
          <div className="flex items-baseline justify-between border-b border-[var(--color-line)] pb-3">
            <legend className="text-lg font-semibold text-[var(--color-heading)]">Select a size</legend>
            <span className="text-sm font-semibold text-[var(--color-heading)]">Fits true to size</span>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-4 sm:grid-cols-5">
            {product.sizes.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={size === s}
                onClick={() => {
                  setSize(s);
                  setError(null);
                  setAdded(false);
                }}
                className={`h-14 rounded-lg border text-lg font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${
                  size === s
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                    : "border-[var(--color-line)] bg-white text-[var(--color-heading)] hover:border-[var(--color-heading)]/40"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="flex items-center gap-3">
        <label htmlFor="qty" className="text-sm font-medium text-[var(--color-muted)]">
          Quantity
        </label>
        <div className="inline-flex items-center rounded-lg border border-[var(--color-line)]">
          <button type="button" aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-10 w-10 text-lg">
            −
          </button>
          <input
            id="qty"
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(20, Number(e.target.value.replace(/\D/g, "")) || 1)))}
            className="tabular h-10 w-12 border-x border-[var(--color-line)] text-center outline-none"
          />
          <button type="button" aria-label="Increase quantity" onClick={() => setQty((q) => Math.min(20, q + 1))} className="h-10 w-10 text-lg">
            +
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-[var(--color-bad)]">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onAdd}
        className="h-14 rounded-lg bg-[var(--color-primary)] text-lg font-semibold text-white transition hover:bg-[var(--color-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
      >
        Add to cart
      </button>

      {added ? (
        <p role="status" className="flex items-center justify-between rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800 ring-1 ring-green-200">
          Added to your cart.
          <Link href="/cart" className="font-semibold underline underline-offset-2">
            View cart
          </Link>
        </p>
      ) : null}
    </div>
  );
}
