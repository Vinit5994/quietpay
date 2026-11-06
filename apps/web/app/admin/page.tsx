"use client";

import Link from "next/link";
import { CircleDollarSign, LogOut, Receipt, RefreshCw, Repeat, ShieldCheck, Store, Undo2, UserPlus } from "lucide-react";
import { QUIETPAY_ADDRESS, explorerAddress, explorerTx, fromUnits } from "@quietpay/shared";
import { Logo } from "@/components/brand/Logo";
import { Button, Notice, Panel, Skeleton, Stat, Table } from "@/components/ui/kit";
import { isAdmin, loadAdminStats, type ActivityKind, type DayBucket } from "@/lib/admin/chain";
import { shortAddress, usdt } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useWallet } from "@/lib/wallet";

const money = (units: bigint) => usdt(fromUnits(units));
const when = (d: Date | null) => (d ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function AdminPage() {
  const wallet = useWallet();

  if (wallet.status === "loading") return <Centered>Loading…</Centered>;
  if (wallet.status === "signed_out" || !wallet.address) {
    return (
      <Centered>
        <p className="text-sm text-[var(--color-muted)]">The admin panel is for the QuietPay team. Sign in with a team wallet.</p>
        <div className="mt-4 flex flex-col gap-2">
          {wallet.loginOptions.map((o) => (
            <Button key={o.id} onClick={() => void wallet.login(o.id)}>
              {o.label}
            </Button>
          ))}
        </div>
      </Centered>
    );
  }
  if (!isAdmin(wallet.address)) {
    return (
      <Centered>
        <p className="text-sm">
          <span className="font-mono">{shortAddress(wallet.address)}</span> isn&apos;t on the team list. Add it to <code className="font-mono text-xs">NEXT_PUBLIC_ADMIN_ADDRESSES</code> to give it access.
        </p>
        <Button variant="secondary" className="mt-4 w-full" onClick={() => void wallet.logout()}>
          Use a different account
        </Button>
      </Centered>
    );
  }
  return <Admin address={wallet.address} onSignOut={() => void wallet.logout()} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4">
      <Logo size={28} />
      <h1 className="mt-6 text-2xl font-semibold">Admin</h1>
      <div className="mt-4 rounded-xl border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-pop)]">{children}</div>
    </main>
  );
}

