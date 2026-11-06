"use client";

import { useState } from "react";
import type { Product } from "@/lib/products";
import { ProductArt } from "./ProductArt";

const views = [
  { label: "Front", className: "h-full w-full", bg: "bg-white" },
  { label: "Close-up", className: "h-[140%] w-[140%]", bg: "bg-[var(--color-cream)]" },
  { label: "On cream", className: "h-full w-full", bg: "bg-[var(--color-cream)]" },
  { label: "Detail", className: "h-[190%] w-[190%] translate-x-[8%]", bg: "bg-white" },
];

export function ProductGallery({ product }: { product: Product }) {
  const [active, setActive] = useState(0);
  const art = (cls: string) => <ProductArt kind={product.kind} base={product.colors.base} accent={product.colors.accent} className={cls} />;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-4 gap-4" role="tablist" aria-label="Product views">
        {views.map((v, i) => (
          <button
            key={v.label}
            type="button"
            role="tab"
            aria-selected={active === i}
            aria-label={v.label}
            onClick={() => setActive(i)}
            className={`flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border p-2 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${v.bg} ${
              active === i ? "border-[var(--color-heading)]/60" : "border-[var(--color-line)] hover:border-[var(--color-heading)]/30"
            }`}
          >
            {art(v.className)}
          </button>
        ))}
      </div>
      <div className={`flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-[var(--color-cream-line)] p-10 ${views[active]!.bg}`}>
        {art(`${views[active]!.className} max-w-none`)}
      </div>
    </div>
  );
}
