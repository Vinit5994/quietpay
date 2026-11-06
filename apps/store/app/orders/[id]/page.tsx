import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ClearCart } from "@/components/ClearCart";
import { StatusChip } from "@/components/StatusChip";
import { getOrder } from "@/lib/orders";
import { formatUsdt } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const order = getOrder((await params).id);
  if (!order) notFound();
  const waiting = order.status === "pending";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-10 sm:px-6">
      <ClearCart />
      <AutoRefresh active={waiting} />
      <p className="text-sm text-[var(--color-muted)]">Order {order.id}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl font-bold tracking-tight text-[var(--color-heading)]">
          {order.status === "paid" ? "Thanks, you're all set" : waiting ? "Almost there" : "Your order"}
        </h1>
        <StatusChip status={order.status} />
      </div>
      <p className="mt-3 text-[var(--color-muted)]">
        {waiting
          ? "We're waiting for your USDT payment. This page updates by itself."
          : order.status === "paid"
            ? "Payment received. Pick up your swag at the counter with this order number."
            : order.status === "expired"
              ? "The payment window closed. Your cart is empty, so add the items again to retry."
              : "Part or all of this order was refunded to your wallet."}
      </p>

      {waiting && order.checkoutUrl ? (
        <a href={order.checkoutUrl} className="mt-6 inline-flex rounded-lg bg-[var(--color-primary)] px-5 py-3 font-semibold text-white hover:bg-[var(--color-primary-hover)]">
          Continue to payment
        </a>
      ) : null}

      <div className="mt-10 rounded-2xl border border-[var(--color-line)]">
        <ul className="divide-y divide-[var(--color-line)]">
          {order.lines.map((l) => (
            <li key={`${l.productId}-${l.size}`} className="flex justify-between gap-4 px-5 py-4">
              <span>
                {l.name}
                {l.qty > 1 ? <span className="text-[var(--color-muted)]"> × {l.qty}</span> : null}
              </span>
              <span className="tabular">{formatUsdt(l.total)}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between border-t border-[var(--color-line)] px-5 py-4">
          <span className="font-semibold">Total</span>
          <span className="tabular text-xl font-bold">{formatUsdt(order.total)}</span>
        </div>
        {order.refunded !== "0.00" ? (
          <div className="flex justify-between border-t border-[var(--color-line)] px-5 py-3 text-sm">
            <span className="text-[var(--color-muted)]">Refunded</span>
            <span className="tabular">−{formatUsdt(order.refunded)}</span>
          </div>
        ) : null}
      </div>

      {order.explorerUrl ? (
        <a href={order.explorerUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm font-medium text-[var(--color-violet)] underline-offset-2 hover:underline">
          View the payment on the explorer
        </a>
      ) : null}

      <div className="mt-10">
        <Link href="/#products" className="font-semibold text-[var(--color-heading)] underline-offset-2 hover:underline">
          ← Keep shopping
        </Link>
      </div>
    </main>
  );
}