function Admin({ address, onSignOut }: { address: string; onSignOut: () => void }) {
  const stats = useApi((_signal) => loadAdminStats(), [], { pollMs: 30_000 });
  const s = stats.data;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-[var(--color-line)] bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="QuietPay home">
              <Logo size={26} />
            </Link>
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-pine)] px-2 py-0.5 text-xs font-medium text-white">
              <ShieldCheck className="h-3 w-3" aria-hidden /> Team
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden font-mono text-xs text-[var(--color-muted)] sm:inline">{shortAddress(address)}</span>
            <button type="button" onClick={onSignOut} className="inline-flex items-center gap-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)]">
              <LogOut className="h-4 w-4" aria-hidden /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Platform</h1>
            <p className="mt-1.5 text-sm text-[var(--color-muted)]">
              Read live from the{" "}
              {QUIETPAY_ADDRESS ? (
                <a href={explorerAddress(QUIETPAY_ADDRESS)} target="_blank" rel="noreferrer" className="text-[var(--color-link)] hover:underline">
                  QuietPay contract
                </a>
              ) : (
                "QuietPay contract"
              )}{" "}
              on Whitechain. Refreshes every 30 seconds{s ? `, last at block ${s.latestBlock.toString()}` : ""}.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void stats.reload()} disabled={stats.loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${stats.loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> Refresh
          </Button>
        </div>

        {stats.error ? <Notice tone="bad">Couldn&apos;t read the chain: {stats.error}</Notice> : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat icon={Store} label="Merchants" value={s ? s.merchants.length : "…"} hint={s ? `${s.plans} subscription plans` : undefined} />
          <Stat icon={Receipt} label="Payments" value={s ? s.payments : "…"} />
          <Stat icon={CircleDollarSign} label="Volume" value={s ? money(s.volume) : "…"} />
          <Stat icon={Repeat} label="Active subscriptions" value={s ? s.activeSubscriptions : "…"} hint={s ? `${s.subscriptions} started in total` : undefined} />
          <Stat icon={Undo2} label="Refunds" value={s ? s.refunds : "…"} hint={s ? `${money(s.refunded)} returned` : undefined} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel title="Volume, last 14 days">{s ? <VolumeChart days={s.days} /> : <Skeleton rows={4} />}</Panel>
          <Panel title="Latest activity">
            {s ? (
              s.activity.length ? (
                <ul className="divide-y divide-[var(--color-line)]">
                  {s.activity.slice(0, 8).map((a) => (
                    <li key={`${a.txHash}-${a.kind}`} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <ActivityIcon kind={a.kind} />
                      <span className="min-w-0 flex-1 truncate">
                        {activityLabel(a.kind)}
                        {a.merchantId !== null ? <span className="text-[var(--color-muted)]"> for merchant #{a.merchantId.toString()}</span> : null}
                      </span>
                      {a.amount !== null ? <span className="tabular shrink-0">{money(a.amount)}</span> : null}
                      <a href={explorerTx(a.txHash)} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-[var(--color-link)] hover:underline">
                        tx
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-5 text-sm text-[var(--color-muted)]">Nothing on-chain yet.</p>
              )
            ) : (
              <Skeleton rows={5} />
            )}
          </Panel>
        </div>

        <Panel className="mt-6" title="Merchants">
          {s ? (
            <Table head={["Merchant", "Payout wallet", "Joined", ">Payments", ">Volume", ">Refunded", ""]} empty={s.merchants.length ? false : "No merchants yet."}>
              {s.merchants.map((m) => (
                <tr key={m.id.toString()}>
                  <td className="px-5 py-3 font-medium">#{m.id.toString()}</td>
                  <td className="px-5 py-3">
                    <a href={explorerAddress(m.payout)} target="_blank" rel="noreferrer" className="font-mono text-xs hover:text-[var(--color-link)]">
                      {shortAddress(m.payout)}
                    </a>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-[var(--color-muted)]">{when(m.joinedAt)}</td>
                  <td className="tabular px-5 py-3 text-right">{m.payments}</td>
                  <td className="tabular whitespace-nowrap px-5 py-3 text-right font-medium">{money(m.volume)}</td>
                  <td className="tabular whitespace-nowrap px-5 py-3 text-right text-[var(--color-muted)]">{m.refunded > 0n ? money(m.refunded) : "—"}</td>
                  <td className="px-5 py-3 text-right">
                    <a href={explorerTx(m.txHash)} target="_blank" rel="noreferrer" className="text-xs text-[var(--color-link)] hover:underline">
                      Registration tx
                    </a>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Skeleton rows={4} />
          )}
        </Panel>
        <p className="mt-4 text-xs text-[var(--color-muted)]">Business names and emails live in each API instance, not on-chain, so merchants show by on-chain id.</p>
      </main>
    </div>
  );
}

function VolumeChart({ days }: { days: DayBucket[] }) {
  const max = days.reduce((m, d) => (d.volume > m ? d.volume : m), 0n);
  return (
    <div className="p-5">
      <div className="flex h-44 items-end gap-1.5" role="img" aria-label="Daily USDT volume for the last 14 days">
        {days.map((d) => {
          const pct = max > 0n ? Number((d.volume * 1000n) / max) / 10 : 0;
          return (
            <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
              <div
                className={`w-full rounded-t ${d.volume > 0n ? "bg-[var(--color-brand)]" : "bg-[var(--color-neutral-soft)]"}`}
                style={{ height: `${Math.max(pct, 2)}%` }}
                title={`${d.day}: ${money(d.volume)}, ${d.payments} payments, ${d.merchants} new merchants`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-[var(--color-muted)]">
        <span>{days[0]?.day.slice(5)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

const activityMeta: Record<ActivityKind, { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  merchant: { label: "New merchant", icon: UserPlus, cls: "bg-[var(--color-info-soft)] text-[var(--color-pine)]" },
  payment: { label: "Payment", icon: Receipt, cls: "bg-[var(--color-brand-soft)] text-[var(--color-good)]" },
  refund: { label: "Refund", icon: Undo2, cls: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]" },
  subscribe: { label: "New subscription", icon: Repeat, cls: "bg-[var(--color-brand-soft)] text-[var(--color-good)]" },
  cancel: { label: "Subscription canceled", icon: Repeat, cls: "bg-[var(--color-neutral-soft)] text-[var(--color-muted)]" },
};
const activityLabel = (k: ActivityKind) => activityMeta[k].label;

function ActivityIcon({ kind }: { kind: ActivityKind }) {
  const m = activityMeta[kind];
  return (
    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${m.cls}`} aria-hidden>
      <m.icon className="h-3.5 w-3.5" />
    </span>
  );
}
