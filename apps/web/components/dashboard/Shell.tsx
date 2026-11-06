"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Check, Code2, Layers, LayoutDashboard, LogOut, QrCode, Receipt, Repeat, Store } from "lucide-react";
import { BuiltWith } from "@/components/brand/BuiltWith";
import { Logo } from "@/components/brand/Logo";
import { Button, CopyField, Field, Notice, inputCls } from "@/components/ui/kit";
import { ApiError, api } from "@/lib/api";
import { env } from "@/lib/env";
import { shortAddress } from "@/lib/format";
import { MerchantAuthProvider, useMerchantAuth } from "@/lib/merchant-auth";
import { useWallet } from "@/lib/wallet";

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/payments", label: "Payments", icon: Receipt },
  { href: "/dashboard/subscriptions", label: "Subscriptions", icon: Repeat },
  { href: "/dashboard/plans", label: "Plans", icon: Layers },
  { href: "/dashboard/links", label: "Payment links", icon: QrCode },
  { href: "/dashboard/developers", label: "Developers", icon: Code2 },
];

const joinSteps = ["Sign in with email or Google", "Confirm it's your wallet", "Name your business"];

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
  const step = session.state === "no_wallet" ? 0 : session.state === "signed_out" || session.state === "signing_in" ? 1 : session.state === "loading" ? -1 : 2;
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-[var(--color-pine)] p-10 text-white lg:flex">
        <Link href="/" aria-label="QuietPay home">
          <Logo tone="dark" size={30} />
        </Link>
        <div className="max-w-md">
          <h1 className="text-4xl font-semibold leading-tight">Set up your business in about two minutes.</h1>
          <p className="mt-4 text-white/70">Payments settle in USDT straight to your wallet. QuietPay pays the network fees and never holds your money.</p>
          <ol className="mt-10 space-y-4">
            {joinSteps.map((label, i) => (
              <li key={label} className="flex items-center gap-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm ${
                    i < step ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-white" : i === step ? "border-white text-white" : "border-white/25 text-white/50"
                  }`}
                >
                  {i < step ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
                </span>
                <span className={i <= step ? "text-white" : "text-white/50"}>{label}</span>
              </li>
            ))}
          </ol>
        </div>
        <BuiltWith tone="dark" compact />
      </section>
      <section className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="lg:hidden" aria-label="QuietPay home">
            <Logo size={28} />
          </Link>
          <h2 className="mt-8 text-3xl font-semibold lg:mt-0">{step === 2 ? "Name your business" : "Merchant dashboard"}</h2>
          <p className="mt-2 text-[var(--color-muted)]">
            {step === 2 ? "This is what customers see at checkout." : "Sign in to take payments, issue refunds and see your customers."}
          </p>
          <div className="mt-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-pop)]">
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
          <p className="mt-6 text-center text-sm text-[var(--color-muted)]">
            Paying a merchant?{" "}
            <Link href="/portal" className="font-medium text-[var(--color-link)] hover:underline">
              Manage your subscriptions
            </Link>
          </p>
        </div>
      </section>
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
        <div className="mt-5 border-t border-[var(--color-line)] pt-4">
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
        <h2 className="text-xl font-semibold">{created.merchant.name} is ready</h2>
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
        <h2 className="text-xl font-semibold">Set up your business</h2>
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
      <aside className="border-b border-[var(--color-line)] bg-[var(--color-surface)] md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4 md:block md:px-5 md:pt-5">
          <Link href="/" aria-label="QuietPay home">
            <Logo size={26} />
          </Link>
          <div className="flex min-w-0 items-center gap-2.5 md:mt-6 md:rounded-xl md:border md:border-[var(--color-line)] md:bg-[var(--color-bg)] md:p-2.5">
            <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-soft)] text-[var(--color-pine)] md:flex" aria-hidden>
              <Store className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{session.merchant.name}</p>
              <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-warn)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-amber)]" aria-hidden /> Test mode
              </p>
            </div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:mt-2 md:flex-col md:pb-0" aria-label="Dashboard">
          {nav.map((item) => {
            const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
                  active ? "bg-[var(--color-brand-soft)] font-medium text-[var(--color-pine)]" : "text-[var(--color-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-ink)]"
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden border-t border-[var(--color-line)] p-4 text-xs md:block">
          <p className="text-[var(--color-muted)]">Payout wallet</p>
          <p className="mt-0.5 font-mono text-[var(--color-ink)]">{wallet.address ? shortAddress(wallet.address) : ""}</p>
          <button type="button" onClick={signOut} className="mt-3 inline-flex items-center gap-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)]">
            <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</div>
    </div>
  );
}
