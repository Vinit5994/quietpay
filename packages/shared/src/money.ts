import { USDT_DECIMALS } from "./chain";

const SCALE = 10n ** BigInt(USDT_DECIMALS);
const INPUT_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parse an API amount ("25.00", "25", "0.5") into USDT base units (6 decimals).
 * Rejects negatives, more than 2 decimals and anything that isn't a plain decimal.
 */
export function toUnits(amount: string): bigint {
  const m = INPUT_RE.exec(amount.trim());
  if (!m) throw new Error(`Invalid USDT amount "${amount}": use a decimal with at most 2 decimals, e.g. "25.00"`);
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? "").padEnd(USDT_DECIMALS, "0"));
  return whole * SCALE + frac;
}

/**
 * Base units → decimal string with at least 2 decimals ("25.00").
 * Sub-cent values (fees) keep their precision: 5000n → "0.005".
 */
export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / SCALE;
  let frac = (abs % SCALE).toString().padStart(USDT_DECIMALS, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** "25.00 USDT". Accepts base units or an API decimal string. */
export function formatUsdt(amount: bigint | string): string {
  const units = typeof amount === "bigint" ? amount : toUnitsLoose(amount);
  return `${fromUnits(units)} USDT`;
}

/** Like toUnits but accepts up to 6 decimals (for amounts coming back from the API, e.g. fees). */
export function toUnitsLoose(amount: string): bigint {
  const m = /^(-)?(\d+)(?:\.(\d{1,6}))?$/.exec(amount.trim());
  if (!m) throw new Error(`Invalid USDT amount "${amount}"`);
  const units = BigInt(m[2]!) * SCALE + BigInt((m[3] ?? "").padEnd(USDT_DECIMALS, "0"));
  return m[1] ? -units : units;
}
