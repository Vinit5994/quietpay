import Link from "next/link";
import type { Product } from "@/lib/products";
import { formatUsdt } from "@/lib/money";
import { ProductArt } from "./ProductArt";

export function ProductCard({ product, cream }: { product: Product; cream?: boolean }) {
  const href = product.subscription ? "/box" : `/p/${product.id}`;
  return (
    <Link href={href} className="group flex flex-col items-center gap-4 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-primary)]">
      <div
        className={`flex aspect-square w-full items-center justify-center rounded-lg border p-8 transition group-hover:-translate-y-0.5 group-hover:shadow-md ${
          cream ? "border-[var(--color-cream-line)] bg-[var(--color-cream)]" : "border-[var(--color-line)] bg-white"
        }`}
      >
        <ProductArt kind={product.kind} base={product.colors.base} accent={product.colors.accent} className="h-full w-full max-w-[260px]" />
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold text-[var(--color-heading)]">{product.name}</p>
        <p className="tabular mt-0.5 text-sm text-[var(--color-muted)]">{formatUsdt(product.price)}</p>
      </div>
    </Link>
  );
}
