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
