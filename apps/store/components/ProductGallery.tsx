"use client";

import { useState } from "react";
import type { Product } from "@/lib/products";
import { ProductArt } from "./ProductArt";
import { ProductImage } from "./ProductImage";

/** Real photos when the product has them; otherwise views of the drawing. */
const artViews = [
  { label: "Front", className: "h-full w-full", bg: "bg-white" },
  { label: "Close-up", className: "h-[140%] w-[140%]", bg: "bg-[var(--color-cream)]" },
  { label: "On cream", className: "h-full w-full", bg: "bg-[var(--color-cream)]" },
  { label: "Detail", className: "h-[190%] w-[190%] translate-x-[8%]", bg: "bg-white" },
];

export function ProductGallery({ product }: { product: Product }) {
  const [active, setActive] = useState(0);
  const photos = product.photos ?? [];
  const tabs = photos.length > 0 ? photos.map((p, i) => ({ label: i === 0 ? "Front" : `View ${i + 1}`, alt: p.alt })) : artViews;

  return (
    <div className="flex flex-col gap-5">
      {tabs.length > 1 ? (
        <div className="grid grid-cols-4 gap-4" role="tablist" aria-label="Product views">
          {tabs.map((t, i) => {
            const art = artViews[i];
            return (
              <button
                key={t.label}
                type="button"
                role="tab"
                aria-selected={active === i}
                aria-label={t.label}
                onClick={() => setActive(i)}
                className={`relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${
                  photos.length ? "bg-[#f3f4f6]" : `p-2 ${art?.bg}`
                } ${active === i ? "border-[var(--color-heading)]/60" : "border-[var(--color-line)] hover:border-[var(--color-heading)]/30"}`}
              >
                {photos.length ? (
                  <ProductImage product={product} index={i} sizes="160px" />
                ) : (
                  <ProductArt kind={product.kind} base={product.colors.base} accent={product.colors.accent} className={art!.className} />
                )}
              </button>
            );
          })}
        </div>
      ) : null}
      <div
        className={`relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-[var(--color-cream-line)] ${
          photos.length ? "bg-[#f3f4f6]" : `p-10 ${artViews[active]!.bg}`
        }`}
      >
        {photos.length ? (
          <ProductImage product={product} index={active} sizes="(min-width: 768px) 50vw, 100vw" priority />
        ) : (
          <ProductArt kind={product.kind} base={product.colors.base} accent={product.colors.accent} className={`${artViews[active]!.className} max-w-none`} />
        )}
      </div>
    </div>
  );
}
