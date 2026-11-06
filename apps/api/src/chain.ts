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

  gasPrice(): Promise<bigint>;
  relayerBalance(): Promise<bigint>;
  /** Dry-runs a QuietPay call from the relayer. Throws the viem revert error (decoded by relayer/errors.ts). */
  simulate(fn: RelayFunction, args: readonly unknown[]): Promise<void>;
  /** Signs and broadcasts a QuietPay call from the relayer (nonce-managed). Returns the tx hash. */
  send(fn: RelayFunction, args: readonly unknown[]): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<TxReceipt>;
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
  };
  return chain;
}
