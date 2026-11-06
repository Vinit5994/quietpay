"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button, CopyField, Field, Notice, inputCls } from "@/components/ui/kit";
import { ApiError, api } from "@/lib/api";
import { env } from "@/lib/env";
import { shortAddress } from "@/lib/format";
import { MerchantAuthProvider, useMerchantAuth } from "@/lib/merchant-auth";
import { useWallet } from "@/lib/wallet";

const nav = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/payments", label: "Payments" },
  { href: "/dashboard/subscriptions", label: "Subscriptions" },
  { href: "/dashboard/plans", label: "Plans" },
  { href: "/dashboard/links", label: "Payment links" },
  { href: "/dashboard/developers", label: "Developers" },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <MerchantAuthProvider>
      <Gate>{children}</Gate>
    </MerchantAuthProvider>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { session } = useMerchantAuth();
  if (session.state === "ready") return <Frame>{children}</Frame>;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div><p className="inline-flex items-center gap-1.5 rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-accent)] px-2.5 py-0.5 text-xs font-black uppercase tracking-wider">QuietPay</p></div>
      <h1 className="mt-3 text-4xl font-bold">Merchant dashboard</h1>
      <p className="mt-2 text-[var(--color-muted)]">Get paid in USDT. No gas, no seed phrases.</p>
      <div className="mt-6 rounded-[var(--radius-base)] border-2 border-[var(--color-ink)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-brutal-lg)]">
        {session.state === "loading" || session.state === "signing_in" ? (
          <p className="text-sm text-[var(--color-muted)]">{session.state === "signing_in" ? "Waiting for your signature…" : "Loading…"}</p>
        ) : session.state === "no_wallet" ? (
          <ConnectWallet />
        ) : session.state === "signed_out" ? (
          <SignIn error={session.error} />
        ) : (
          <Onboarding token={session.token} />
        )}
      </div>
    </main>
  );
}

function ConnectWallet() {
  const wallet = useWallet();
  return (
    <>
      <p className="text-sm text-[var(--color-muted)]">Connect the wallet you want to get paid to. Customer payments go straight to it.</p>
      <div className="mt-4 flex flex-col gap-2">
        {wallet.loginOptions.map((o) => (
          <Button key={o.id} onClick={() => void wallet.login(o.id)}>
            {o.label}
          </Button>
        ))}
      </div>
    </>
  );
}

function SignIn({ error }: { error?: string }) {
  const wallet = useWallet();
  const { signIn } = useMerchantAuth();
  const [claiming, setClaiming] = useState(false);
  const isMock = env.apiUrl.includes(":4010");

  const claimDemo = async () => {
    if (!wallet.address) return;
    setClaiming(true);
    try {
      await fetch(new URL("/mock/claim-demo-merchant", env.apiUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: wallet.address }),
      });
      await signIn();
    } finally {
      setClaiming(false);
    }
  };

  return (
    <>
      <p className="text-sm text-[var(--color-muted)]">
        Sign a message with <span className="font-mono text-[var(--color-ink)]">{wallet.address ? shortAddress(wallet.address) : "your wallet"}</span> to prove
        it&apos;s yours. Signing is free.
      </p>
      {error ? (
        <div className="mt-3">
          <Notice tone="bad">{error}</Notice>
        </div>
      ) : null}
      <div className="mt-4 flex flex-col gap-2">
        <Button onClick={() => void signIn()}>Sign in</Button>
        <Button variant="ghost" size="sm" onClick={() => void wallet.logout()}>
          Use a different wallet
        </Button>
      </div>
      {isMock ? (
        <div className="mt-5 border-t-2 border-dashed border-[var(--color-ink)]/30 pt-4">
          <p className="text-xs text-[var(--color-muted)]">Mock API only: open the seeded Swag Counter business (with sample data) using this wallet.</p>
          <Button size="sm" variant="secondary" className="mt-2" disabled={claiming} onClick={() => void claimDemo()}>
            Use demo merchant
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Onboarding({ token }: { token: string }) {
  const wallet = useWallet();
  const { setReady } = useMerchantAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ token: string; secretKey: string; webhookSecret: string; merchant: Parameters<typeof setReady>[1] } | null>(null);

  if (created) {
    return (
      <>
        <h2 className="text-xl font-bold">{created.merchant.name} is ready</h2>
        <Notice tone="warn">Copy these now. The secret key and webhook secret are only shown once.</Notice>
        <div className="mt-4 space-y-3">
          <CopyField label="Secret key (server only)" value={created.secretKey} secret />
          <CopyField label="Webhook signing secret" value={created.webhookSecret} secret />
        </div>
        <Button className="mt-5 w-full" onClick={() => setReady(created.token, created.merchant)}>
          I saved them, open the dashboard
        </Button>
      </>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet.address) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api("dashOnboard", { token, body: { name: name.trim(), payoutAddress: wallet.address } });
      setCreated({ token: res.token, secretKey: res.secretKey, webhookSecret: res.webhookSecret, merchant: res.merchant });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create your business. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Set up your business</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">Payments go straight to your wallet. QuietPay never holds your money.</p>
      </div>
      <Field label="Business name">
        <input id="business-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Swag Counter" />
      </Field>
      <Field label="Payout wallet" hint="The wallet you signed in with. Payments and refunds use it.">
        <input id="payout-wallet" readOnly value={wallet.address ?? ""} className={`${inputCls} font-mono text-xs text-[var(--color-muted)]`} />
      </Field>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
        {busy ? "Creating…" : "Create business"}
      </Button>
    </form>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, signOut } = useMerchantAuth();
  const wallet = useWallet();
  if (session.state !== "ready") return null;
  return (
    <div className="min-h-dvh md:flex">
      <aside className="border-b-2 border-[var(--color-ink)] bg-[var(--color-surface)] md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:flex-col md:border-b-0 md:border-r-2">
        <div className="flex items-center justify-between gap-3 px-4 py-4 md:block">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-base)] border-2 border-[var(--color-ink)] bg-[var(--color-accent)] font-[family-name:var(--font-display)] text-lg font-bold shadow-[var(--shadow-brutal-sm)]" aria-hidden>
              Q
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-wider text-[var(--color-muted)]">QuietPay</p>
              <p className="truncate font-[family-name:var(--font-display)] text-lg font-bold leading-tight">{session.merchant.name}</p>
            </div>
          </div>
          <span className="rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-warn-soft)] px-2 py-0.5 text-[11px] font-black uppercase tracking-wider md:mt-3 md:inline-block">Test mode</span>
        </div>
        <nav className="flex gap-1.5 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0" aria-label="Dashboard">
          {nav.map((item) => {
            const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-[var(--radius-base)] border-2 px-3 py-2 text-sm font-bold transition ${active ? "border-[var(--color-ink)] bg-[var(--color-accent)] shadow-[var(--shadow-brutal-sm)]" : "border-transparent hover:border-[var(--color-ink)] hover:bg-[var(--color-bg)]"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden border-t-2 border-[var(--color-ink)] p-4 text-xs md:block">
          <p className="inline-block rounded-[var(--radius-base)] border-2 border-[var(--color-ink)] bg-[var(--color-bg)] px-2 py-1 font-mono font-bold">{wallet.address ? shortAddress(wallet.address) : ""}</p>
          <button type="button" onClick={signOut} className="mt-2 block font-bold text-[var(--color-muted)] underline-offset-2 hover:text-[var(--color-ink)] hover:underline">
            Sign out
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</div>
    </div>
  );
}
