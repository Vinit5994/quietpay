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
import { checkoutPaymentId, quietPayAbi, subscriptionPaymentId } from "@quietpay/shared";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createApp } from "../src/app";
import type { Chain, ChainEvent, RelayFunction, TxReceipt } from "../src/chain";
import { openDb } from "../src/db/client";
import { merchants } from "../src/db/schema";
import type { Deps } from "../src/deps";
import { loadEnv } from "../src/env";
import { Relayer } from "../src/relayer";
import { Dispatcher } from "../src/webhooks";
import { encrypt, newSecretKey, newWebhookSecret } from "../src/lib/crypto";
import { newId, nowSeconds } from "../src/lib/ids";

export const QUIETPAY: Address = "0x8ed9E91D00CbeB77F492863dc101C073F9152aC5";

type FakeSub = { planId: bigint; subscriber: Address; nextChargeAt: bigint; pastDueSince: bigint; cycle: number; status: number };
type FakePlan = { merchantId: bigint; amount: bigint; period: number; grace: number };

export type FakeChain = Chain & {
  balances: Record<string, bigint>;
  allowances: Record<string, bigint>;
  /** set to make the next simulate() throw this (e.g. { errorName: "OrderAlreadyPaid" }) */
  simulateError?: unknown;
  /** set to make the receipt revert */
  revertOnChain?: boolean;
  gasPriceWei: bigint;
  relayerBalanceWei: bigint;
  sent: { fn: RelayFunction; args: readonly unknown[]; hash: Hex }[];
  /** QuietPay events the indexer will see; every send appends what the real contract would emit */
  events: ChainEvent[];
  head: bigint;
  /** chain time (unix seconds); `advance` moves it */
  time: number;
  advance(seconds: number): void;
  subs: Map<bigint, FakeSub>;
  plans: Map<bigint, FakePlan>;
  /** native WBT txs the gas top-up check can look up */
  nativeTxs: Record<string, { from: Address; to: Address | null; value: bigint; success: boolean }>;
  demoSent: { to: Address; amount: bigint }[];
};

const PAYMENT_RECEIVED = "PaymentReceived";

