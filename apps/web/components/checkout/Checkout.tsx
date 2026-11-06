"use client";

import { useEffect, useState } from "react";
import { explorerTx, formatUsdt, multiplyAmount, type PublicSession } from "@quietpay/shared";
import { env } from "@/lib/env";
import { shortAddress } from "@/lib/format";
import type { Phase } from "@/lib/checkout/machine";
import { useCheckout } from "@/lib/checkout/useCheckout";
import type { Wallet } from "@/lib/wallet";

const SUBSCRIPTION_PERIODS_IN_CAP = 12;

export function Checkout({ sessionId }: { sessionId: string }) {
  const { phase, wallet, pay } = useCheckout(sessionId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6 sm:py-12">
      <Header
        session={phase.name === "loading" ? null : phase.session}
        loading={phase.name === "loading"}
        cancellable={phase.name === "review" || phase.name === "insufficient" || (phase.name === "pay" && phase.busy === null)}
      />
      <section className="mt-6 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-sm" aria-live="polite">
        <Body phase={phase} wallet={wallet} pay={pay} />
      </section>
      <p className="mt-6 text-center text-xs text-[var(--color-muted)]">Secure checkout by QuietPay · paid in USDT</p>
    </main>
  );
}

function Header({ session, loading, cancellable }: { session: PublicSession | null; loading: boolean; cancellable: boolean }) {
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Pay</p>
        <h1 className="truncate text-xl font-semibold">
          {session ? session.merchant.name : loading ? <span className="inline-block h-6 w-32 animate-pulse rounded bg-[var(--color-line)]" /> : "QuietPay"}
        </h1>
      </div>
      {session && cancellable ? (
        <a href={session.cancelUrl} className="shrink-0 text-sm text-[var(--color-muted)] underline-offset-2 hover:underline">
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
    const cap = multiplyAmount(plan.amount, SUBSCRIPTION_PERIODS_IN_CAP);
    return (
      <div>
        <p className="text-sm text-[var(--color-muted)]">Subscription</p>
        <p className="mt-0.5 text-lg font-semibold">{plan.name}</p>
        <p className="tabular mt-3 text-3xl font-semibold">
          {formatUsdt(plan.amount)} <span className="text-base font-normal text-[var(--color-muted)]">{plan.intervalLabel}</span>
        </p>
        <ul className="mt-4 space-y-1.5 text-sm">
          <li>First charge today, then {plan.intervalLabel}.</li>
          <li>Cancel anytime.</li>
        </ul>
        <p className="mt-4 rounded-lg bg-[var(--color-bg)] p-3 text-sm text-[var(--color-muted)]">
          You allow {session.merchant.name} to charge up to <span className="tabular font-medium text-[var(--color-ink)]">{formatUsdt(cap)}</span> over{" "}
          {SUBSCRIPTION_PERIODS_IN_CAP} periods. You're only charged {formatUsdt(plan.amount)} each period.
        </p>
      </div>
    );
  }
  return (
    <div>
      <ul className="divide-y divide-[var(--color-line)]">
        {session.lineItems.map((item, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <span className="min-w-0">
              {item.name}
              {item.quantity > 1 ? <span className="text-[var(--color-muted)]"> × {item.quantity}</span> : null}
            </span>
            <span className="tabular shrink-0">{formatUsdt(item.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-baseline justify-between border-t border-[var(--color-line)] pt-3">
        <span className="font-medium">Total</span>
        <span className="tabular text-2xl font-semibold">{formatUsdt(session.amount)}</span>
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
        <p role="alert" className="mt-4 rounded-lg border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 p-3 text-sm">
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
      <h2 className="text-lg font-semibold">Not enough USDT</h2>
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
  const redirect = status.redirectUrl;
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
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-good)]/15 text-[var(--color-good)]" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <h2 className="mt-4 text-xl font-semibold">{session.mode === "subscription" ? "You're subscribed" : "Payment complete"}</h2>
      <p className="tabular mt-1 text-[var(--color-muted)]">
        {formatUsdt(amount)} to {session.merchant.name}
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {status.receiptUrl ? (
          <a href={status.receiptUrl} className={secondaryBtn}>
            View receipt
          </a>
        ) : null}
        {status.txHash ? (
          <a href={explorerTx(status.txHash)} target="_blank" rel="noreferrer" className="text-sm text-[var(--color-accent)] underline-offset-2 hover:underline">
            View transaction
          </a>
        ) : null}
      </div>
      {redirect ? (
        <p className="mt-5 text-sm text-[var(--color-muted)]">
          Returning to {session.merchant.name} in {Math.max(seconds, 0)}…{" "}
          <a href={redirect} className="text-[var(--color-accent)] underline-offset-2 hover:underline">
            Return now
          </a>
        </p>
      ) : null}
    </div>
  );
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
      <h2 className="text-lg font-semibold">{titles[phase.reason]}</h2>
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
      <summary className="cursor-pointer select-none">Paying with {wallet.label ?? "your wallet"}</summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="select-all break-all rounded bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-ink)]" title={wallet.address}>
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
      <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--color-line)]" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--color-line)]" />
      <div className="mt-6 h-8 w-1/3 animate-pulse rounded bg-[var(--color-line)]" />
      <div className="mt-6 h-11 w-full animate-pulse rounded-lg bg-[var(--color-line)]" />
    </div>
  );
}

function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none ${small ? "h-4 w-4" : "h-8 w-8 text-[var(--color-accent)]"}`}
      aria-hidden
    />
  );
}

const primaryBtn =
  "inline-flex items-center justify-center rounded-lg bg-[var(--color-accent)] px-4 py-3 text-center font-medium text-[var(--color-accent-ink)] transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-70";
const secondaryBtn =
  "inline-flex items-center justify-center rounded-lg border border-[var(--color-line)] px-4 py-3 text-center font-medium transition hover:bg-[var(--color-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]";
