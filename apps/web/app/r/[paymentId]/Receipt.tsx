"use client";

import { Notice, StatusChip, TxLink } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { shortAddress, usdt } from "@/lib/format";
import { useApi } from "@/lib/use-api";

export function Receipt({ paymentId }: { paymentId: string }) {
  const receipt = useApi((signal) => api("publicReceipt", { params: { paymentId }, signal }), [paymentId]);
  const r = receipt.data;

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10 print:py-0">
      <article className="rounded-[var(--radius-base)] border-2 border-[var(--color-ink)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-brutal-lg)] print:border-0 print:shadow-none">
        {receipt.error && !r ? (
          <Notice tone="bad">{receipt.error.includes("not") ? "We couldn't find this receipt. Check the link and try again." : receipt.error}</Notice>
        ) : !r ? (
          <div className="space-y-3" aria-label="Loading receipt">
            <div className="h-5 w-1/2 animate-pulse rounded bg-[var(--color-line)]" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--color-line)]" />
          </div>
        ) : (
          <>
            <header className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Receipt</p>
                <h1 className="mt-1 text-xl font-semibold">{r.merchant.name}</h1>
                <p className="text-sm text-[var(--color-muted)]">{new Date(r.paidAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p>
              </div>
              <StatusChip status={r.status} />
            </header>

            <ul className="mt-6 divide-y divide-[var(--color-line)] border-y border-[var(--color-line)]">
              {r.lineItems.map((item, i) => (
                <li key={i} className="flex justify-between gap-3 py-2.5 text-sm">
                  <span>
                    {item.name}
                    {item.quantity > 1 ? <span className="text-[var(--color-muted)]"> × {item.quantity}</span> : null}
                  </span>
                  <span className="tabular">{usdt(item.amount)}</span>
                </li>
              ))}
            </ul>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="font-semibold">Total paid</dt>
                <dd className="tabular text-lg font-semibold">{usdt(r.amount)}</dd>
              </div>
              {r.refunds.map((rf) => (
                <div key={rf.id} className="flex justify-between text-[var(--color-muted)]">
                  <dt>
                    Refund · {new Date(rf.createdAt).toLocaleDateString()} {rf.txHash ? <TxLink hash={rf.txHash} label="tx" /> : null}
                  </dt>
                  <dd className="tabular">−{usdt(rf.amount)}</dd>
                </div>
              ))}
              {r.refunded !== "0.00" ? (
                <div className="flex justify-between border-t border-[var(--color-line)] pt-2">
                  <dt>Net</dt>
                  <dd className="tabular font-medium">
                    {usdt((Number(r.amount) - Number(r.refunded)).toFixed(2))}
                  </dd>
                </div>
              ) : null}
            </dl>

            <dl className="mt-6 grid grid-cols-2 gap-3 rounded-[var(--radius-base)] border-2 border-dashed border-[var(--color-ink)]/40 bg-[var(--color-bg)] p-3 text-xs">
              <div>
                <dt className="text-[var(--color-muted)]">{r.kind === "subscription" ? "Subscription" : "Order"}</dt>
                <dd className="mt-0.5 break-all font-mono">{r.planName ?? r.reference ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted)]">Paid from</dt>
                <dd className="mt-0.5 font-mono">{shortAddress(r.payerAddress)}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted)]">Receipt ID</dt>
                <dd className="mt-0.5 break-all font-mono">{r.paymentId.slice(0, 18)}…</dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted)]">Settlement</dt>
                <dd className="mt-0.5">
                  <TxLink hash={r.txHash} label="View on explorer" />
                </dd>
              </div>
            </dl>
            <p className="mt-5 text-center text-xs text-[var(--color-muted)]">Paid in USDT on Whitechain via QuietPay · no gas fees for you</p>
          </>
        )}
      </article>
    </main>
  );
}
