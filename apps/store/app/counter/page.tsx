import type { Metadata } from "next";

export const metadata: Metadata = { title: "Counter" };

// The Sticker Pack payment-link QR is added in B7.
export default function CounterPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pt-16 text-center sm:px-6">
      <h1 className="text-4xl font-bold tracking-tight text-[var(--color-heading)]">Scan to pay at the counter</h1>
      <p className="mt-3 text-[var(--color-muted)]">The Sticker Pack QR code shows here once payment links are connected.</p>
    </main>
  );
}
