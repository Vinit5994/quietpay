"use client";

import { useState } from "react";
import type { Subscription } from "@quietpay/shared";
import { Button, Modal, Notice, PageHeader, Panel, Skeleton, StatusChip, Table } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { intervalLabel, shortAddress, timeAgo, usdt } from "@/lib/format";
import { useMerchantToken } from "@/lib/merchant-auth";
import { useApi } from "@/lib/use-api";

const filters = [
  { id: undefined, label: "All" },
  { id: "active", label: "Active" },
  { id: "past_due", label: "Past due" },
  { id: "canceled", label: "Canceled" },
] as const;

const reasonLabel = { customer: "by customer", nonpayment: "unpaid", merchant: "by you" } as const;

function NextCharge({ s }: { s: Subscription }) {
  if (s.status === "canceled") return <span className="text-[var(--color-muted)]">{s.cancelReason ? `Canceled ${reasonLabel[s.cancelReason]}` : "Canceled"}</span>;
  if (s.status === "past_due") return <span className="text-[var(--color-warn)]">Retrying · {s.failedAttempts} failed</span>;
  if (!s.nextChargeAt) return <span>—</span>;
  const ms = new Date(s.nextChargeAt).getTime() - Date.now();
  return <span>{ms <= 0 ? "due now" : ms < 3_600_000 ? `in ${Math.max(1, Math.round(ms / 60_000))} min` : new Date(s.nextChargeAt).toLocaleString()}</span>;
}

export default function SubscriptionsPage() {
  const token = useMerchantToken();
  const [status, setStatus] = useState<(typeof filters)[number]["id"]>(undefined);
  const subs = useApi((signal) => api("dashSubscriptions", { token, signal, query: { status, limit: 100 } }), [token, status], { pollMs: 4000 });
  const [canceling, setCanceling] = useState<Subscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = async () => {
    if (!canceling) return;
    setBusy(true);
    setError(null);
    try {
      await api("cancelSubscription", { token, params: { id: canceling.id } });
      setCanceling(null);
      void subs.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't cancel.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Subscriptions" description="Renewals are charged automatically. Failed renewals retry during the grace period, then cancel." />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
        {filters.map((f) => (
          <button
            key={f.label}
            type="button"
            role="tab"
            aria-selected={status === f.id}
            onClick={() => setStatus(f.id)}
            className={`rounded-full px-3 py-1 text-sm ${status === f.id ? "bg-[var(--color-accent)] text-[var(--color-accent-ink)]" : "border border-[var(--color-line)] hover:bg-[var(--color-surface)]"}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {subs.error ? <Notice tone="bad">{subs.error}</Notice> : null}
      <Panel>
        {subs.loading && !subs.data ? (
          <Skeleton rows={4} />
        ) : (
          <Table head={["Plan", "Customer", ">Amount", "Periods paid", "Next charge", "Status", ""]} empty={subs.data?.data.length ? false : "No subscriptions here yet."}>
            {subs.data?.data.map((s) => (
              <tr key={s.id}>
                <td className="px-5 py-3">
                  <p className="font-medium">{s.planName}</p>
                  <p className="text-xs text-[var(--color-muted)]">started {timeAgo(s.createdAt)}</p>
                </td>
                <td className="px-5 py-3 font-mono text-xs">{shortAddress(s.subscriberAddress)}</td>
                <td className="tabular whitespace-nowrap px-5 py-3 text-right">
                  {usdt(s.amount)}
                  <span className="block text-xs text-[var(--color-muted)]">{intervalLabel(s.periodSeconds)}</span>
                </td>
                <td className="tabular px-5 py-3">{s.cycle + 1}</td>
                <td className="whitespace-nowrap px-5 py-3 text-sm">
                  <NextCharge s={s} />
                </td>
                <td className="px-5 py-3">
                  <StatusChip status={s.status} />
                </td>
                <td className="px-5 py-3 text-right">
                  {s.status !== "canceled" ? (
                    <Button size="sm" variant="danger" onClick={() => setCanceling(s)}>
                      Cancel
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      {canceling ? (
        <Modal title="Cancel subscription?" onClose={() => setCanceling(null)}>
          <p className="text-sm">
            {canceling.planName} for <span className="font-mono">{shortAddress(canceling.subscriberAddress)}</span> stops now. The customer won&apos;t be charged again and keeps what they already paid for.
          </p>
          {error ? (
            <div className="mt-3">
              <Notice tone="bad">{error}</Notice>
            </div>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCanceling(null)}>
              Keep it
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void cancel()}>
              {busy ? "Canceling…" : "Cancel subscription"}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
