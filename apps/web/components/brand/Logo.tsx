/**
 * QuietPay logo. The mark is a "Q" whose tail settles into a flat line: payments that stay quiet
 * (no gas, no seed phrases, no noise for the customer).
 */
export function LogoMark({ size = 28, tone = "light", className = "" }: { size?: number; tone?: "light" | "dark"; className?: string }) {
  const tile = tone === "light" ? "#0b3b2e" : "#ffffff";
  const bowl = tone === "light" ? "#ffffff" : "#0b3b2e";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <rect width="32" height="32" rx="9" fill={tile} />
      <circle cx="14.5" cy="14.5" r="7" stroke={bowl} strokeWidth="2.6" />
      <path d="M18.6 18.6 L21.6 21.8 H27" stroke="#26a17b" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ size = 28, tone = "light", className = "" }: { size?: number; tone?: "light" | "dark"; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} tone={tone} />
      <span
        translate="no"
        className={`font-[family-name:var(--font-display)] font-semibold tracking-tight ${tone === "light" ? "text-[var(--color-ink)]" : "text-white"}`}
        style={{ fontSize: Math.round(size * 0.68) }}
      >
        QuietPay
      </span>
    </span>
  );
}
