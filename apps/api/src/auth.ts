import { randomBytes } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { sign, verify } from "hono/jwt";
import { and, eq } from "drizzle-orm";
import { getAddress, type Hex } from "viem";
import { authNonces, merchants } from "./db/schema";
import type { AppEnv, Deps, JwtClaims } from "./deps";
import { ApiError, unauthorized } from "./lib/errors";
import { sha256Hex } from "./lib/crypto";
import { isoFromSeconds, nowSeconds } from "./lib/ids";
import { readBody, readQuery, send } from "./lib/validate";

const NONCE_TTL = 5 * 60;
const JWT_TTL = 24 * 60 * 60;

export const signInMessage = (nonce: string) => `Sign in to QuietPay\nNonce: ${nonce}`;

function bearer(header: string | undefined): string {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!m) throw unauthorized("Send `Authorization: Bearer <secret key or token>`.");
  return m[1]!.trim();
}

async function readJwt(token: string, secret: string): Promise<JwtClaims> {
  try {
    return (await verify(token, secret, "HS256")) as unknown as JwtClaims;
  } catch {
    throw unauthorized("Session token is invalid or expired. Sign in again.");
  }
}

export async function issueJwt(deps: Deps, claims: Omit<JwtClaims, "exp">) {
  const exp = nowSeconds() + JWT_TTL;
  const token = await sign({ ...claims, exp }, deps.env.JWT_SECRET, "HS256");
  return { token, exp };
}

/** `/v1`: merchant secret key (SDK) or merchant dashboard JWT. Sets `merchant`. */
export const requireMerchantKey =
  (deps: Deps): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const token = bearer(c.req.header("authorization"));
    const merchant = token.startsWith("sk_")
      ? deps.db.select().from(merchants).where(eq(merchants.secretKeyHash, sha256Hex(token))).get()
      : await (async () => {
          const claims = await readJwt(token, deps.env.JWT_SECRET);
          if (claims.role !== "merchant" || !claims.mid) throw unauthorized("Sign in as a merchant first.");
          return deps.db.select().from(merchants).where(eq(merchants.id, claims.mid)).get();
        })();
    if (!merchant) throw unauthorized("Unknown secret key.");
    c.set("merchant", merchant);
    await next();
  };

/** `/dash` (role merchant) and `/public/portal` (role customer). Sets `jwt`. */
export const requireJwt =
  (deps: Deps, role: JwtClaims["role"]): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const claims = await readJwt(bearer(c.req.header("authorization")), deps.env.JWT_SECRET);
    if (claims.role !== role) throw new ApiError(403, "forbidden", `This needs a ${role} sign-in.`);
    c.set("jwt", claims);
    await next();
  };

export function authRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.get("/nonce", (c) => {
    const { address } = readQuery(c, "authNonce");
    const nonce = randomBytes(16).toString("hex");
    const expiresAt = nowSeconds() + NONCE_TTL;
    const key = address.toLowerCase();
    deps.db
      .insert(authNonces)
      .values({ address: key, nonce, expiresAt })
      .onConflictDoUpdate({ target: authNonces.address, set: { nonce, expiresAt } })
      .run();
    return send(c, "authNonce", { nonce, message: signInMessage(nonce), expiresAt: isoFromSeconds(expiresAt) });
  });

  app.post("/verify", async (c) => {
    const { address, signature, role } = await readBody(c, "authVerify");
    const key = address.toLowerCase();
    const row = deps.db.select().from(authNonces).where(eq(authNonces.address, key)).get();
    if (!row || row.expiresAt < nowSeconds()) throw unauthorized("Sign-in request expired. Request a new nonce.");

    const ok = await deps.chain.verifyMessage({
      address: getAddress(address),
      message: signInMessage(row.nonce),
      signature: signature as Hex,
    });
    if (!ok) throw new ApiError(401, "invalid_signature", "Signature does not match this wallet.");
    deps.db.delete(authNonces).where(and(eq(authNonces.address, key), eq(authNonces.nonce, row.nonce))).run();

    const merchant =
      role === "merchant"
        ? deps.db.select().from(merchants).where(eq(merchants.payoutAddressLc, key)).get()
        : undefined;
    const sub = getAddress(address);
    const mid = merchant?.id ?? null;
    const { token, exp } = await issueJwt(deps, { sub, role, mid });
    return send(c, "authVerify", { token, role, address: sub, merchantId: mid, expiresAt: isoFromSeconds(exp) });
  });

  return app;
}
