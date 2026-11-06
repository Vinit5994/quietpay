"use client";

import { useState } from "react";
import { Button, Field, Modal, Notice, PageHeader, Panel, Skeleton, StatusChip, Table, inputCls } from "@/components/ui/kit";
import { ApiError, api } from "@/lib/api";
import { intervalLabel, timeAgo, usdt } from "@/lib/format";
import { useMerchantToken } from "@/lib/merchant-auth";
import { useApi } from "@/lib/use-api";

export default function PlansPage() {
  const token = useMerchantToken();
  const plans = useApi((signal) => api("listPlans", { token, signal, query: { limit: 100 } }), [token]);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Plans"
        description="Recurring prices your customers can subscribe to. Use a plan's ID when creating a subscription checkout."
        action={<Button onClick={() => setCreating(true)}>New plan</Button>}
      />
      {plans.error ? <Notice tone="bad">{plans.error}</Notice> : null}
      <Panel>
        {plans.loading && !plans.data ? (
          <Skeleton />
        ) : (
          <Table head={["Plan", ">Price", "Billing", "Grace period", "Plan ID", "Status"]} empty={plans.data?.data.length ? false : "No plans yet. Create one to sell subscriptions."}>
            {plans.data?.data.map((p) => (
              <tr key={p.id}>
                <td className="px-5 py-3">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-[var(--color-muted)]">created {timeAgo(p.createdAt)}</p>
                </td>
                <td className="tabular whitespace-nowrap px-5 py-3 text-right font-medium">{usdt(p.amount)}</td>
                <td className="px-5 py-3">{intervalLabel(p.periodSeconds)}</td>
                <td className="px-5 py-3">{p.graceSeconds >= 86_400 ? `${Math.round(p.graceSeconds / 86_400)} days` : `${Math.round(p.graceSeconds / 60)} min`}</td>
                <td className="px-5 py-3 font-mono text-xs">{p.id}</td>
                <td className="px-5 py-3">
                  <StatusChip status={p.active ? "active" : "inactive"} label={p.active ? "Live" : "Off"} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      {creating ? (
        <NewPlan
          token={token}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void plans.reload();
          }}
        />
      ) : null}
    </>
  );
}

function NewPlan({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState<"month" | "week">("month");
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("createPlan", {
        token,
        body: demo ? { name: name.trim(), amount, interval: "custom", periodSeconds: 120, graceSeconds: 60 } : { name: name.trim(), amount, interval },
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the plan.");
      setBusy(false);
    }
  };

  return (
    <Modal title="New plan" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <input id="plan-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Builder Box" />
        </Field>
        <Field label="Price per period (USDT)" hint="Up to 2 decimals.">
          <input id="plan-amount" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} tabular`} placeholder="15.00" />
        </Field>
        <fieldset disabled={demo}>
          <legend className="text-sm font-medium">Billing</legend>
          <div className="mt-1 flex gap-2">
            {(["month", "week"] as const).map((i) => (
              <label key={i} className={`flex-1 cursor-pointer rounded-[var(--radius-base)] border border-[var(--color-line)] px-3 py-2 text-center text-sm font-medium transition ${interval === i && !demo ? "bg-[var(--color-accent)] text-[var(--color-accent-ink)] border-[var(--color-accent)]" : "bg-[var(--color-surface)] hover:bg-[var(--color-bg)]"}`}>
                <input type="radio" name="interval" className="sr-only" checked={interval === i} onChange={() => setInterval(i)} />
                Every {i}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-3 rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3 text-sm">
          <input id="plan-demo" type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} className="mt-0.5" />
          <span>
            <span className="font-medium">Demo: renew every 2 minutes</span>
            <span className="block text-xs text-[var(--color-muted)]">1-minute grace period, so renewals and failures show up live.</span>
          </span>
        </label>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create plan"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
