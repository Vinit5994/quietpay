import Link from "next/link";
import { CartButton } from "./CartButton";
import { Logo } from "./Logo";

const links = [
  { href: "/#products", label: "Shop" },
  { href: "/box", label: "Builder Box", badge: "New" },
  { href: "/counter", label: "Counter" },
  { href: "/staff", label: "Staff" },
];

export function Header() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
      <Logo />
      <nav className="hidden items-center gap-8 text-[15px] font-medium text-[var(--color-heading)] md:flex" aria-label="Main">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="relative rounded hover:text-[var(--color-violet)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-primary)]">
            {l.label}
            {l.badge ? <sup className="ml-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">{l.badge}</sup> : null}
          </Link>
        ))}
      </nav>
      <CartButton />
    </header>
  );
}

export function MobileNav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl gap-5 overflow-x-auto px-4 pb-2 text-sm font-medium text-[var(--color-heading)] md:hidden" aria-label="Main">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="whitespace-nowrap">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
