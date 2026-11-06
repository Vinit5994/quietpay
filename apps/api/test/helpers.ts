import { verifyMessage, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createApp } from "../src/app";
import type { Chain } from "../src/chain";
import { openDb } from "../src/db/client";
import { merchants } from "../src/db/schema";
import type { Deps } from "../src/deps";
import { loadEnv } from "../src/env";
import { encrypt, newSecretKey, newWebhookSecret } from "../src/lib/crypto";
import { newId, nowSeconds } from "../src/lib/ids";

export const QUIETPAY: Address = "0x8ed9E91D00CbeB77F492863dc101C073F9152aC5";

/** A fake chain: balances from a map, EOA signature checks, no network. */
export function fakeChain(balances: Record<string, bigint> = {}): Chain & { balances: Record<string, bigint> } {
  return {
    balances,
    quietPay: QUIETPAY,
    relayerAddress: privateKeyToAccount(generatePrivateKey()).address,
    usdtBalance: async (owner) => balances[owner.toLowerCase()] ?? 0n,
    verifyMessage: (args) => verifyMessage(args),
    registerMerchant: async () => ({ merchantId: 1n, txHash: `0x${"00".repeat(32)}` }),
  };
}

const ENV = {
  RELAYER_PK: generatePrivateKey(),
  ENCRYPTION_KEY: "11".repeat(32),
  JWT_SECRET: "test-jwt-secret-0123456789",
  PUBLIC_WEB_URL: "http://localhost:3001",
  QUIETPAY_ADDRESS: QUIETPAY,
  DATABASE_PATH: ":memory:",
};

/** Fresh app + in-memory db with one seeded merchant whose keys the test knows. */
export function setup(opts: { onchainId?: string } = {}) {
  const env = loadEnv(ENV);
  const chain = fakeChain();
  const deps: Deps = { env, db: openDb(":memory:"), chain };
  const app = createApp(deps);

  const addMerchant = (name: string, onchainId: string) => {
    const signerKey = generatePrivateKey();
    const payoutKey = generatePrivateKey();
    const payout = privateKeyToAccount(payoutKey).address;
    const sk = newSecretKey();
    const id = newId("mer");
    deps.db
      .insert(merchants)
      .values({
        id,
        name,
        onchainId,
        payoutAddress: payout,
        payoutAddressLc: payout.toLowerCase(),
        signerAddress: privateKeyToAccount(signerKey).address,
        signerKeyEnc: encrypt(signerKey, env.ENCRYPTION_KEY),
        secretKeyHash: sk.hash,
        secretKeyPrefix: sk.prefix,
        webhookUrl: null,
        webhookSecret: newWebhookSecret(),
        gasBudgetWei: "50000000000000000",
        createdAt: nowSeconds(),
      })
      .run();
    return { id, secretKey: sk.key, signer: privateKeyToAccount(signerKey), payout: privateKeyToAccount(payoutKey), onchainId };
  };

  const merchant = addMerchant("Swag Counter", opts.onchainId ?? "7");

  /** JSON request helper. */
  const call = async (method: string, path: string, init: { body?: unknown; token?: string } = {}) => {
    const res = await app.request(path, {
      method,
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? (JSON.parse(text) as any) : undefined };
  };

  return { app, deps, chain, merchant, addMerchant, call };
}

export const hoodieSession = {
  mode: "payment" as const,
  reference: "ord_1001",
  lineItems: [
    { name: "Builder Hoodie (L)", unitAmount: "25.00", quantity: 1 },
    { name: "Sticker Pack", unitAmount: "3.00", quantity: 4 },
  ],
  successUrl: "http://localhost:3000/orders/ord_1001",
  cancelUrl: "http://localhost:3000/cart",
};
