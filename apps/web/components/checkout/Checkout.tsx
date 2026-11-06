"use client";

import { useEffect, useState } from "react";
import { explorerTx, formatUsdt as formatUsdtBase, type PublicSession } from "@quietpay/shared";
import { env } from "@/lib/env";
import { intervalLabel, shortAddress } from "@/lib/format";
import type { Phase } from "@/lib/checkout/machine";
import { useCheckout } from "@/lib/checkout/useCheckout";
import type { Wallet } from "@/lib/wallet";
import { buttonCls } from "@/components/ui/kit";

/** "1234.5" → "1,234.50 USDT" */
const formatUsdt = (amount: string) => formatUsdtBase(amount).replace(/\B(?=(\d{3})+(?!\d))(?=[\d,]*\.)/g, ",");

export function Checkout({ sessionId }: { sessionId: string }) {
  const { phase, wallet, pay } = useCheckout(sessionId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6 sm:py-12">
      <Header
        session={phase.name === "loading" ? null : phase.session}
        loading={phase.name === "loading"}
        cancellable={phase.name === "review" || phase.name === "insufficient" || (phase.name === "pay" && phase.busy === null)}
      />
      <section className="mt-6 rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-pop)] sm:p-6" aria-live="polite">
        <Body phase={phase} wallet={wallet} pay={pay} />
      </section>
      <p className="mt-8 flex items-center justify-center gap-2 text-xs font-medium text-[var(--color-muted)]">
        <BrandMark /> Secure checkout by <span className="font-semibold text-[var(--color-ink)]">QuietPay</span> · paid in USDT
      </p>
    </main>
  );
}

function Header({ session, loading, cancellable }: { session: PublicSession | null; loading: boolean; cancellable: boolean }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-info-soft)] font-[family-name:var(--font-display)] text-lg font-semibold shadow-[var(--shadow-card)]" aria-hidden>
          {session ? session.merchant.name.slice(0, 1).toUpperCase() : "Q"}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Pay</p>
          <h1 className="truncate text-2xl font-semibold">
            {session ? session.merchant.name : loading ? <span className="inline-block h-6 w-32 animate-pulse rounded bg-[var(--color-ink)]/10" /> : "QuietPay"}
          </h1>
        </div>
      </div>
      {session && cancellable ? (
        <a href={session.cancelUrl} className={buttonCls("secondary", "sm")}>
          Cancel
        </a>
      ) : null}
    </header>
  );
}

