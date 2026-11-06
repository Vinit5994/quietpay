"use client";

import { useEffect, useId, useRef, useState } from "react";
import { explorerTx } from "@quietpay/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";

/* Small UI kit for the QuietPay web app. Tokens live in app/globals.css. */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md" | "lg" };

export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  return <button type="button" className={`${buttonCls(variant, size)} ${className}`} {...props} />;
}

export function Panel({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] ${className}`}>
      {title || action ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-3.5">
          {title ? <h2 className="text-base font-semibold">{title}</h2> : <span />}
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
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1.5 max-w-prose text-sm text-[var(--color-muted)]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

const good = "bg-[var(--color-good-soft)] text-[var(--color-good)]";
const warn = "bg-[var(--color-warn-soft)] text-[var(--color-warn)]";
const bad = "bg-[var(--color-bad-soft)] text-[var(--color-bad)]";
const neutral = "bg-[var(--color-neutral-soft)] text-[var(--color-muted)]";
const chipStyles: Record<string, { cls: string; label: string }> = {
  paid: { cls: good, label: "Paid" },
  partially_refunded: { cls: warn, label: "Partially refunded" },
  refunded: { cls: neutral, label: "Refunded" },
  active: { cls: good, label: "Active" },
  past_due: { cls: warn, label: "Past due" },
  canceled: { cls: neutral, label: "Canceled" },
  succeeded: { cls: good, label: "Delivered" },
  pending: { cls: warn, label: "Retrying" },
  failed: { cls: bad, label: "Failed" },
  inactive: { cls: neutral, label: "Off" },
};

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const s = chipStyles[status] ?? { cls: neutral, label: status };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label ?? s.label}
    </span>
  );
}

export function Stat({ label, value, hint, tone, icon: Icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "warn"; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="min-w-0 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-[var(--color-muted)]">{label}</p>
        {Icon ? (
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tone === "warn" ? "bg-[var(--color-warn-soft)] text-[var(--color-warn)]" : "bg-[var(--color-brand-soft)] text-[var(--color-pine)]"}`} aria-hidden>
            <Icon className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </div>
      <p className={`tabular mt-1 break-words font-semibold leading-tight tracking-tight ${tone === "warn" ? "text-[var(--color-warn)]" : ""} ${valueSize(value)}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--color-muted)]">{hint}</p> : null}
    </div>
  );
}

/** Long amounts ("324,000.00 USDT") step down a size instead of being cut off. */
function valueSize(value: React.ReactNode) {
  const len = typeof value === "string" ? value.length : 0;
  return len > 16 ? "text-lg" : len > 12 ? "text-xl" : "text-2xl";
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "good"; children: React.ReactNode }) {
  const tones = {
    info: "border-[var(--color-line)] bg-[var(--color-info-soft)]",
    warn: "border-[#f3dfb8] bg-[var(--color-warn-soft)] text-[#6b4000]",
    bad: "border-[#f5c9c6] bg-[var(--color-bad-soft)] text-[#8f211d]",
    good: "border-[#cbe8da] bg-[var(--color-good-soft)] text-[#09593e]",
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
    <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="whitespace-nowrap font-semibold text-[var(--color-link)] underline decoration-1 underline-offset-2 hover:decoration-[var(--color-link)]">
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
      {label ? <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{label}</p> : null}
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 select-all truncate rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 py-1.5 font-mono text-xs">
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
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="w-full max-w-md rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-pop)]">
        <div className="flex items-start justify-between gap-4">
          <h2 id={id} className="text-xl font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-surface)] text-sm font-semibold">
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
      <span className="text-sm font-semibold">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-xs text-[var(--color-muted)]">{hint}</span> : null}
    </label>
  );
}

export const inputCls =
  "w-full rounded-[var(--radius-base)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 font-medium outline-none transition-shadow placeholder:text-[var(--color-muted)]/70 focus:shadow-[var(--shadow-card)]";

/** Shared button look, also used by links styled as buttons. */
export function buttonCls(variant: "primary" | "secondary" | "danger" | "ghost" = "primary", size: "sm" | "md" | "lg" = "md") {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg text-center font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-link)] disabled:cursor-not-allowed disabled:opacity-60";
  const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-base" };
  const variants = {
    primary: "bg-[var(--color-accent)] text-[var(--color-accent-ink)] shadow-[var(--shadow-card)] hover:bg-[var(--color-accent-hover)]",
    secondary: "border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-card)] hover:bg-[var(--color-bg)]",
    danger: "border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-bad)] shadow-[var(--shadow-card)] hover:bg-[var(--color-bad-soft)]",
    ghost: "text-[var(--color-muted)] underline-offset-4 hover:text-[var(--color-ink)] hover:underline",
  };
  return `${base} ${sizes[size]} ${variants[variant]}`;
}

export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: string | false }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-muted)]">
            {head.map((h, i) => (
              <th key={h || i} className={`px-5 py-2.5 font-medium ${h.startsWith(">") ? "text-right" : ""}`}>
                {h.replace(/^>/, "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-line)] [&>tr:hover]:bg-[var(--color-bg)]">
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
        <div key={i} className="h-4 animate-pulse rounded bg-[var(--color-ink)]/10" style={{ width: `${85 - i * 12}%` }} />
      ))}
    </div>
  );
}

/** Previous / next controls for cursor-paginated lists. Hidden when everything fits on one page. */
export function Pager({ page, hasNext, onPrev, onNext, loading }: { page: number; hasNext: boolean; onPrev: () => void; onNext: () => void; loading?: boolean }) {
  if (page === 1 && !hasNext) return null;
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] px-5 py-3 text-sm" aria-label="Pagination">
      <span className="text-[var(--color-muted)]" aria-live="polite">
        Page {page}
        {loading ? "…" : ""}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onPrev} disabled={page === 1 || loading}>
          <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
        </Button>
        <Button variant="secondary" size="sm" onClick={onNext} disabled={!hasNext || loading}>
          Next <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
