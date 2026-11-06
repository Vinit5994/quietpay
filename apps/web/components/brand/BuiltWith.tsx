/* eslint-disable @next/next/no-img-element */

/**
 * "Built on Whitechain at ETHGlobal Mumbai" badges, using the official logos in public/brand/.
 * `tone="dark"` renders the logos in white for dark backgrounds.
 */
export function BuiltWith({ tone = "light", compact = false }: { tone?: "light" | "dark"; compact?: boolean }) {
  const filter = tone === "dark" ? "brightness(0) invert(1)" : undefined;
  const label = tone === "dark" ? "text-white/60" : "text-[var(--color-muted)]";
  const h = compact ? 14 : 18;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${compact ? "text-xs" : "text-sm"}`}>
      <span className={label}>Built on</span>
      <a href="https://whitechain.io" target="_blank" rel="noreferrer" className="inline-flex items-center opacity-90 hover:opacity-100">
        <img src="/brand/whitechain.svg" alt="Whitechain" width={Math.round((h * 833) / 152)} height={h} style={{ height: h, width: "auto", filter }} />
      </a>
      <span className={label}>at</span>
      <a href="https://ethglobal.com/events/mumbai" target="_blank" rel="noreferrer" className="inline-flex items-center opacity-90 hover:opacity-100">
        <img src="/brand/ethglobal.svg" alt="ETHGlobal" width={Math.round((h * 2 * 359) / 69)} height={h * 2} style={{ height: h * 2, width: "auto", margin: `${-h / 2}px -${h / 3}px`, filter }} />
      </a>
      <span className={label}>Mumbai</span>
    </div>
  );
}
