"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";

/** Opens a fresh checkout for a payment link (each visit gets its own session), or thanks the payer after paying. */
export function PaymentLink({ slug, paid }: { slug: string; paid: boolean }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (paid) return;
    const ctrl = new AbortController();
    api("publicLink", { params: { slug }, signal: ctrl.signal })
      .then((link) => window.location.replace(link.sessionUrl))
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof ApiError && err.code === "not_found" ? "This payment link doesn't exist or has been turned off." : "We couldn't open this payment link. Please try again.");
      });
    return () => ctrl.abort();
  }, [slug, paid]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10 text-center">
      <section className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-sm" aria-live="polite">
        {paid ? (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-good)]/15 text-[var(--color-good)]" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </div>
            <h1 className="mt-4 text-xl font-semibold">Payment received</h1>
            <p className="mt-2 text-sm text-[var(--color-muted)]">Thanks! Show this screen at the counter to collect your order.</p>
          </>
        ) : error ? (
          <>
            <h1 className="text-lg font-semibold">Payment link unavailable</h1>
            <p className="mt-2 text-sm text-[var(--color-muted)]">{error}</p>
            <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-lg border border-[var(--color-line)] px-4 py-2.5 font-medium">
              Try again
            </button>
          </>
        ) : (
          <>
            <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-r-transparent motion-reduce:animate-none" aria-hidden />
            <p className="mt-4 font-medium">Opening secure checkout…</p>
          </>
        )}
      </section>
      <p className="mt-6 text-xs text-[var(--color-muted)]">Secure checkout by QuietPay · paid in USDT</p>
    </main>
  );
}
