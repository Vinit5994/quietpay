import type { Metadata } from "next";
import { ProductArt } from "@/components/ProductArt";
import { Sparkle } from "@/components/Sparkle";
import { builderBox } from "@/lib/products";
import { formatUsdt } from "@/lib/money";

export const metadata: Metadata = { title: "Builder Box" };

// Subscribe flow and live status are added in B7.
export default function BoxPage() {
  return (
    <main className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pt-10 sm:px-6 md:grid-cols-2">
      <div className="relative flex aspect-square items-center justify-center rounded-2xl border border-[var(--color-cream-line)] bg-[var(--color-cream)] p-12">
        <ProductArt kind={builderBox.kind} base={builderBox.colors.base} accent={builderBox.colors.accent} className="h-full w-full max-w-sm" />
        <Sparkle size={44} className="absolute right-8 top-8" />
      </div>
      <div>
        <span className="inline-flex rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">Monthly drop</span>
        <h1 className="mt-4 text-5xl font-bold tracking-tight text-[var(--color-heading)]">{builderBox.name}</h1>
        <p className="tabular mt-3 text-2xl text-[var(--color-heading)]">
          {formatUsdt(builderBox.price)} <span className="text-lg text-[var(--color-muted)]">{builderBox.subscription!.interval}</span>
        </p>
        <p className="mt-5 max-w-prose text-[var(--color-ink)]">{builderBox.description}</p>
        <p className="mt-8 rounded-lg bg-[#f8f9fb] px-4 py-3 text-sm text-[var(--color-muted)] ring-1 ring-[var(--color-line)]">
          Subscriptions open shortly.
        </p>
      </div>
    </main>
  );
}
