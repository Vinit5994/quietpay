import {
  createPublicClient,
  createWalletClient,
  http,
  nonceManager,
  parseEventLogs,
  type Address,
  type Hex,
  type Log,
  type TypedDataDefinition,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDT_ADDRESS, quietPayAbi, usdtAbi, whitechainSepolia } from "@quietpay/shared";
import type { Env } from "./env";

/**
 * The only QuietPay functions the relayer may call (SPEC_API relayer check 1).
 * The target is always the QuietPay contract; arbitrary calldata is never forwarded.
 */
export const RELAY_FUNCTIONS = [
  "pay",
  "subscribe",
  "charge",
  "refund",
  "cancel",
  "cancelByMerchant",
  "registerMerchant",
  "updateMerchant",
  "createPlan",
  "setPlanActive",
] as const;
export type RelayFunction = (typeof RELAY_FUNCTIONS)[number];

/** A decoded QuietPay event, as the indexer stores it. */
export type ChainEvent = {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
};

/** QuietPay `subs(subId)`; status 0 None, 1 Active, 2 PastDue, 3 Canceled. */
export type OnchainSub = {
  planId: bigint;
  subscriber: Address;
  nextChargeAt: bigint;
  pastDueSince: bigint;
  cycle: number;
  status: number;
};

export type TxReceipt = {
  status: "success" | "reverted";
  blockNumber: bigint;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  logs: Log[];
};

/** Everything the API reads from / writes to the chain. Tests pass a fake. */
export interface Chain {
  quietPay: Address;
  relayerAddress: Address;
  usdtBalance(owner: Address): Promise<bigint>;
  /** EOA and smart-wallet (ERC-1271/6492) signatures. */
  verifyMessage(args: { address: Address; message: string; signature: Hex }): Promise<boolean>;
  verifyTypedData(args: TypedDataDefinition & { address: Address; signature: Hex }): Promise<boolean>;
  /** Operator call used by the seed script and onboarding. */
  registerMerchant(payout: Address, signer: Address): Promise<{ merchantId: bigint; txHash: Hex }>;

  /** QuietPay sigNonces(addr): nonce for Subscribe / CancelSubscription signatures. */
  sigNonce(owner: Address): Promise<bigint>;
  /** USDT EIP-2612 nonces(owner). */
  usdtNonce(owner: Address): Promise<bigint>;
  /** USDT allowance(owner → QuietPay). */
  usdtAllowance(owner: Address): Promise<bigint>;
  readSub(subId: bigint): Promise<OnchainSub>;
  /** A native (WBT) transfer, for gas top-ups. null if not found / not mined. */
  nativeTransfer(txHash: Hex): Promise<{ from: Address; to: Address | null; value: bigint; success: boolean } | null>;
  /** Testnet demo helper: sends USDT from DEMO_TREASURY_PK. Not a QuietPay call, so it never goes through the relayer. */
  demoTransfer(to: Address, amount: bigint): Promise<Hex>;
  /** QuietPay refundCount(paymentId): the next refund's sequence number. */
  refundCount(paymentId: Hex): Promise<number>;

  gasPrice(): Promise<bigint>;
  relayerBalance(): Promise<bigint>;
  /** Dry-runs a QuietPay call from the relayer. Throws the viem revert error (decoded by relayer/errors.ts). */
  simulate(fn: RelayFunction, args: readonly unknown[]): Promise<void>;
  /** Signs and broadcasts a QuietPay call from the relayer (nonce-managed). Returns the tx hash. */
  send(fn: RelayFunction, args: readonly unknown[]): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<TxReceipt>;

  blockNumber(): Promise<bigint>;
  /** QuietPay logs in [fromBlock, toBlock], decoded with the ABI, in chain order. */
  quietPayLogs(fromBlock: bigint, toBlock: bigint): Promise<ChainEvent[]>;
}

