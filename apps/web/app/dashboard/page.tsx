"use client";

import Link from "next/link";
import { PageHeader, Panel, Skeleton, Stat, StatusChip, Table, TxLink, Notice } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { shortAddress, timeAgo, usdt } from "@/lib/format";
import { useMerchantToken } from "@/lib/merchant-auth";
import { useApi } from "@/lib/use-api";

export default function OverviewPage() {
  const token = useMerchantToken();
  const overview = useApi((signal) => api("dashOverview", { token, signal }), [token], { pollMs: 5000 });
  const recent = useApi((signal) => api("dashPayments", { token, signal, query: { limit: 6 } }), [token], { pollMs: 5000 });
  const o = overview.data;

  return (
    <>
      <PageHeader title="Overview" description="Everything settles in USDT straight to your payout wallet. Updates every few seconds." />
      {overview.error ? <Notice tone="bad">{overview.error}</Notice> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Volume, 24h" value={o ? usdt(o.volume24h) : "…"} hint={o ? `${o.paymentsCount} payments in total` : undefined} />
        <Stat label="Volume, 7 days" value={o ? usdt(o.volume7d) : "…"} />
        <Stat label="MRR" value={o ? usdt(o.mrr) : "…"} hint={o ? `${o.activeSubscriptions} active subscriptions` : undefined} />
        <Stat
          label="Past due"
          value={o ? o.pastDueSubscriptions : "…"}
          tone={o && o.pastDueSubscriptions > 0 ? "warn" : undefined}
          hint={o ? `${o.refundsCount} refunds · ${usdt(o.refundsTotal)}` : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Recent payments"
          action={
            <Link href="/dashboard/payments" className="text-sm text-[var(--color-accent)] hover:underline">
              View all
            </Link>
          }
        >
          {recent.loading && !recent.data ? (
            <Skeleton />
          ) : (
            <Table head={["When", "Reference", "Customer", ">Amount", "Status", ""]} empty={recent.data?.data.length ? false : "No payments yet."}>
              {recent.data?.data.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap px-5 py-3 text-[var(--color-muted)]">{timeAgo(p.paidAt)}</td>
                  <td className="max-w-[180px] truncate px-5 py-3 font-mono text-xs">{p.reference ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-xs">{shortAddress(p.payerAddress)}</td>
                  <td className="tabular whitespace-nowrap px-5 py-3 text-right font-medium">{usdt(p.amount)}</td>
                  <td className="px-5 py-3">
                    <StatusChip status={p.status} />
                  </td>
                  <td className="px-5 py-3">
                    <TxLink hash={p.txHash} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>

        <Panel title="Gas">
          <div className="space-y-3 p-5 text-sm">
            <p>
              You&apos;ve spent <span className="tabular font-semibold">{o ? `${Number(o.gas.spent).toFixed(4)} WBT` : "…"}</span> on{" "}
              <span className="tabular font-semibold">{o?.gas.txCount ?? "…"}</span> transactions.
            </p>
            <p className="rounded-lg bg-[var(--color-good)]/10 px-3 py-2 font-medium text-[var(--color-good)]">Your customers have paid 0 WBT in gas.</p>
            {o ? (
              <div>
                <div className="flex justify-between text-xs text-[var(--color-muted)]">
                  <span>Gas budget used</span>
                  <span className="tabular">
                    {Number(o.gas.spent).toFixed(4)} / {Number(o.gas.budget).toFixed(4)} WBT
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-line)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-accent)]"
                    style={{ width: `${Math.min(100, (Number(o.gas.spentWei) / Math.max(1, Number(o.gas.budgetWei))) * 100)}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>
    </>
  );
}
