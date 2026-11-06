const tiles = [
  {
    title: "Pay in USDT",
    sub: "No gas fees",
    icon: <path d="M12 3v18M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 3 5 3 5 1.1 5 3-2.2 3-5 3-5-1.1-5-3" />,
  },
  {
    title: "Ships worldwide",
    sub: "Free pickup at the counter",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
      </>
    ),
  },
];

export function InfoTiles() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:max-w-md">
      {tiles.map((t) => (
        <div key={t.title} className="flex flex-col items-center gap-1 rounded-xl border border-[var(--color-line)] bg-[#f8f9fb] px-4 py-5 text-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
            {t.icon}
          </svg>
          <p className="mt-1 font-semibold text-[var(--color-heading)]">{t.title}</p>
          <p className="text-sm text-[var(--color-muted)]">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}
