import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AddToCart } from "@/components/AddToCart";
import { InfoTiles } from "@/components/InfoTiles";
import { ProductGallery } from "@/components/ProductGallery";
import { findProduct, shopProducts } from "@/lib/products";
import { formatUsdt } from "@/lib/money";

type Props = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return shopProducts.map((p) => ({ id: p.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = findProduct((await params).id);
  return { title: product?.name ?? "Product" };
}

export default async function ProductPage({ params }: Props) {
  const product = findProduct((await params).id);
  if (!product) notFound();
  if (product.subscription) redirect("/box");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-10 pt-10 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-[17px]">
        <Link href="/#products" className="font-medium text-[var(--color-heading)] hover:underline">
          Swag Counter
        </Link>
        <span className="mx-2 text-[var(--color-muted)]">/</span>
        <span className="text-[var(--color-muted)]">{product.name}</span>
      </nav>

      <div className="mt-10 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
        <ProductGallery product={product} />

        <div className="flex min-w-0 flex-col gap-7">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-[var(--color-heading)] text-balance sm:text-5xl">{product.name}</h1>
            <p className="tabular mt-3 text-3xl text-[var(--color-heading)]">{formatUsdt(product.price)}</p>
            <p className="mt-5 flex items-center gap-2 text-lg text-[var(--color-heading)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-good)" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              In stock and ready to ship
            </p>
          </div>

          <section>
            <h2 className="border-b border-[var(--color-line)] pb-3 text-lg font-semibold text-[var(--color-heading)]">Description</h2>
            <p className="mt-4 max-w-prose text-[var(--color-ink)]">{product.description}</p>
          </section>

          <InfoTiles />
          <AddToCart product={product} />

          <p className="flex items-center justify-center gap-2 text-[var(--color-muted)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" />
              <circle cx="7" cy="17.5" r="1.5" />
              <circle cx="17" cy="17.5" r="1.5" />
            </svg>
            Pick up at the Swag Counter, or ships within 5 business days
          </p>
        </div>
      </div>
    </main>
  );
}
