import type { Chain } from "./chain";
import type { Db } from "./db/client";
import type { merchants } from "./db/schema";
import type { Env } from "./env";

export type Deps = { db: Db; chain: Chain; env: Env };

export type MerchantRow = typeof merchants.$inferSelect;

export type JwtClaims = {
  sub: `0x${string}`;
  role: "merchant" | "customer";
  /** merchant id, or null before onboarding */
  mid: string | null;
  exp: number;
};

/** Hono context variables set by the auth middleware. */
export type AppEnv = { Variables: { merchant: MerchantRow; jwt: JwtClaims } };
