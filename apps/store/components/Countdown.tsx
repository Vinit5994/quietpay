"use client";

import { useEffect, useState } from "react";

/** "1:42" until `to`; then the fallback (e.g. "any moment now"). */
export function Countdown({ to, fallback = "any moment now" }: { to: string; fallback?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((new Date(to).getTime() - now) / 1000));
  if (s === 0) return <span>{fallback}</span>;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (
    <span className="tabular">
      {h > 0 ? `${h}:${String(m).padStart(2, "0")}` : m}:{String(sec).padStart(2, "0")}
    </span>
  );
}
