import { createPublicClient, http, type Address, type Hash } from "viem";
import { QUIETPAY_ADDRESS, QUIETPAY_DEPLOY_BLOCK, quietPayAbi, whitechainSepolia } from "@quietpay/shared";

/**
 * Platform stats for the QuietPay team, read straight from the QuietPay contract's events.
 * Everything here is public on-chain data; no API or database involved.
 */

export type MerchantRow = { id: bigint; payout: Address; joinedAt: Date | null; txHash: Hash; payments: number; volume: bigint; refunded: bigint };
export type ActivityKind = "merchant" | "payment" | "refund" | "subscribe" | "cancel";
export type ActivityRow = { kind: ActivityKind; merchantId: bigint | null; amount: bigint | null; at: Date | null; txHash: Hash };
export type DayBucket = { day: string; volume: bigint; payments: number; merchants: number };
export type AdminStats = {
  merchants: MerchantRow[];
  payments: number;
  volume: bigint;
  refunds: number;
  refunded: bigint;
  subscriptions: number;
  activeSubscriptions: number;
  plans: number;
  days: DayBucket[];
  activity: ActivityRow[];
  latestBlock: bigint;
};

const client = createPublicClient({ chain: whitechainSepolia, transport: http(undefined, { batch: { batchSize: 100 } }) });
const CHUNK = 5_000n;

async function allLogs(from: bigint, to: bigint) {
  const address = QUIETPAY_ADDRESS!;
  const out = [];
  for (let start = from; start <= to; start += CHUNK) {
    const end = start + CHUNK - 1n > to ? to : start + CHUNK - 1n;
    out.push(...(await client.getContractEvents({ address, abi: quietPayAbi, fromBlock: start, toBlock: end })));
  }
  return out;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export async function loadAdminStats(): Promise<AdminStats> {
  if (!QUIETPAY_ADDRESS || QUIETPAY_DEPLOY_BLOCK === null) throw new Error("QuietPay isn't deployed yet.");
  const latestBlock = await client.getBlockNumber();
  const logs = await allLogs(QUIETPAY_DEPLOY_BLOCK, latestBlock);

  // Block timestamps, deduplicated and fetched in JSON-RPC batches.
  const blocks = [...new Set(logs.map((l) => l.blockNumber))];
  const times = new Map<bigint, Date>();
  await Promise.all(
    blocks.map(async (n) => {
      const b = await client.getBlock({ blockNumber: n });
      times.set(n, new Date(Number(b.timestamp) * 1000));
    }),
  );

  const merchants = new Map<bigint, MerchantRow>();
  const activity: ActivityRow[] = [];
  const subs = new Map<bigint, boolean>(); // subId -> still active
  let payments = 0;
  let volume = 0n;
  let refunds = 0;
  let refunded = 0n;
  let plans = 0;
  const days = new Map<string, DayBucket>();
  const bucket = (at: Date | null) => {
    const k = at ? dayKey(at) : "unknown";
    let b = days.get(k);
    if (!b) days.set(k, (b = { day: k, volume: 0n, payments: 0, merchants: 0 }));
    return b;
  };

  for (const log of logs) {
    const at = times.get(log.blockNumber) ?? null;
    const txHash = log.transactionHash;
    switch (log.eventName) {
      case "MerchantRegistered": {
        const a = log.args as { merchantId: bigint; payout: Address };
        merchants.set(a.merchantId, { id: a.merchantId, payout: a.payout, joinedAt: at, txHash, payments: 0, volume: 0n, refunded: 0n });
        bucket(at).merchants += 1;
        activity.push({ kind: "merchant", merchantId: a.merchantId, amount: null, at, txHash });
        break;
      }
      case "PaymentReceived": {
        const a = log.args as { merchantId: bigint; amount: bigint };
        payments += 1;
        volume += a.amount;
        const m = merchants.get(a.merchantId);
        if (m) {
          m.payments += 1;
          m.volume += a.amount;
        }
        const b = bucket(at);
        b.payments += 1;
        b.volume += a.amount;
        activity.push({ kind: "payment", merchantId: a.merchantId, amount: a.amount, at, txHash });
        break;
      }
      case "Refunded": {
        const a = log.args as { merchantId: bigint; amount: bigint };
        refunds += 1;
        refunded += a.amount;
        const m = merchants.get(a.merchantId);
        if (m) m.refunded += a.amount;
        activity.push({ kind: "refund", merchantId: a.merchantId, amount: a.amount, at, txHash });
        break;
      }
      case "PlanCreated":
        plans += 1;
        break;
      case "Subscribed": {
        const a = log.args as { subId: bigint };
        subs.set(a.subId, true);
        activity.push({ kind: "subscribe", merchantId: null, amount: null, at, txHash });
        break;
      }
      case "SubscriptionCanceled": {
        const a = log.args as { subId: bigint };
        subs.set(a.subId, false);
        activity.push({ kind: "cancel", merchantId: null, amount: null, at, txHash });
        break;
      }
    }
  }

  // Last 14 days, oldest first, including empty days.
  const series: DayBucket[] = [];
  for (let i = 13; i >= 0; i--) {
    const k = dayKey(new Date(Date.now() - i * 86_400_000));
    series.push(days.get(k) ?? { day: k, volume: 0n, payments: 0, merchants: 0 });
  }

  return {
    merchants: [...merchants.values()].sort((a, b) => (a.id < b.id ? 1 : -1)),
    payments,
    volume,
    refunds,
    refunded,
    subscriptions: subs.size,
    activeSubscriptions: [...subs.values()].filter(Boolean).length,
    plans,
    days: series,
    activity: activity.reverse().slice(0, 20),
    latestBlock,
  };
}

/** Wallets allowed to open /admin: comma-separated NEXT_PUBLIC_ADMIN_ADDRESSES. */
export function isAdmin(address: string | null | undefined): boolean {
  if (!address) return false;
  const list = (process.env.NEXT_PUBLIC_ADMIN_ADDRESSES ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(address.toLowerCase());
}

/** The current contract owner can view the platform overview alongside configured team wallets. */
export async function loadAdminAccess(address: string | null | undefined) {
  if (!address) return { address: null, allowed: false };
  if (isAdmin(address)) return { address, allowed: true };
  if (!QUIETPAY_ADDRESS) return { address, allowed: false };
  const owner = await client.readContract({ address: QUIETPAY_ADDRESS, abi: quietPayAbi, functionName: "owner" });
  return { address, allowed: owner.toLowerCase() === address.toLowerCase() };
}
