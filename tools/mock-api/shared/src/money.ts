/**
 * USDT amounts. API input: decimal strings with at most 2 decimals ("25.00").
 * Internally and on-chain: bigint base units with 6 decimals. Never use JS numbers for money.
 */

const UNIT = 1_000_000n;
const API_AMOUNT = /^(\d+)(?:\.(\d{1,2}))?$/;
const ANY_AMOUNT = /^(\d+)(?:\.(\d{1,6}))?$/;

function parse(amount: string, re: RegExp, label: string): bigint {
  const match = re.exec(amount.trim());
  if (!match) throw new Error(`Invalid USDT amount ${JSON.stringify(amount)}: ${label}`);
  const whole = BigInt(match[1]!);
  const frac = BigInt((match[2] ?? "").padEnd(6, "0"));
  return whole * UNIT + frac;
}

/** "25.00" → 25000000n. Rejects more than 2 decimals (API input rule). */
export function toUnits(amount: string): bigint {
  return parse(amount, API_AMOUNT, "use a number with at most 2 decimals");
}

/** Like toUnits but accepts up to 6 decimals (for display of on-chain values). */
export function toUnitsLoose(amount: string): bigint {
  return parse(amount, ANY_AMOUNT, "use a number with at most 6 decimals");
}

/** 25000000n → "25.00". Keeps extra decimals only when they are non-zero ("0.000001"). */
export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / UNIT;
  let frac = (abs % UNIT).toString().padStart(6, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** "1234.5" or 1234500000n → "1,234.50 USDT". */
export function formatUsdt(amount: string | bigint, { withSymbol = true } = {}): string {
  const units = typeof amount === "bigint" ? amount : toUnitsLoose(amount);
  const [whole, frac] = fromUnits(units).split(".") as [string, string];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${frac}${withSymbol ? " USDT" : ""}`;
}

export function sumAmounts(amounts: string[]): string {
  return fromUnits(amounts.reduce((acc, a) => acc + toUnitsLoose(a), 0n));
}

export function multiplyAmount(amount: string, quantity: number): string {
  return fromUnits(toUnitsLoose(amount) * BigInt(quantity));
}
