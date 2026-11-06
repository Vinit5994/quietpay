import Link from "next/link";

/** Swag Counter mark: a sparkle on a rounded "counter" tile. */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-primary)]">
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
        <defs>
          <linearGradient id="sc-tile" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f6b98f" />
            <stop offset="1" stopColor="#6d5dfc" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="32" height="32" rx="9" fill="url(#sc-tile)" />
        <path d="M17 7c.9 5 4 8.1 9 9-5 .9-8.1 4-9 9-.9-5-4-8.1-9-9 5-.9 8.1-4 9-9Z" fill="#fff" />
      </svg>
      <span className="text-lg font-bold tracking-tight text-[var(--color-heading)]">Swag Counter</span>
    </Link>
  );
}
