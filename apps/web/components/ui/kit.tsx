"use client";

import { useEffect, useId, useRef, useState } from "react";
import { explorerTx } from "@quietpay/shared";

/* Small UI kit for the QuietPay web app. Tokens live in app/globals.css. */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md" };

export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60";
  const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2.5" };
  const variants = {
    primary: "bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:opacity-90",
    secondary: "border border-[var(--color-line)] bg-[var(--color-surface)] hover:bg-[var(--color-bg)]",
    danger: "border border-[var(--color-bad)]/40 bg-[var(--color-surface)] text-[var(--color-bad)] hover:bg-[var(--color-bad)]/10",
    ghost: "text-[var(--color-muted)] hover:text-[var(--color-ink)]",
  };
  return <button type="button" className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props} />;
}

export function Panel({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] ${className}`}>
      {title || action ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-3.5">
          {title ? <h2 className="font-semibold">{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-prose text-sm text-[var(--color-muted)]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

const chipStyles: Record<string, { cls: string; label: string }> = {
  paid: { cls: "bg-[var(--color-good)]/12 text-[var(--color-good)]", label: "Paid" },
  partially_refunded: { cls: "bg-[var(--color-warn)]/12 text-[var(--color-warn)]", label: "Partially refunded" },
  refunded: { cls: "bg-[var(--color-muted)]/15 text-[var(--color-muted)]", label: "Refunded" },
  active: { cls: "bg-[var(--color-good)]/12 text-[var(--color-good)]", label: "Active" },
  past_due: { cls: "bg-[var(--color-warn)]/12 text-[var(--color-warn)]", label: "Past due" },
  canceled: { cls: "bg-[var(--color-muted)]/15 text-[var(--color-muted)]", label: "Canceled" },
  succeeded: { cls: "bg-[var(--color-good)]/12 text-[var(--color-good)]", label: "Delivered" },
  pending: { cls: "bg-[var(--color-warn)]/12 text-[var(--color-warn)]", label: "Retrying" },
  failed: { cls: "bg-[var(--color-bad)]/12 text-[var(--color-bad)]", label: "Failed" },
  inactive: { cls: "bg-[var(--color-muted)]/15 text-[var(--color-muted)]", label: "Off" },
};

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const s = chipStyles[status] ?? { cls: "bg-[var(--color-muted)]/15 text-[var(--color-muted)]", label: status };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label ?? s.label}
    </span>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "warn" }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">{label}</p>
      <p className={`tabular mt-1.5 truncate text-2xl font-semibold ${tone === "warn" ? "text-[var(--color-warn)]" : ""}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--color-muted)]">{hint}</p> : null}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "good"; children: React.ReactNode }) {
  const tones = {
    info: "border-[var(--color-line)] bg-[var(--color-bg)]",
    warn: "border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10",
    bad: "border-[var(--color-bad)]/40 bg-[var(--color-bad)]/10",
    good: "border-[var(--color-good)]/40 bg-[var(--color-good)]/10",
  };
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function TxLink({ hash, label = "View tx" }: { hash: string | null | undefined; label?: string }) {
  if (!hash) return <span className="text-[var(--color-muted)]">—</span>;
  return (
    <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="whitespace-nowrap text-[var(--color-accent)] underline-offset-2 hover:underline">
      {label} ↗
    </a>
  );
}

export function CopyField({ value, label, secret }: { value: string; label?: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!secret);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the value is selectable */
    }
  };
  return (
    <div className="min-w-0">
      {label ? <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">{label}</p> : null}
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 select-all truncate rounded-md border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-1.5 font-mono text-xs">
          {shown ? value : "•".repeat(Math.min(32, value.length))}
        </code>
        {secret ? (
          <Button size="sm" variant="secondary" onClick={() => setShown((s) => !s)}>
            {shown ? "Hide" : "Show"}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="w-full max-w-md rounded-2xl bg-[var(--color-surface)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]">
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-xs text-[var(--color-muted)]">{hint}</span> : null}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25";

export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: string | false }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
            {head.map((h, i) => (
              <th key={h || i} className={`px-5 py-2.5 font-medium ${h.startsWith(">") ? "text-right" : ""}`}>
                {h.replace(/^>/, "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)]">
          {empty ? (
            <tr>
              <td colSpan={head.length} className="px-5 py-10 text-center text-[var(--color-muted)]">
                {empty}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-[var(--color-line)]" style={{ width: `${85 - i * 12}%` }} />
      ))}
    </div>
  );
}
