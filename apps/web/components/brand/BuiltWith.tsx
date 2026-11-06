/* eslint-disable @next/next/no-img-element */

/**
 * "Built on Whitechain at ETHGlobal Mumbai". Both official logos are drawn for light backgrounds
 * (navy wordmarks, coloured marks), so they always sit on a white chip in their real colours.
 */
export function BuiltWith({ tone = "light", compact = false }: { tone?: "light" | "dark"; compact?: boolean }) {
  const h = compact ? 16 : 20;
  const chip =
    tone === "dark"
      ? "bg-white shadow-[0_8px_24px_-12px_rgb(0_0_0/0.45)]"
      : "border border-[var(--color-line)] bg-white shadow-[var(--shadow-card)]";
  return (
    <div className={`inline-flex w-fit self-start flex-wrap items-center rounded-xl ${chip} ${compact ? "gap-3 px-3 py-2" : "gap-4 px-4 py-2.5"}`}>
      <a href="https://whitechain.io" target="_blank" rel="noreferrer" className="flex items-center gap-2" aria-label="Built on Whitechain">
        <span className={`text-[var(--color-muted)] ${compact ? "text-[11px]" : "text-xs"}`}>Built on</span>
        <img src="/brand/whitechain.svg" alt="Whitechain" width={Math.round((h * 833) / 152)} height={h} style={{ height: h, width: "auto" }} />
      </a>
      <span className="h-5 w-px bg-[var(--color-line)]" aria-hidden />
      <a href="https://ethglobal.com/events/mumbai" target="_blank" rel="noreferrer" className="flex items-center gap-1.5" aria-label="At ETHGlobal Mumbai">
        <img
          src="/brand/ethglobal.svg"
          alt="ETHGlobal"
          width={Math.round((h * 1.9 * 359) / 69)}
          height={Math.round(h * 1.9)}
          style={{ height: h * 1.9, width: "auto", margin: `${-h * 0.45}px ${-h * 0.35}px` }}
        />
        <span className={`font-medium text-[#1c2952] ${compact ? "text-xs" : "text-sm"}`}>Mumbai</span>
      </a>
    </div>
  );
}
