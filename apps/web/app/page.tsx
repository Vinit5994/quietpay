import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-20">
      <h1 className="text-3xl font-semibold">QuietPay</h1>
      <p className="mt-3 text-[var(--color-muted)]">
        Get paid in USDT on Whitechain: checkout, payment links, subscriptions and refunds. Nobody pays gas.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link className="nb-press inline-flex items-center justify-center rounded-[var(--radius-base)] border-2 border-[var(--color-ink)] bg-[var(--color-accent)] font-bold text-[var(--color-ink)] px-4 py-2.5" href="/dashboard">
          Merchant dashboard
        </Link>
        <Link className="nb-press inline-flex items-center justify-center rounded-[var(--radius-base)] border-2 border-[var(--color-ink)] bg-[var(--color-surface)] font-bold px-4 py-2.5" href="/portal">
          Customer portal
        </Link>
      </div>
    </main>
  );
}
