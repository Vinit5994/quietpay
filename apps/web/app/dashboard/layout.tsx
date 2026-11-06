import Link from "next/link";

const nav = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/payments", label: "Payments" },
  { href: "/dashboard/subscriptions", label: "Subscriptions" },
  { href: "/dashboard/plans", label: "Plans" },
  { href: "/dashboard/links", label: "Payment links" },
  { href: "/dashboard/developers", label: "Developers" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh md:flex">
      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--color-line)] px-4 py-3 md:w-56 md:flex-col md:border-b-0 md:border-r">
        {nav.map((item) => (
          <Link key={item.href} href={item.href} className="whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-[var(--color-line)]">
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
