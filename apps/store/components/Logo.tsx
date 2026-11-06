/* eslint-disable @next/next/no-img-element */
import Link from "next/link";

/**
 * Swag Counter lockup: the official ETHGlobal logo, then the store's own name.
 * Swag Counter is a demo merchant built at ETHGlobal Mumbai, not an official ETHGlobal store
 * (the footer says so).
 */
export function Logo() {
  return (
    <Link
      href="/"
      aria-label="Swag Counter home"
      className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-primary)]"
    >
      <img src="/brand/ethglobal.svg" alt="ETHGlobal" width={125} height={24} style={{ height: 40, width: "auto", margin: "-8px -6px" }} />
      <span className="h-6 w-px bg-[var(--color-heading)]/15" aria-hidden />
      <span className="flex flex-col leading-none">
        <span className="text-lg font-bold tracking-tight text-[var(--color-heading)]">Swag Counter</span>
        <span className="mt-1 text-[11px] font-medium text-[var(--color-muted)]">Mumbai</span>
      </span>
    </Link>
  );
}
