import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Countdown } from "@/components/Countdown";
import { ProductImage } from "@/components/ProductImage";
import { Sparkle } from "@/components/Sparkle";
import { StatusChip } from "@/components/StatusChip";
import { findBox } from "@/lib/orders";
import { builderBox } from "@/lib/products";
import { formatUsdt } from "@/lib/money";
import { syncPendingBox } from "@/lib/sync";
import { BOX_COOKIE } from "@/lib/box-cookie";
import { SubscribeButton } from "./SubscribeButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Builder Box" };

const portalUrl = process.env.QUIETPAY_PORTAL_URL ?? "http://localhost:3001/portal";

export default async function BoxPage() {
  const boxId = (await cookies()).get(BOX_COOKIE)?.value;
  const found = boxId ? findBox(boxId) : undefined;
  const box = found ? await syncPendingBox(found) : undefined;
  const live = box && box.status !== "canceled";

  return (
    <main className="mx-auto grid w-full max-w-6xl items-start gap-10 px-4 pt-10 sm:px-6 md:grid-cols-2">
      <AutoRefresh active={Boolean(live)} ms={3000} />
      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-[var(--color-cream-line)] bg-[var(--color-cream)]">
        <ProductImage product={builderBox} sizes="(min-width: 768px) 50vw, 100vw" priority />
        <Sparkle size={44} className="absolute right-8 top-8" />
      </div>

      <div className="flex flex-col gap-6">
        <div>
          <span className="inline-flex rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">Monthly drop</span>
          <h1 className="mt-4 text-5xl font-bold tracking-tight text-[var(--color-heading)]">{builderBox.name}</h1>
          <p className="tabular mt-3 text-2xl text-[var(--color-heading)]">
            {formatUsdt(builderBox.price)} <span className="text-lg text-[var(--color-muted)]">{builderBox.subscription!.interval}</span>
          </p>
          <p className="mt-5 max-w-prose text-[var(--color-ink)]">{builderBox.description}</p>
        </div>

        {!box || box.status === "canceled" ? (
          <>
            {box?.status === "canceled" ? (
              <StatusPanel tone="neutral" title="Your Builder Box is canceled" chip="canceled">
                {box.cancelReason === "nonpayment"
                  ? "We couldn't collect the payment before the grace period ended, so the subscription stopped. You can start a new one anytime."
                  : box.cancelReason === "customer"
                    ? "You canceled your subscription. You won't be charged again."
                    : box.cancelReason === "merchant"
                      ? "We canceled this subscription. You won't be charged again."
                      : "The checkout for this box wasn't completed."}
              </StatusPanel>
            ) : null}
            <ul className="space-y-2 text-[var(--color-ink)]">
              <li>✓ First box charged today, then {builderBox.subscription!.interval}</li>
              <li>✓ Paid in USDT, no gas fees, no crypto app needed</li>
              <li>✓ Cancel anytime from your QuietPay portal</li>
            </ul>
            <SubscribeButton label={box ? "Start a new Builder Box" : `Subscribe for ${formatUsdt(builderBox.price)}`} />
          </>
        ) : box.status === "pending" ? (
          <StatusPanel tone="neutral" title="Almost there" chip="pending">
            We&apos;re waiting for your first payment. This page updates by itself.
            {box.checkoutUrl ? (
              <a href={box.checkoutUrl} className="mt-4 inline-flex rounded-lg bg-[var(--color-primary)] px-5 py-3 font-semibold text-white hover:bg-[var(--color-primary-hover)]">
                Continue to payment
              </a>
            ) : null}
          </StatusPanel>
        ) : box.status === "active" ? (
          <StatusPanel tone="good" title="Your Builder Box is active" chip="active">
            <dl className="mt-1 grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-[var(--color-muted)]">Next box ships in</dt>
                <dd className="text-3xl font-bold text-[var(--color-heading)]">{box.nextChargeAt ? <Countdown to={box.nextChargeAt} /> : "—"}</dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--color-muted)]">Boxes paid</dt>
                <dd className="tabular text-3xl font-bold text-[var(--color-heading)]">{box.cycle + 1}</dd>
              </div>
            </dl>
            <BoxLinks box={box} />
          </StatusPanel>
        ) : (
          <StatusPanel tone="warn" title="Payment didn't go through" chip="past_due">
            We tried to charge {formatUsdt(builderBox.price)} for your next box, but your wallet didn&apos;t have enough USDT. Add USDT and we&apos;ll retry
            automatically. If it still fails after the grace period, the subscription stops.
            <BoxLinks box={box} />
          </StatusPanel>
        )}
      </div>
    </main>
  );

  function BoxLinks({ box: b }: { box: NonNullable<typeof box> }) {
    return (
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
        <a href={portalUrl} className="text-[var(--color-heading)] underline underline-offset-2">
          Manage or cancel
        </a>
        {b.lastTxUrl ? (
          <a href={b.lastTxUrl} target="_blank" rel="noreferrer" className="text-[var(--color-violet)] underline-offset-2 hover:underline">
            Latest payment on the explorer
          </a>
        ) : null}
      </div>
    );
  }
}

function StatusPanel({
  tone,
  title,
  chip,
  children,
}: {
  tone: "good" | "warn" | "neutral";
  title: string;
  chip: "active" | "past_due" | "canceled" | "pending";
  children: React.ReactNode;
}) {
  const ring = tone === "good" ? "ring-green-200 bg-green-50/60" : tone === "warn" ? "ring-amber-200 bg-amber-50/70" : "ring-[var(--color-line)] bg-[#f8f9fb]";
  return (
    <section className={`rounded-2xl p-6 ring-1 ${ring}`} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-[var(--color-heading)]">{title}</h2>
        <StatusChip status={chip} />
      </div>
      <div className="mt-3 flex flex-col text-[var(--color-ink)]">{children}</div>
    </section>
  );
}