function Body({ phase, wallet, pay }: { phase: Phase; wallet: Wallet; pay: () => void }) {
  switch (phase.name) {
    case "loading":
      return <Skeleton />;
    case "review":
      return (
        <>
          <Summary session={phase.session} />
          <div className="mt-5 flex flex-col gap-2">
            {wallet.loginOptions.map((opt) => (
              <button key={opt.id} type="button" onClick={() => void wallet.login(opt.id)} className={primaryBtn}>
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-center text-xs text-[var(--color-muted)]">No app to install. You'll confirm the payment on the next step.</p>
        </>
      );
    case "pay":
      return <PayView phase={phase} wallet={wallet} pay={pay} />;
    case "insufficient":
      return <InsufficientView phase={phase} wallet={wallet} pay={pay} />;
    case "processing":
      return (
        <div className="py-6 text-center">
          <Spinner />
          <p className="mt-4 font-medium">Confirming your payment…</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {phase.slow ? "This is taking longer than usual. You can keep this page open." : "This usually takes a couple of seconds."}
          </p>
        </div>
      );
    case "success":
      return <SuccessView phase={phase} />;
    case "closed":
      return <ClosedView phase={phase} />;
  }
}

function Summary({ session }: { session: PublicSession }) {
  if (session.mode === "subscription" && session.plan) {
    const plan = session.plan;
    const every = intervalLabel(plan.periodSeconds);
    return (
      <div>
        <span className="inline-block rounded-full border border-[var(--color-line)] bg-[var(--color-info-soft)] px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide">Subscription</span>
        <p className="mt-2 text-xl font-semibold">{plan.name}</p>
        <p className="tabular mt-3 font-[family-name:var(--font-display)] text-4xl font-semibold">
          {formatUsdt(plan.amount)}
          <span className="mt-1 block font-sans text-base font-medium text-[var(--color-muted)]">{every}</span>
        </p>
        <ul className="mt-4 space-y-1.5 text-sm">
          <li>First charge today, then {every}.</li>
          <li>Cancel anytime.</li>
        </ul>
        <p className="mt-4 rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3 text-sm">
          You allow {session.merchant.name} to charge up to <span className="tabular font-medium text-[var(--color-ink)]">{formatUsdt(plan.spendingCap)}</span> over{" "}
          {plan.capPeriods} periods. You're only charged {formatUsdt(plan.amount)} each period.
        </p>
      </div>
    );
  }
  return (
    <div>
      <ul className="divide-y divide-[var(--color-line)]">
        {session.lineItems.map((item, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 py-2.5 font-medium">
            <span className="min-w-0">
              {item.name}
              {item.quantity > 1 ? <span className="text-[var(--color-muted)]"> × {item.quantity}</span> : null}
            </span>
            <span className="tabular shrink-0">{formatUsdt(item.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-baseline justify-between rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2.5">
        <span className="font-semibold">Total</span>
        <span className="tabular font-[family-name:var(--font-display)] text-3xl font-semibold">{formatUsdt(session.amount)}</span>
      </div>
    </div>
  );
}

function PayView({ phase, wallet, pay }: { phase: Extract<Phase, { name: "pay" }>; wallet: Wallet; pay: () => void }) {
  const { session, busy, step, notice } = phase;
  const amount = session.mode === "subscription" && session.plan ? session.plan.amount : session.amount;
  const label = session.mode === "subscription" ? `Subscribe for ${formatUsdt(amount)}` : `Pay ${formatUsdt(amount)}`;
  const busyLabel =
    busy === "preparing"
      ? "Getting your payment ready…"
      : busy === "signing" && step
        ? step.total > 1
          ? `Step ${step.current} of ${step.total}: ${step.label}`
          : "Confirm in the window that opened"
        : busy === "submitting"
          ? "Sending payment…"
          : null;

  return (
    <>
      <Summary session={session} />
      {notice ? (
        <p role="alert" className="mt-4 rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-warn-soft)] p-3 text-sm font-medium">
          {notice}
        </p>
      ) : null}
      <button type="button" onClick={pay} disabled={busy !== null} className={`${primaryBtn} mt-5 w-full`}>
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <Spinner small /> {busyLabel}
          </span>
        ) : (
          label
        )}
      </button>
      <WalletDetails wallet={wallet} disabled={busy !== null} />
    </>
  );
}

function InsufficientView({ phase, wallet, pay }: { phase: Extract<Phase, { name: "insufficient" }>; wallet: Wallet; pay: () => void }) {
  const returnTo = `/c/${phase.session.id}`;
  return (
    <>
      <h2 className="text-xl font-semibold">Not enough USDT</h2>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Your wallet has <span className="tabular font-medium text-[var(--color-ink)]">{formatUsdt(phase.balance)}</span>. This order needs{" "}
        <span className="tabular font-medium text-[var(--color-ink)]">{formatUsdt(phase.needed)}</span>. Add funds and try again.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <button type="button" onClick={pay} className={primaryBtn}>
          Check again
        </button>
        {env.demoMode ? (
          <a href={`/demo/fund?return=${encodeURIComponent(returnTo)}`} className={secondaryBtn}>
            Get test USDT (testnet demo)
          </a>
        ) : null}
      </div>
      <WalletDetails wallet={wallet} open />
    </>
  );
}

function SuccessView({ phase }: { phase: Extract<Phase, { name: "success" }> }) {
  const { session, status } = phase;
  // Payment links return to QuietPay's own home page; send the customer to their receipt instead.
  const redirect = returnsToOwnHome(status.redirectUrl) ? (status.receiptUrl ?? status.redirectUrl) : status.redirectUrl;
  const toReceipt = Boolean(redirect && redirect === status.receiptUrl);
  const [seconds, setSeconds] = useState(3);

  useEffect(() => {
    if (!redirect) return;
    if (seconds <= 0) {
      window.location.assign(redirect);
      return;
    }
    const t = setTimeout(() => setSeconds((s) => s - 1), 1_000);
    return () => clearTimeout(t);
  }, [seconds, redirect]);

  const amount = session.mode === "subscription" && session.plan ? session.plan.amount : session.amount;
  return (
    <div className="text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-good-soft)] shadow-[var(--shadow-card)]" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <h2 className="mt-5 text-2xl font-semibold">{session.mode === "subscription" ? "You're subscribed" : "Payment complete"}</h2>
      <p className="tabular mt-1 font-medium text-[var(--color-muted)]">
        {formatUsdt(amount)} to {session.merchant.name}
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {status.receiptUrl && !toReceipt ? (
          <a href={status.receiptUrl} className={secondaryBtn}>
            View receipt
          </a>
        ) : null}
        {status.txHash ? (
          <a href={explorerTx(status.txHash)} target="_blank" rel="noreferrer" className={linkCls}>
            View transaction
          </a>
        ) : null}
      </div>
      {redirect ? (
        <p className="mt-5 text-sm text-[var(--color-muted)]">
          {toReceipt ? "Opening your receipt" : `Returning to ${session.merchant.name}`} in {Math.max(seconds, 0)}…{" "}
          <a href={redirect} className={linkCls}>
            {toReceipt ? "Open now" : "Return now"}
          </a>
        </p>
      ) : null}
    </div>
  );
}

/** True when the session's success URL is this app's own home page (payment links). */
function returnsToOwnHome(url: string | null | undefined) {
  if (!url || typeof window === "undefined") return false;
  try {
    const u = new URL(url, window.location.href);
    return u.origin === window.location.origin && (u.pathname === "/" || u.pathname === "");
  } catch {
    return false;
  }
}

function ClosedView({ phase }: { phase: Extract<Phase, { name: "closed" }> }) {
  const titles = {
    expired: "This checkout has expired",
    already_paid: "Already paid",
    not_found: "Checkout not found",
    error: "Something went wrong",
  } as const;
  const s = phase.session;
  return (
    <div className="py-2 text-center">
      <h2 className="text-xl font-semibold">{titles[phase.reason]}</h2>
      <p className="mt-2 text-sm text-[var(--color-muted)]">{phase.message}</p>
      <div className="mt-5 flex flex-col gap-2">
        {phase.reason === "already_paid" && s?.paymentId ? (
          <a href={`/r/${s.paymentId}`} className={secondaryBtn}>
            View receipt
          </a>
        ) : null}
        {phase.reason === "error" ? (
          <button type="button" onClick={() => window.location.reload()} className={primaryBtn}>
            Try again
          </button>
        ) : null}
        {s ? (
          <a href={phase.reason === "already_paid" ? s.successUrl : s.cancelUrl} className={phase.reason === "error" ? secondaryBtn : primaryBtn}>
            Back to {s.merchant.name}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function WalletDetails({ wallet, disabled, open }: { wallet: Wallet; disabled?: boolean; open?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!wallet.address) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wallet.address!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      /* clipboard blocked: the address is selectable */
    }
  };
  return (
    <details className="mt-4 text-sm text-[var(--color-muted)]" open={open}>
      <summary className="cursor-pointer select-none font-medium">Paying with <span className="font-semibold text-[var(--color-ink)]">{wallet.label ?? "your wallet"}</span></summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="select-all break-all rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-ink)]" title={wallet.address}>
          {open ? wallet.address : shortAddress(wallet.address)}
        </code>
        <button type="button" onClick={copy} className="text-xs underline-offset-2 hover:underline">
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={() => void wallet.logout()} disabled={disabled} className="text-xs underline-offset-2 hover:underline disabled:opacity-50">
          Use a different wallet
        </button>
      </div>
    </details>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-label="Loading checkout">
      <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--color-ink)]/10" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--color-ink)]/10" />
      <div className="mt-6 h-8 w-1/3 animate-pulse rounded bg-[var(--color-ink)]/10" />
      <div className="mt-6 h-12 w-full animate-pulse rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-ink)]/5" />
    </div>
  );
}

function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none ${small ? "h-4 w-4" : "h-9 w-9 text-[var(--color-ink)]"}`}
      aria-hidden
    />
  );
}

const primaryBtn = buttonCls("primary", "lg");
const secondaryBtn = buttonCls("secondary", "md");
const linkCls = "text-sm font-semibold text-[var(--color-link)] underline decoration-1 underline-offset-2 hover:decoration-[var(--color-link)]";

/** Small QuietPay mark. */
function BrandMark() {
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] bg-[var(--color-brand)] text-[9px] font-semibold text-white" aria-hidden>
      Q
    </span>
  );
}