/** Encodes a QuietPay event as a real log (so parseEventLogs works on receipts). */
function encodeLog(eventName: string, args: Record<string, unknown>, hash: Hex, blockNumber: bigint, logIndex: number): Log {
  const ev = quietPayAbi.find((x) => x.type === "event" && x.name === eventName) as {
    inputs: readonly { name: string; type: string; indexed?: boolean }[];
  };
  const data = ev.inputs.filter((i) => !i.indexed);
  return {
    address: QUIETPAY,
    topics: encodeEventTopics({ abi: quietPayAbi, eventName: eventName as never, args: args as never }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(data as never, data.map((i) => args[i.name]) as never),
    blockNumber,
    blockHash: hash,
    transactionHash: hash,
    transactionIndex: 0,
    logIndex,
    removed: false,
  };
}

/**
 * A fake chain with a small model of QuietPay: pay, createPlan, subscribe, charge (success / past due /
 * canceled after grace, exactly like the contract), cancel and cancelByMerchant. No network.
 */
export function fakeChain(balances: Record<string, bigint> = {}): FakeChain {
  const receipts = new Map<Hex, TxReceipt>();
  const sigNonces = new Map<string, bigint>();
  const usdtNonces = new Map<string, bigint>();
  const paid = new Map<string, { merchantId: bigint; payer: Address; amount: bigint; refunded: bigint; refunds: number }>();
  let nextPlan = 1n;
  let nextSub = 1n;
  const lc = (a: string) => a.toLowerCase();

  const chain: FakeChain = {
    balances,
    allowances: {},
    gasPriceWei: 5_000_000_000n,
    relayerBalanceWei: 10n ** 18n,
    sent: [],
    events: [],
    head: 100n,
    time: nowSeconds(),
    advance(seconds) {
      chain.time += seconds;
    },
    subs: new Map(),
    plans: new Map(),
    nativeTxs: {},
    demoSent: [],
    nativeTransfer: async (hash) => chain.nativeTxs[lc(hash)] ?? null,
    demoTransfer: async (to, amount) => {
      chain.demoSent.push({ to, amount });
      return keccak256(toHex(`demo${chain.demoSent.length}${Math.random()}`));
    },
    quietPay: QUIETPAY,
    relayerAddress: privateKeyToAccount(generatePrivateKey()).address,
    usdtBalance: async (owner) => balances[lc(owner)] ?? 0n,
    verifyMessage: (args) => verifyMessage(args),
    verifyTypedData: (args) => verifyTypedData(args as never),
    registerMerchant: async () => ({ merchantId: BigInt(100 + chain.sent.length + Math.floor(Math.random() * 1e6)), txHash: `0x${"00".repeat(32)}` }),
    sigNonce: async (owner) => sigNonces.get(lc(owner)) ?? 0n,
    usdtNonce: async (owner) => usdtNonces.get(lc(owner)) ?? 0n,
    usdtAllowance: async (owner) => chain.allowances[lc(owner)] ?? 0n,
    refundCount: async (paymentId) => paid.get(lc(paymentId))?.refunds ?? 0,
    readSub: async (subId) => {
      const s = chain.subs.get(subId);
      return s ?? { planId: 0n, subscriber: QUIETPAY, nextChargeAt: 0n, pastDueSince: 0n, cycle: 0, status: 0 };
    },
    gasPrice: async () => chain.gasPriceWei,
    relayerBalance: async () => chain.relayerBalanceWei,
    async simulate(fn, args) {
      if (chain.simulateError) {
        const e = chain.simulateError;
        chain.simulateError = undefined;
        throw e;
      }
      if (fn === "refund") {
        const p = paid.get(lc(args[0] as string));
        if (!p) throw { errorName: "UnknownPayment" };
        if (p.refunded + (args[1] as bigint) > p.amount) throw { errorName: "RefundExceedsPayment" };
      }
      if (fn === "charge") {
        const s = chain.subs.get(args[0] as bigint);
        if (!s || (s.status !== 1 && s.status !== 2)) throw { errorName: "NotChargeable" };
        if (BigInt(chain.time) < s.nextChargeAt) throw { errorName: "NotDue" };
      }
    },
    async send(fn, args) {
      const hash = keccak256(toHex(`tx${chain.sent.length}${Date.now()}${Math.random()}`));
      chain.sent.push({ fn, args, hash });
      chain.head += 1n;
      const block = chain.head;
      const emitted: { name: string; args: Record<string, unknown> }[] = [];
      const emit = (name: string, a: Record<string, unknown>) => {
        emitted.push({ name, args: a });
        if (name === PAYMENT_RECEIVED) {
          paid.set(lc(a.paymentId as string), { merchantId: a.merchantId as bigint, payer: a.payer as Address, amount: a.amount as bigint, refunded: 0n, refunds: 0 });
        }
      };
      const now = BigInt(chain.time);

      if (fn === "pay") {
        const [merchantId, orderId, amount, , , payer] = args as [bigint, Hex, bigint, bigint, Hex, Address];
        balances[lc(payer)] = (balances[lc(payer)] ?? 0n) - amount;
        emit(PAYMENT_RECEIVED, { paymentId: checkoutPaymentId(merchantId, orderId), merchantId, ref: orderId, payer, amount, fee: 0n, kind: 0, subId: 0n });
      } else if (fn === "createPlan") {
        const [merchantId, amount, period, grace] = args as [bigint, bigint, number, number];
        const planId = nextPlan++;
        chain.plans.set(planId, { merchantId, amount, period: Number(period), grace: Number(grace) });
        emit("PlanCreated", { planId, merchantId, amount, period: Number(period), grace: Number(grace) });
      } else if (fn === "subscribe") {
        const [planId, subscriber, , , , permitValue] = args as [bigint, Address, bigint, bigint, Hex, bigint];
        const plan = chain.plans.get(planId)!;
        const subId = nextSub++;
        sigNonces.set(lc(subscriber), (sigNonces.get(lc(subscriber)) ?? 0n) + 1n);
        usdtNonces.set(lc(subscriber), (usdtNonces.get(lc(subscriber)) ?? 0n) + 1n);
        chain.allowances[lc(subscriber)] = permitValue - plan.amount;
        balances[lc(subscriber)] = (balances[lc(subscriber)] ?? 0n) - plan.amount;
        chain.subs.set(subId, { planId, subscriber, nextChargeAt: now + BigInt(plan.period), pastDueSince: 0n, cycle: 0, status: 1 });
        emit("Subscribed", { subId, planId, subscriber });
        emit(PAYMENT_RECEIVED, { paymentId: subscriptionPaymentId(subId, 0), merchantId: plan.merchantId, ref: toHex(subId, { size: 32 }), payer: subscriber, amount: plan.amount, fee: 0n, kind: 1, subId });
      } else if (fn === "charge") {
        const subId = args[0] as bigint;
        const s = chain.subs.get(subId)!;
        const plan = chain.plans.get(s.planId)!;
        const who = lc(s.subscriber);
        const ok = (balances[who] ?? 0n) >= plan.amount && (chain.allowances[who] ?? 0n) >= plan.amount;
        if (ok) {
          balances[who]! -= plan.amount;
          chain.allowances[who]! -= plan.amount;
          s.cycle += 1;
          const next = s.nextChargeAt + BigInt(plan.period);
          s.nextChargeAt = next > now ? next : now + 1n;
          s.status = 1;
          s.pastDueSince = 0n;
          const paymentId = subscriptionPaymentId(subId, s.cycle);
          emit("Renewed", { subId, cycle: s.cycle, paymentId, amount: plan.amount });
          emit(PAYMENT_RECEIVED, { paymentId, merchantId: plan.merchantId, ref: toHex(subId, { size: 32 }), payer: s.subscriber, amount: plan.amount, fee: 0n, kind: 1, subId });
        } else if (s.status === 1) {
          s.status = 2;
          s.pastDueSince = now;
          emit("RenewalFailed", { subId, attemptedCycle: s.cycle + 1 });
        } else if (now >= s.pastDueSince + BigInt(plan.grace)) {
          s.status = 3;
          emit("SubscriptionCanceled", { subId, reason: 1 });
        } else {
          emit("RenewalFailed", { subId, attemptedCycle: s.cycle + 1 });
        }
      } else if (fn === "refund") {
        const [paymentId, amount] = args as [Hex, bigint];
        const p = paid.get(lc(paymentId))!;
        const seq = p.refunds++;
        p.refunded += amount;
        balances[lc(p.payer)] = (balances[lc(p.payer)] ?? 0n) + amount;
        emit("Refunded", { paymentId, merchantId: p.merchantId, seq, payer: p.payer, amount, totalRefunded: p.refunded });
      } else if (fn === "cancelByMerchant" || fn === "cancel") {
        const subId = args[0] as bigint;
        const s = chain.subs.get(subId)!;
        s.status = 3;
        if (fn === "cancel") sigNonces.set(lc(s.subscriber), (sigNonces.get(lc(s.subscriber)) ?? 0n) + 1n);
        emit("SubscriptionCanceled", { subId, reason: fn === "cancel" ? 0 : 2 });
      }

      const logs = chain.revertOnChain ? [] : emitted.map((e, i) => encodeLog(e.name, e.args, hash, block, i));
      if (!chain.revertOnChain) {
        emitted.forEach((e, i) =>
          chain.events.push({ eventName: e.name, args: e.args, blockNumber: block, transactionHash: hash, logIndex: i }),
        );
      }
      receipts.set(hash, {
        status: chain.revertOnChain ? "reverted" : "success",
        blockNumber: block,
        gasUsed: 244_000n,
        effectiveGasPrice: chain.gasPriceWei,
        logs,
      });
      return hash;
    },
    async waitForReceipt(hash) {
      return receipts.get(hash)!;
    },
    blockNumber: async () => chain.head,
    quietPayLogs: async (from, to) => chain.events.filter((e) => e.blockNumber >= from && e.blockNumber <= to),
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
export function setup(opts: { onchainId?: string; env?: Record<string, string> } = {}) {
  const env = loadEnv({ ...ENV, ...opts.env });
  const chain = fakeChain();
  const deps: Deps = { env, db: openDb(":memory:"), chain };
  const relayer = new Relayer(deps);
  /** Webhook POSTs the dispatcher made; reply with `webhookStatus` (default 200). */
  const webhook = { calls: [] as { url: string; headers: Headers; body: string }[], status: 200, clock: 1_800_000_000 };
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    webhook.calls.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body) });
    return new Response("ok", { status: webhook.status });
  }) as typeof fetch;
  const dispatcher = new Dispatcher(deps, fakeFetch, () => webhook.clock);
  const app = createApp(deps, { relayer, dispatcher });

  const addMerchant = (name: string, onchainId: string) => {
    const signerKey = generatePrivateKey();
    const payoutKey = generatePrivateKey();
    const payout = privateKeyToAccount(payoutKey).address;
    const sk = newSecretKey();
    const whsec = newWebhookSecret();
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
        webhookUrl: "http://store.test/api/webhooks/quietpay",
        webhookSecret: whsec,
        gasBudgetWei: "50000000000000000",
        createdAt: nowSeconds(),
      })
      .run();
    return { id, webhookSecret: whsec, secretKey: sk.key, signer: privateKeyToAccount(signerKey), payout: privateKeyToAccount(payoutKey), onchainId };
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

  return { app, deps, chain, relayer, dispatcher, webhook, merchant, addMerchant, call };
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
