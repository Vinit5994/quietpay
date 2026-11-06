import { createPublicClient, createWalletClient, http, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDT_ADDRESS, quietPayAbi, usdtAbi, whitechainSepolia } from "@quietpay/shared";
import type { Env } from "./env";

/** Everything the API reads from / writes to the chain. Tests pass a fake. */
export interface Chain {
  quietPay: Address;
  relayerAddress: Address;
  usdtBalance(owner: Address): Promise<bigint>;
  /** EOA and smart-wallet (ERC-1271/6492) signatures. */
  verifyMessage(args: { address: Address; message: string; signature: Hex }): Promise<boolean>;
  /** Operator call used by the seed script and onboarding. */
  registerMerchant(payout: Address, signer: Address): Promise<{ merchantId: bigint; txHash: Hex }>;
}

export function createChain(env: Env): Chain {
  const transport = http(env.WHITECHAIN_SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: whitechainSepolia, transport });
  const relayer = privateKeyToAccount(env.RELAYER_PK as Hex);
  const wallet = createWalletClient({ account: relayer, chain: whitechainSepolia, transport });
  const quietPay = env.QUIETPAY;

  return {
    quietPay,
    relayerAddress: relayer.address,

    usdtBalance: (owner) =>
      publicClient.readContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "balanceOf", args: [owner] }),

    verifyMessage: (args) => publicClient.verifyMessage(args),

    async registerMerchant(payout, signer) {
      console.log(`[chain] -> QuietPay(${quietPay}).registerMerchant(${payout}, ${signer}) from ${relayer.address}`);
      const { request } = await publicClient.simulateContract({
        account: relayer,
        address: quietPay,
        abi: quietPayAbi,
        functionName: "registerMerchant",
        args: [payout, signer],
      });
      const txHash = await wallet.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const [log] = parseEventLogs({ abi: quietPayAbi, eventName: "MerchantRegistered", logs: receipt.logs });
      if (!log) throw new Error(`MerchantRegistered not found in ${txHash}`);
      return { merchantId: log.args.merchantId, txHash };
    },
  };
}
