import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { StatusChip } from "@/components/StatusChip";
import { listBoxes, listOrders } from "@/lib/orders";
import { formatUsdt } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Staff" };

const dashboardUrl = process.env.QUIETPAY_DASHBOARD_URL ?? "http://localhost:3001/dashboard/payments";
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function StaffPage() {
  const orders = listOrders();
  const boxes = listBoxes();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-10 sm:px-6">
      <AutoRefresh active ms={3000} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">Staff only</p>
          <h1 className="mt-1 text-4xl font-bold tracking-tight text-[var(--color-heading)]">Orders and boxes</h1>
        </div>
        <a href={dashboardUrl} className="rounded-lg border border-[var(--color-line)] bg-white px-4 py-2.5 text-sm font-semibold hover:border-[var(--color-heading)]/30">
          Refunds happen in the QuietPay dashboard →
        </a>
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-[var(--color-heading)]">Orders</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--color-line)]">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-[#f8f9fb] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Order</th>
                <th className="px-4 py-3 font-semibold">Time</th>
                <th className="px-4 py-3 font-semibold">Items</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--color-muted)]">
                    No orders yet. They show up here as soon as someone checks out.
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={`/orders/${o.id}`} className="hover:underline">
                        {o.id}
                      </Link>
                    </td>
                    <td className="tabular px-4 py-3 text-[var(--color-muted)]">{time(o.createdAt)}</td>
                    <td className="px-4 py-3">{o.lines.map((l) => (l.qty > 1 ? `${l.name} ×${l.qty}` : l.name)).join(", ")}</td>
                    <td className="tabular px-4 py-3 text-right font-semibold">{formatUsdt(o.total)}</td>
                    <td className="px-4 py-3">
                      <StatusChip status={o.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-[var(--color-heading)]">Builder Boxes</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--color-line)]">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-[#f8f9fb] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Box</th>
                <th className="px-4 py-3 font-semibold">Periods paid</th>
                <th className="px-4 py-3 font-semibold">Next charge</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {boxes.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[var(--color-muted)]">
                    No Builder Box subscribers yet.
                  </td>
                </tr>
              ) : (
                boxes.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3 font-mono text-xs">{b.id}</td>
                    <td className="tabular px-4 py-3">{b.cycle + 1}</td>
                    <td className="tabular px-4 py-3 text-[var(--color-muted)]">{b.nextChargeAt ? time(b.nextChargeAt) : "—"}</td>
                    <td className="px-4 py-3">
                      <StatusChip status={b.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
