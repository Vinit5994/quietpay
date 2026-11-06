import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

/** Merchant secret key: shown once, stored only as a SHA-256 hash. */
export function newSecretKey(): { key: string; hash: string; prefix: string } {
  const key = `sk_test_${randomBytes(24).toString("hex")}`;
  return { key, hash: sha256Hex(key), prefix: key.slice(0, 12) };
}

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString("hex")}`;

function keyBytes(encryptionKey: string): Buffer {
  return Buffer.from(encryptionKey.replace(/^0x/, ""), "hex");
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encrypt(plaintext: string, encryptionKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(encryptionKey), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(payload: string, encryptionKey: string): string {
  const raw = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(encryptionKey), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
