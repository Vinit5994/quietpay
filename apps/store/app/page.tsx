import Link from "next/link";
import { ProductArt } from "@/components/ProductArt";
import { ProductCard } from "@/components/ProductCard";
import { Dot, Sparkle } from "@/components/Sparkle";
import { builderBox, products, shopProducts } from "@/lib/products";
import { formatUsdt } from "@/lib/money";

export default function Home() {
  const hoodie = products[0]!;
  return (
    <main>
      {/* Hero */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 md:grid-cols-2 md:pt-16">
        <div className="max-w-md">
          <h1 className="text-5xl font-bold leading-[1.05] tracking-tight text-[var(--color-heading)] text-balance sm:text-6xl">
            Hackathon swag, paid in USDT
          </h1>
          <p className="mt-5 text-lg text-[var(--color-muted)]">
            Hoodies, tees and a monthly Builder Box. Check out in seconds with USDT on Whitechain, and never pay a gas fee.
          </p>
          <Link
            href="#products"
            className="mt-7 inline-flex rounded-lg bg-[var(--color-primary)] px-5 py-3 font-semibold text-white transition hover:bg-[var(--color-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          >
            Browse collection
          </Link>
        </div>

        <div className="relative mx-auto aspect-[5/4] w-full max-w-lg" aria-hidden>
          <div
            className="absolute inset-x-0 bottom-[8%] h-[46%] -rotate-[8deg] rounded-[50%] border-b-[10px] border-[var(--color-navy)]"
            style={{ background: "linear-gradient(100deg, #f6b98f 0%, #b7a2e8 55%, #5b5bea 100%)" }}
          />
          <ProductArt kind={hoodie.kind} base={hoodie.colors.base} accent={hoodie.colors.accent} className="absolute inset-x-[18%] bottom-[22%] top-0 drop-shadow-xl" />
          <Sparkle size={52} className="float-slow absolute left-[6%] top-[14%]" />
          <Sparkle size={30} className="absolute right-[10%] top-[30%]" />
          <Sparkle size={64} className="float-slow absolute bottom-[26%] right-[2%]" />
          <Sparkle size={24} className="absolute bottom-[12%] left-[16%]" />
          <Dot size={12} ring className="absolute left-[24%] top-[4%]" />
          <Dot size={8} className="absolute right-[24%] top-[8%]" />
          <Dot size={14} ring className="absolute bottom-[40%] left-[2%]" />
        </div>
      </section>

      {/* Featured: Builder Box */}
      <section className="mx-auto w-full max-w-6xl px-4 sm:px-6" aria-labelledby="featured-title">
        <div className="relative isolate grid items-center gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div
            className="absolute inset-y-0 left-0 right-0 -z-10 rounded-3xl md:left-[18%]"
            style={{ background: "linear-gradient(110deg, #fdecc8 0%, #f5e6f3 55%, #ece6fb 100%)" }}
          />
          <div className="dotted-edge absolute right-0 top-0 -z-10 hidden h-1/2 w-24 rounded-tr-3xl md:block" />
          <Link
            href="/box"
            className="m-4 flex aspect-square items-center justify-center rounded-xl border border-[var(--color-line)] bg-white p-10 shadow-sm md:m-0 md:my-10"
          >
            <ProductArt kind={builderBox.kind} base={builderBox.colors.base} accent={builderBox.colors.accent} className="h-full w-full max-w-[280px]" />
          </Link>
          <div className="px-6 pb-10 md:px-10 md:py-12">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden /> Monthly drop
            </span>
            <h2 id="featured-title" className="mt-4 text-3xl font-bold tracking-tight text-[var(--color-heading)] sm:text-4xl">
              {builderBox.name}
            </h2>
            <p className="mt-3 max-w-lg text-[var(--color-muted)]">{builderBox.description}</p>
            <p className="tabular mt-4 font-semibold text-[var(--color-heading)]">
              {formatUsdt(builderBox.price)} <span className="font-normal text-[var(--color-muted)]">{builderBox.subscription!.interval}</span>
            </p>
            <Link
              href="/box"
              className="mt-6 inline-flex rounded-lg border border-[var(--color-heading)]/20 bg-white px-5 py-2.5 font-semibold text-[var(--color-heading)] transition hover:border-[var(--color-heading)]/40"
            >
              Get the Builder Box
            </Link>
          </div>
        </div>
      </section>

      {/* All items */}
      <section id="products" className="mx-auto w-full max-w-6xl scroll-mt-8 px-4 pt-24 sm:px-6">
        <h2 className="text-5xl font-bold tracking-tight text-[var(--color-heading)]">All Items</h2>
        <div className="mt-12 grid grid-cols-1 gap-x-12 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
          {shopProducts.map((p, i) => (
            <ProductCard key={p.id} product={p} cream={i % 3 !== 0} />
          ))}
          <ProductCard product={builderBox} cream />
        </div>
      </section>
    </main>
  );
}
