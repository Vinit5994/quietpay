import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-20">
      <h1 className="text-3xl font-semibold">QuietPay</h1>
      <p className="mt-3 text-[var(--color-muted)]">
        Get paid in USDT on Whitechain: checkout, payment links, subscriptions and refunds. Nobody pays gas.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link className="rounded-lg bg-[var(--color-accent)] px-4 py-2 font-medium text-[var(--color-accent-ink)]" href="/dashboard">
          Merchant dashboard
        </Link>
        <Link className="rounded-lg border border-[var(--color-line)] px-4 py-2 font-medium" href="/portal">
          Customer portal
        </Link>
      </div>
    </main>
  );
}
