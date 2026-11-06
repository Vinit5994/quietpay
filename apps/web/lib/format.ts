export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function secondsUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
}

/** 120 → "every 2 minutes (demo)", 2592000 → "every 30 days". */
export function intervalLabel(periodSeconds: number): string {
  if (periodSeconds === 2_592_000) return "every month";
  if (periodSeconds === 604_800) return "every week";
  const units: [number, string][] = [[86_400, "day"], [3_600, "hour"], [60, "minute"], [1, "second"]];
  for (const [secs, name] of units) {
    if (periodSeconds % secs === 0) {
      const n = periodSeconds / secs;
      return `every ${n === 1 ? name : `${n} ${name}s`}${periodSeconds < 3_600 ? " (demo)" : ""}`;
    }
  }
  return `every ${periodSeconds} seconds`;
}

/** "1234.5" → "1,234.50 USDT" (grouped, 2+ decimals). */
export function usdt(amount: string, { symbol = true } = {}): string {
  const negative = amount.startsWith("-");
  const [whole = "0", frac = ""] = amount.replace("-", "").split(".");
  const f = frac.length >= 2 ? frac.replace(/(\d{2}\d*?)0+$/, "$1") : frac.padEnd(2, "0");
  return `${negative ? "−" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${f}${symbol ? " USDT" : ""}`;
}

/** "3 min ago", "2 h ago", "Nov 6, 14:02" */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3_600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3_600)} h ago`;
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
