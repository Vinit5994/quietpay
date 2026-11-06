import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  toHex,
  verifyMessage,
  verifyTypedData,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { checkoutPaymentId, quietPayAbi } from "@quietpay/shared";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createApp } from "../src/app";
import type { Chain, RelayFunction, TxReceipt } from "../src/chain";
import { openDb } from "../src/db/client";
import { merchants } from "../src/db/schema";
import type { Deps } from "../src/deps";
import { loadEnv } from "../src/env";
import { Relayer } from "../src/relayer";
import { encrypt, newSecretKey, newWebhookSecret } from "../src/lib/crypto";
import { newId, nowSeconds } from "../src/lib/ids";

export const QUIETPAY: Address = "0x8ed9E91D00CbeB77F492863dc101C073F9152aC5";

export type FakeChain = Chain & {
  balances: Record<string, bigint>;
  /** set to make the next simulate() throw this (e.g. { errorName: "OrderAlreadyPaid" }) */
  simulateError?: unknown;
  /** set to make the receipt revert */
  revertOnChain?: boolean;
  gasPriceWei: bigint;
  relayerBalanceWei: bigint;
  sent: { fn: RelayFunction; args: readonly unknown[]; hash: Hex }[];
};

/** A fake chain: balances from a map, EOA signature checks, and a `pay` that emits PaymentReceived. No network. */
export function fakeChain(balances: Record<string, bigint> = {}): FakeChain {
  const receipts = new Map<Hex, TxReceipt>();
  const chain: FakeChain = {
    balances,
    gasPriceWei: 5_000_000_000n,
    relayerBalanceWei: 10n ** 18n,
    sent: [],
    quietPay: QUIETPAY,
    relayerAddress: privateKeyToAccount(generatePrivateKey()).address,
    usdtBalance: async (owner) => balances[owner.toLowerCase()] ?? 0n,
    verifyMessage: (args) => verifyMessage(args),
    verifyTypedData: (args) => verifyTypedData(args as never),
    registerMerchant: async () => ({ merchantId: 1n, txHash: `0x${"00".repeat(32)}` }),
    gasPrice: async () => chain.gasPriceWei,
    relayerBalance: async () => chain.relayerBalanceWei,
    async simulate() {
      if (chain.simulateError) {
        const e = chain.simulateError;
        chain.simulateError = undefined;
        throw e;
      }
    },
    async send(fn, args) {
      const hash = keccak256(toHex(`tx${chain.sent.length}${Date.now()}`));
      chain.sent.push({ fn, args, hash });
      const logs: Log[] = [];
      if (fn === "pay") {
        const [merchantId, orderId, amount, , , payer] = args as [bigint, Hex, bigint, bigint, Hex, Address];
        logs.push({
          address: QUIETPAY,
          topics: encodeEventTopics({
            abi: quietPayAbi,
            eventName: "PaymentReceived",
            args: { paymentId: checkoutPaymentId(merchantId, orderId), merchantId, ref: orderId },
          }) as [Hex, ...Hex[]],
          data: encodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint8" }, { type: "uint256" }],
            [payer, amount, 0n, 0, 0n],
          ),
          blockNumber: 100n,
          blockHash: hash,
          transactionHash: hash,
          transactionIndex: 0,
          logIndex: 0,
          removed: false,
        });
      }
      receipts.set(hash, {
        status: chain.revertOnChain ? "reverted" : "success",
        blockNumber: 100n,
        gasUsed: 244_000n,
        effectiveGasPrice: chain.gasPriceWei,
        logs: chain.revertOnChain ? [] : logs,
      });
      return hash;
    },
    async waitForReceipt(hash) {
      return receipts.get(hash)!;
    },
  };
  return chain;
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
  const relayer = new Relayer(deps);
  const app = createApp(deps, relayer);

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

  return { app, deps, chain, relayer, merchant, addMerchant, call };
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
