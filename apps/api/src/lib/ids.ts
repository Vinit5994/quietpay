import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Unguessable prefixed id, e.g. newId("sess") → "sess_4fQ…" (24 base62 chars ≈ 142 bits). */
export function newId(prefix: string, length = 24): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 62];
  return `${prefix}_${out}`;
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const isoFromSeconds = (s: number) => new Date(s * 1000).toISOString();
