"use client";

import Link from "next/link";
import { useState } from "react";
import type { PortalResponse } from "@quietpay/shared";
import { Button, Modal, Notice, Panel, Skeleton, StatusChip } from "@/components/ui/kit";
import { ApiError, api } from "@/lib/api";
import { useCustomerSession } from "@/lib/customer-auth";
import { intervalLabel, shortAddress, timeAgo, usdt } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { SignatureRejectedError, useWallet } from "@/lib/wallet";

type Sub = PortalResponse["subscriptions"][number];

export default function PortalPage() {
  const { wallet, token, state, error, signIn, expire } = useCustomerSession();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className="inline-flex items-center gap-1.5 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-accent)] px-2.5 py-0.5 text-xs font-black uppercase tracking-wider">QuietPay</p>
      <h1 className="mt-1 text-2xl font-semibold">Your payments</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">Subscriptions and receipts for everything you paid with QuietPay.</p>

      <div className="mt-6">
        {state === "loading" || state === "signing_in" ? (
          <Panel>
            <p className="p-5 text-sm text-[var(--color-muted)]">{state === "signing_in" ? "Waiting for your signature…" : "Loading…"}</p>
          </Panel>
        ) : state === "no_wallet" ? (
          <Panel>
            <div className="space-y-3 p-5">
              <p className="text-sm">Sign in the same way you did at checkout.</p>
              {wallet.loginOptions.map((o) => (
                <Button key={o.id} onClick={() => void wallet.login(o.id)}>
                  {o.label}
                </Button>
              ))}
            </div>
          </Panel>
        ) : state === "signed_out" || !token ? (
          <Panel>
            <div className="space-y-3 p-5">
              <p className="text-sm">
                Confirm it&apos;s you to see payments from <span className="font-mono">{wallet.address ? shortAddress(wallet.address) : ""}</span>. Signing is free.
              </p>
              {error ? <Notice tone="bad">{error}</Notice> : null}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void signIn()}>Confirm and continue</Button>
                <Button variant="ghost" onClick={() => void wallet.logout()}>
                  Use a different account
                </Button>
              </div>
            </div>
          </Panel>
        ) : (
          <Portal token={token} onExpired={expire} />
        )}
      </div>
    </main>
  );
}

function Portal({ token, onExpired }: { token: string; onExpired: () => void }) {
  const portal = useApi(
    async (signal) => {
      try {
        return await api("publicPortal", { token, signal });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) onExpired();
        throw err;
      }
    },
    [token],
    { pollMs: 5000 },
  );
  const [canceling, setCanceling] = useState<Sub | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const data = portal.data;
  if (!data) return portal.error ? <Notice tone="bad">{portal.error}</Notice> : <Panel><Skeleton rows={4} /></Panel>;

  return (
    <div className="space-y-6">
      {notice ? <Notice tone="good">{notice}</Notice> : null}
      <Panel title="Subscriptions">
        {data.subscriptions.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-muted)]">You don&apos;t have any subscriptions.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {data.subscriptions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.planName} <span className="font-normal text-[var(--color-muted)]">· {s.merchantName}</span>
                  </p>
                  <p className="tabular text-sm text-[var(--color-muted)]">
                    {usdt(s.amount)} {intervalLabel(s.periodSeconds)} ·{" "}
                    {s.status === "active" && s.nextChargeAt
                      ? `next charge ${new Date(s.nextChargeAt).toLocaleString()}`
                      : s.status === "past_due"
                        ? "last payment failed, retrying"
                        : `canceled${s.cancelReason === "nonpayment" ? " (unpaid)" : ""}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusChip status={s.status} />
                  {s.status !== "canceled" ? (
                    <Button size="sm" variant="danger" onClick={() => setCanceling(s)}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Payments">
        {data.payments.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-muted)]">No payments yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {data.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium">{p.merchantName}</p>
                  <p className="text-sm text-[var(--color-muted)]">
                    {timeAgo(p.paidAt)} · {p.kind === "subscription" ? "Subscription" : "Purchase"}
                    {p.refunded !== "0.00" ? ` · ${usdt(p.refunded)} refunded` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="tabular font-semibold">{usdt(p.amount)}</span>
                  <StatusChip status={p.status} />
                  <Link href={`/r/${p.id}`} className="text-sm font-bold text-[var(--color-link)] underline decoration-2 underline-offset-2 hover:decoration-[var(--color-accent)]">
                    Receipt
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canceling ? (
        <CancelModal
          sub={canceling}
          token={token}
          onClose={() => setCanceling(null)}
          onDone={() => {
            setNotice(`${canceling.planName} is canceled. You won't be charged again.`);
            setCanceling(null);
            void portal.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function CancelModal({ sub, token, onClose, onDone }: { sub: Sub; token: string; onClose: () => void; onDone: () => void }) {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const { typedData } = await api("publicPortalCancelPrepare", { token, params: { id: sub.id } });
      const signature = await wallet.signTypedData(typedData, `Cancel ${sub.planName}`);
      await api("publicPortalCancelSubmit", { token, params: { id: sub.id }, body: { signature } });
      onDone();
    } catch (err) {
      setError(err instanceof SignatureRejectedError ? "You closed the signature request. Your subscription is still active." : err instanceof Error ? err.message : "Couldn't cancel.");
      setBusy(false);
    }
  };

  return (
    <Modal title={`Cancel ${sub.planName}?`} onClose={onClose}>
      <p className="text-sm">
        You won&apos;t be charged again by {sub.merchantName}. Your spending allowance stops being used immediately.
      </p>
      {error ? (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Keep subscription
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => void cancel()}>
          {busy ? "Canceling…" : "Cancel subscription"}
        </Button>
      </div>
    </Modal>
  );
}
