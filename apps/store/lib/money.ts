/**
 * Prices are decimal strings in USDT ("25.00"), like the QuietPay API. The store does its own
 * arithmetic in integer cents (a real merchant wouldn't import QuietPay's internals).
 */
export function toCents(amount: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) throw new Error(`Invalid price "${amount}"`);
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export function fromCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** "1234.5" → "1,234.50 USDT" */
export function formatUsdt(amount: string): string {
  const [whole, frac] = fromCents(toCents(amount)).split(".") as [string, string];
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac} USDT`;
}

export function lineTotal(unitPrice: string, qty: number): string {
  return fromCents(toCents(unitPrice) * qty);
}

export function sumAmounts(amounts: string[]): string {
  return fromCents(amounts.reduce((acc, a) => acc + toCents(a), 0));
}
