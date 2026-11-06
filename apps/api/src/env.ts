import { z } from "zod";
import { QUIETPAY_ADDRESS, WHITECHAIN_SEPOLIA_RPC_URL } from "@quietpay/shared";

const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "0x + 64 hex chars");
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(4000),
  DATABASE_PATH: z.string().default("./quietpay.db"),
  WHITECHAIN_SEPOLIA_RPC_URL: z.preprocess(emptyToUndefined, z.url().default(WHITECHAIN_SEPOLIA_RPC_URL)),
  QUIETPAY_ADDRESS: z.preprocess(
    emptyToUndefined,
    z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  ),
  RELAYER_PK: Hex32,
  /** 32-byte hex (64 chars, with or without 0x); encrypts merchant signer keys at rest */
  ENCRYPTION_KEY: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/, "32-byte hex"),
  JWT_SECRET: z.string().min(16),
  PUBLIC_WEB_URL: z.preprocess(emptyToUndefined, z.url().default("http://localhost:3001")),
  DEMO_PERIOD_OVERRIDE: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  DEMO_MODE: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).default("false")),
  DEMO_TREASURY_PK: z.preprocess(emptyToUndefined, Hex32.optional()),
});

export type Env = z.infer<typeof EnvSchema> & { QUIETPAY: `0x${string}` };

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment (see apps/api/.env.example):\n${lines}`);
  }
  const quietPay = parsed.data.QUIETPAY_ADDRESS ?? QUIETPAY_ADDRESS;
  if (!quietPay) throw new Error("QuietPay address unknown: set QUIETPAY_ADDRESS or run `pnpm abi:export`");
  return { ...parsed.data, QUIETPAY: quietPay as `0x${string}` };
}
