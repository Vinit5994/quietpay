/** Four-point sparkle with a navy outline (our own drawing). */
export function Sparkle({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden>
      <path
        d="M20 2c1.6 9.2 8.8 16.4 18 18-9.2 1.6-16.4 8.8-18 18-1.6-9.2-8.8-16.4-18-18C11.2 18.4 18.4 11.2 20 2Z"
        fill="var(--color-star)"
        stroke="var(--color-navy)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Dot({ size = 10, ring = false, className = "" }: { size?: number; ring?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block rounded-full ${ring ? "border-[3px] border-[var(--color-navy)]" : "bg-[var(--color-navy)]"} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
