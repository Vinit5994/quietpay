import type { Metadata } from "next";
import { FundDemo } from "./FundDemo";

export const metadata: Metadata = { title: "Get test USDT · QuietPay" };

export default async function DemoFundPage({ searchParams }: { searchParams: Promise<{ return?: string }> }) {
  const { return: returnTo } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <p className="inline-flex items-center gap-1.5 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-accent)] px-2.5 py-0.5 text-xs font-black uppercase tracking-wider">QuietPay</p>
      <h1 className="mt-1 text-2xl font-semibold">Get test USDT</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">For trying the demo on Whitechain Sepolia.</p>
      <div className="mt-6 rounded-[var(--radius-base)] border-2 border-[var(--color-ink)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-brutal-lg)]">
        <FundDemo returnTo={returnTo} />
      </div>
    </main>
  );
}
