import type { Metadata } from "next";
import QRCode from "qrcode";
import { findProduct } from "@/lib/products";
import { formatUsdt } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Counter" };

/** Printable "scan to pay" sign for the physical counter: a QuietPay payment link, no code needed. */
export default async function CounterPage() {
  const url = process.env.QUIETPAY_STICKER_LINK_URL ?? "http://localhost:3001/l/sticker-pack";
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1e1b4b", light: "#ffffff" } });
  const stickers = findProduct("sticker-pack")!;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center px-4 pt-8 text-center sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">At the counter</p>
      <h1 className="mt-2 text-5xl font-bold tracking-tight text-[var(--color-heading)]">{stickers.name}</h1>
      <p className="tabular mt-2 text-3xl text-[var(--color-heading)]">{formatUsdt(stickers.price)}</p>
      <div
        className="mt-8 w-full max-w-sm rounded-3xl border-4 border-[var(--color-navy)] bg-white p-6 shadow-[8px_8px_0_0_var(--color-star)]"
        role="img"
        aria-label={`QR code that opens ${url}`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="mt-8 text-xl font-semibold text-[var(--color-heading)]">Scan with your phone camera to pay</p>
      <p className="mt-2 text-[var(--color-muted)]">Sign in with email or Google. No crypto app and no gas fees.</p>
      <p className="mt-6 break-all font-mono text-xs text-[var(--color-muted)]">{url}</p>
    </main>
  );
}
