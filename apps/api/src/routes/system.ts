import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { formatEther, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDT_ADDRESS, explorerTx, fromUnits } from "@quietpay/shared";
import { indexerCursor } from "../db/schema";
import type { AppEnv, Deps } from "../deps";
import { ApiError } from "../lib/errors";
import { readBody, send } from "../lib/validate";
import { LOW_BALANCE_WEI } from "../relayer";
import { RateLimiter } from "../relayer/ratelimit";

export const DEMO_FUND_UNITS = 50_000_000n; // 50.00 USDT
export const DEMO_FUND_COOLDOWN = 10 * 60;

/** POST /demo/fund (testnet helper, DEMO_MODE only) and GET /health. */
export function systemRoutes(deps: Deps, now: () => number = () => Math.floor(Date.now() / 1000)) {
  const app = new Hono<AppEnv>();
  const lastFunded = new Map<string, number>();
  const perIp = new RateLimiter(5, 10 * 60);

  app.post("/demo/fund", async (c) => {
    if (deps.env.DEMO_MODE !== "true" || !deps.env.DEMO_TREASURY_PK) {
      throw new ApiError(403, "demo_disabled", "Test USDT funding is only available in demo mode.");
    }
    const { address } = await readBody(c, "demoFund");
    const to = getAddress(address);
    const key = to.toLowerCase();
    const since = now() - (lastFunded.get(key) ?? 0);
    if (since < DEMO_FUND_COOLDOWN) {
      const wait = Math.ceil((DEMO_FUND_COOLDOWN - since) / 60);
      throw new ApiError(429, "demo_fund_cooldown", `This wallet was funded recently. Try again in about ${wait} min.`);
    }
    if (!perIp.take(c.req.header("x-forwarded-for") ?? "local")) {
      throw new ApiError(429, "rate_limited", "Too many funding requests. Wait a few minutes.");
    }
    const treasury = privateKeyToAccount(deps.env.DEMO_TREASURY_PK as Hex).address;
    const available = await deps.chain.usdtBalance(treasury);
    if (available < DEMO_FUND_UNITS) {
      throw new ApiError(
        503,
        "transaction_failed",
        `The demo treasury is empty (${fromUnits(available)} USDT left). Ask the team to refill ${treasury}.`,
      );
    }
    lastFunded.set(key, now());
    try {
      const txHash = await deps.chain.demoTransfer(to, DEMO_FUND_UNITS);
      return send(c, "demoFund", { txHash, explorerUrl: explorerTx(txHash), amount: fromUnits(DEMO_FUND_UNITS) });
    } catch (err) {
      lastFunded.delete(key);
      console.error("[demo] funding failed", err);
      throw new ApiError(500, "transaction_failed", "The demo treasury could not send test USDT right now.");
    }
  });

  app.get("/health", async (c) => {
    let blockNumber: bigint | null = null;
    try {
      blockNumber = await deps.chain.blockNumber();
    } catch {
      // RPC down: reported below
    }
    let balanceWei = 0n;
    try {
      balanceWei = await deps.chain.relayerBalance();
    } catch {
      // ignore
    }
    const cursor = deps.db.select().from(indexerCursor).where(eq(indexerCursor.contract, deps.chain.quietPay.toLowerCase())).get();
    const lastBlock = cursor ? BigInt(cursor.lastBlock) : null;
    return send(c, "health", {
      ok: blockNumber !== null,
      chainId: 1874,
      rpc: { ok: blockNumber !== null, blockNumber: blockNumber?.toString() ?? null },
      relayer: {
        address: deps.chain.relayerAddress,
        balanceWei: balanceWei.toString(),
        balance: formatEther(balanceWei),
        low: balanceWei < LOW_BALANCE_WEI,
      },
      indexer: {
        lastBlock: lastBlock?.toString() ?? null,
        lagBlocks: lastBlock !== null && blockNumber !== null ? Number(blockNumber - lastBlock) : null,
      },
      contract: { quietPay: deps.chain.quietPay, usdt: USDT_ADDRESS },
    });
  });

  return app;
}