export function createChain(env: Env): Chain {
  const transport = http(env.WHITECHAIN_SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: whitechainSepolia, transport });
  // One relayer account with viem's nonce manager; the relayer queue serializes sends on top.
  const relayer = privateKeyToAccount(env.RELAYER_PK as Hex, { nonceManager });
  const wallet = createWalletClient({ account: relayer, chain: whitechainSepolia, transport });
  const quietPay = env.QUIETPAY;

  const chain: Chain = {
    quietPay,
    relayerAddress: relayer.address,

    usdtBalance: (owner) =>
      publicClient.readContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "balanceOf", args: [owner] }),

    verifyMessage: (args) => publicClient.verifyMessage(args),
    verifyTypedData: (args) => publicClient.verifyTypedData(args as never),

    async registerMerchant(payout, signer) {
      console.log(`[chain] -> QuietPay(${quietPay}).registerMerchant(${payout}, ${signer}) from ${relayer.address}`);
      await chain.simulate("registerMerchant", [payout, signer]);
      const txHash = await chain.send("registerMerchant", [payout, signer]);
      const receipt = await chain.waitForReceipt(txHash);
      const [log] = parseEventLogs({ abi: quietPayAbi, eventName: "MerchantRegistered", logs: receipt.logs });
      if (!log) throw new Error(`MerchantRegistered not found in ${txHash}`);
      return { merchantId: log.args.merchantId, txHash };
    },

    sigNonce: (owner) =>
      publicClient.readContract({ address: quietPay, abi: quietPayAbi, functionName: "sigNonces", args: [owner] }),
    usdtNonce: (owner) =>
      publicClient.readContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "nonces", args: [owner] }),
    usdtAllowance: (owner) =>
      publicClient.readContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "allowance", args: [owner, quietPay] }),
    async readSub(subId) {
      const [planId, subscriber, nextChargeAt, pastDueSince, cycle, status] = await publicClient.readContract({
        address: quietPay,
        abi: quietPayAbi,
        functionName: "subs",
        args: [subId],
      });
      return { planId, subscriber, nextChargeAt, pastDueSince, cycle, status };
    },

    async nativeTransfer(txHash) {
      try {
        const [tx, receipt] = await Promise.all([
          publicClient.getTransaction({ hash: txHash }),
          publicClient.getTransactionReceipt({ hash: txHash }),
        ]);
        return { from: tx.from, to: tx.to ?? null, value: tx.value, success: receipt.status === "success" };
      } catch {
        return null;
      }
    },

    async demoTransfer(to, amount) {
      if (!env.DEMO_TREASURY_PK) throw new Error("DEMO_TREASURY_PK is not set");
      // same nonceManager as the relayer, so a shared key (treasury = relayer) can't collide on nonces
      const treasury = privateKeyToAccount(env.DEMO_TREASURY_PK as Hex, { nonceManager });
      console.log(`[demo] -> USDT(${USDT_ADDRESS}).transfer(${to}, ${amount}) from ${treasury.address}`);
      return createWalletClient({ account: treasury, chain: whitechainSepolia, transport }).writeContract({
        address: USDT_ADDRESS,
        abi: usdtAbi,
        functionName: "transfer",
        args: [to, amount],
      });
    },

    refundCount: async (paymentId) =>
      Number(await publicClient.readContract({ address: quietPay, abi: quietPayAbi, functionName: "refundCount", args: [paymentId] })),

    gasPrice: () => publicClient.getGasPrice(),
    relayerBalance: () => publicClient.getBalance({ address: relayer.address }),

    async simulate(fn, args) {
      await publicClient.simulateContract({
        account: relayer,
        address: quietPay,
        abi: quietPayAbi,
        functionName: fn,
        args: args as never,
      });
    },

    send: (fn, args) =>
      wallet.writeContract({ address: quietPay, abi: quietPayAbi, functionName: fn, args: args as never } as never),

    async waitForReceipt(hash) {
      const r = await publicClient.waitForTransactionReceipt({ hash });
      return {
        status: r.status,
        blockNumber: r.blockNumber,
        gasUsed: r.gasUsed,
        effectiveGasPrice: r.effectiveGasPrice,
        logs: r.logs,
      };
    },

    blockNumber: () => publicClient.getBlockNumber(),

    async quietPayLogs(fromBlock, toBlock) {
      const logs = await publicClient.getContractEvents({ address: quietPay, abi: quietPayAbi, fromBlock, toBlock, strict: true });
      return logs.map((l) => ({
        eventName: l.eventName,
        args: l.args as Record<string, unknown>,
        blockNumber: l.blockNumber,
        transactionHash: l.transactionHash,
        logIndex: l.logIndex,
      }));
    },
  };
  return chain;
}
