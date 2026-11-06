"use client";

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Check, CircleDollarSign, Repeat, TrendingUp } from "lucide-react";
import { PageHeader, Panel, Skeleton, Stat, StatusChip, Table, TxLink, Notice } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { shortAddress, timeAgo, usdt } from "@/lib/format";
import { useMerchantAuth, useMerchantToken } from "@/lib/merchant-auth";
import { useApi } from "@/lib/use-api";

export default function OverviewPage() {
  const token = useMerchantToken();
  const overview = useApi((signal) => api("dashOverview", { token, signal }), [token], { pollMs: 5000 });
  const recent = useApi((signal) => api("dashPayments", { token, signal, query: { limit: 6 } }), [token], { pollMs: 5000 });
  const plans = useApi((signal) => api("listPlans", { token, signal, query: { limit: 1 } }), [token]);
  const links = useApi((signal) => api("listPaymentLinks", { token, signal, query: { limit: 1 } }), [token]);
  const { session } = useMerchantAuth();
  const merchant = session.state === "ready" ? session.merchant : null;
  const o = overview.data;
  const setup = [
    { done: true, label: "Create your business", body: "Done. Payments go to your payout wallet.", href: null },
    { done: Boolean(merchant?.webhookUrl), label: "Connect your server", body: "Add your webhook URL and keys so your app hears about payments.", href: "/dashboard/developers" },
    { done: Boolean(plans.data?.data.length), label: "Create a subscription plan", body: "For memberships, boxes or SaaS seats.", href: "/dashboard/plans" },
    { done: Boolean(links.data?.data.length), label: "Make a payment link", body: "Share it or print the QR code. No code needed.", href: "/dashboard/links" },
    { done: Boolean(o && o.paymentsCount > 0), label: "Take your first payment", body: "Pay one of your links with test USDT to see the whole flow.", href: "/dashboard/links" },
  ];
  const doneCount = setup.filter((x) => x.done).length;

  return (
    <>
      <PageHeader title={merchant ? `Welcome back, ${merchant.name}` : "Overview"} description="Everything settles in USDT straight to your payout wallet. Updates every few seconds." />
      {overview.error ? <Notice tone="bad">{overview.error}</Notice> : null}
      {doneCount < setup.length ? (
        <Panel className="mb-6" title="Get set up" action={<span className="text-sm text-[var(--color-muted)]">{doneCount} of {setup.length} done</span>}>
          <div className="px-5 pt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-neutral-soft)]">
              <div className="h-full rounded-full bg-[var(--color-brand)] transition-[width] motion-reduce:transition-none" style={{ width: `${(doneCount / setup.length) * 100}%` }} />
            </div>
          </div>
          <ul className="grid gap-px p-2 sm:grid-cols-2 lg:grid-cols-3">
            {setup.map((item) => {
              const inner = (
                <>
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                      item.done ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white" : "border-[var(--color-line-strong)] text-transparent"
                    }`}
                    aria-hidden
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className={`flex items-center gap-1 text-sm font-medium ${item.done ? "text-[var(--color-muted)] line-through decoration-1" : ""}`}>
                      {item.label}
                      {!item.done && item.href ? <ArrowUpRight className="h-3.5 w-3.5 text-[var(--color-muted)]" aria-hidden /> : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--color-muted)]">{item.body}</span>
                  </span>
                </>
              );
              return (
                <li key={item.label}>
                  {item.href && !item.done ? (
                    <Link href={item.href} className="flex gap-3 rounded-lg p-3 hover:bg-[var(--color-bg)]">
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex gap-3 p-3">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={CircleDollarSign} label="Volume, 24h" value={o ? usdt(o.volume24h) : "…"} hint={o ? `${o.paymentsCount} payments in total` : undefined} />
        <Stat icon={TrendingUp} label="Volume, 7 days" value={o ? usdt(o.volume7d) : "…"} />
        <Stat icon={Repeat} label="MRR" value={o ? usdt(o.mrr) : "…"} hint={o ? `${o.activeSubscriptions} active, projected over 30 days` : undefined} />
        <Stat
          icon={AlertTriangle}
          label="Past due"
          value={o ? o.pastDueSubscriptions : "…"}
          tone={o && o.pastDueSubscriptions > 0 ? "warn" : undefined}
          hint={o ? `${o.refundsCount} refunds, ${usdt(o.refundsTotal)} returned` : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Recent payments"
          action={
            <Link href="/dashboard/payments" className="text-sm font-semibold text-[var(--color-link)] underline decoration-1 underline-offset-2 hover:decoration-[var(--color-link)]">
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
            <p className="flex items-center gap-2 rounded-lg bg-[var(--color-good-soft)] px-3 py-2 font-medium text-[var(--color-good)]">
              <Check className="h-4 w-4" aria-hidden /> Your customers have paid 0 WBT in gas.
            </p>
            {o ? (
              <div>
                <div className="flex justify-between text-xs text-[var(--color-muted)]">
                  <span>Gas budget used</span>
                  <span className="tabular">
                    {Number(o.gas.spent).toFixed(4)} / {Number(o.gas.budget).toFixed(4)} WBT
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--color-neutral-soft)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-brand)]"
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
