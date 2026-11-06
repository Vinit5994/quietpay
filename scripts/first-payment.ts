/**
 * M1: first real USDT payment through QuietPay on Whitechain Sepolia.
 *
 *  1. registers a test merchant (relayer = operator, pays gas)
 *  2. the merchant signer signs an Invoice
 *  3. the demo treasury signs ReceiveWithAuthorization for the amount (no gas for the payer)
 *  4. the relayer calls pay() and prints the explorer link
 *
 * Env (keys stay in your shell):
 *   RELAYER_PK          operator wallet, needs WBT
 *   DEMO_TREASURY_PK    payer, needs >= AMOUNT USDT
 *   QUIETPAY_ADDRESS    default: packages/shared deployments.ts
 *   MERCHANT_PAYOUT     default: the relayer address
 *   MERCHANT_SIGNER_PK  default: a fresh random key (printed; testnet only)
 *   AMOUNT              default "1.00"
 *   WHITECHAIN_SEPOLIA_RPC_URL  default https://rpc.testnet.whitechain.io
 *
 *   pnpm first-payment            (asks before each write; add --yes to skip)
 */
import { createInterface } from "node:readline/promises";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  QUIETPAY_ADDRESS,
  USDT_ADDRESS,
  explorerAddress,
  explorerTx,
  formatUsdt,
  invoiceTypedData,
  orderIdFromSessionId,
  quietPayAbi,
  receiveWithAuthorizationTypedData,
  toUnits,
  usdtAbi,
  whitechainSepolia,
} from "@quietpay/shared";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const autoYes = process.argv.includes("--yes");
async function confirm(what: string) {
  console.log(`\n${what}`);
  if (autoYes) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Send this transaction? [y/N] ");
  rl.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("Aborted.");
    process.exit(1);
  }
}

const rpc = process.env.WHITECHAIN_SEPOLIA_RPC_URL ?? whitechainSepolia.rpcUrls.default.http[0];
const quietPay = getAddress(process.env.QUIETPAY_ADDRESS ?? QUIETPAY_ADDRESS ?? env("QUIETPAY_ADDRESS"));
const relayer = privateKeyToAccount(env("RELAYER_PK") as Hex);
const treasury = privateKeyToAccount(env("DEMO_TREASURY_PK") as Hex);
const signerPk = (process.env.MERCHANT_SIGNER_PK ?? generatePrivateKey()) as Hex;
const signer = privateKeyToAccount(signerPk);
const payout: Address = getAddress(process.env.MERCHANT_PAYOUT ?? relayer.address);
const amount = toUnits(process.env.AMOUNT ?? "1.00");

const publicClient = createPublicClient({ chain: whitechainSepolia, transport: http(rpc) });
const wallet = createWalletClient({ account: relayer, chain: whitechainSepolia, transport: http(rpc) });

async function main() {
  const chainId = await publicClient.getChainId();
  if (chainId !== whitechainSepolia.id) throw new Error(`RPC is chain ${chainId}, expected ${whitechainSepolia.id}`);

  const [isOperator, wbt, usdtBalance] = await Promise.all([
    publicClient.readContract({ address: quietPay, abi: quietPayAbi, functionName: "operators", args: [relayer.address] }),
    publicClient.getBalance({ address: relayer.address }),
    publicClient.readContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "balanceOf", args: [treasury.address] }),
  ]);

  console.log("QuietPay    ", quietPay, explorerAddress(quietPay));
  console.log("relayer     ", relayer.address, `${Number(wbt) / 1e18} WBT`, isOperator ? "(operator)" : "(NOT operator)");
  console.log("treasury    ", treasury.address, formatUsdt(usdtBalance));
  console.log("payout      ", payout);
  console.log("signer      ", signer.address, process.env.MERCHANT_SIGNER_PK ? "" : `(new key ${signerPk}, testnet only)`);
  console.log("amount      ", formatUsdt(amount));

  if (!isOperator) throw new Error("Relayer is not an operator on QuietPay. Owner must call setOperator(relayer, true).");
  if (usdtBalance < amount) throw new Error(`Treasury has ${formatUsdt(usdtBalance)}, needs ${formatUsdt(amount)}.`);

  // 1. register merchant
  await confirm(`-> QuietPay(${quietPay}).registerMerchant(payout=${payout}, signer=${signer.address}) from ${relayer.address}`);
  const regHash = await wallet.writeContract({
    address: quietPay,
    abi: quietPayAbi,
    functionName: "registerMerchant",
    args: [payout, signer.address],
  });
  const regReceipt = await publicClient.waitForTransactionReceipt({ hash: regHash });
  const [registered] = parseEventLogs({ abi: quietPayAbi, eventName: "MerchantRegistered", logs: regReceipt.logs });
  if (!registered) throw new Error("MerchantRegistered event not found");
  const merchantId = registered.args.merchantId;
  console.log(`   merchant #${merchantId} registered: ${explorerTx(regHash)}`);

  // 2. invoice (merchant signer) + 3. authorization (payer)
  const sessionId = `sess_first_payment_${Date.now()}`;
  const orderId = orderIdFromSessionId(sessionId);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const expiresAt = now + 1800n;
  const nonce = await publicClient.readContract({
    address: quietPay,
    abi: quietPayAbi,
    functionName: "paymentNonce",
    args: [merchantId, orderId],
  });

  const merchantSig = await signer.signTypedData(invoiceTypedData(quietPay, { merchantId, orderId, amount, expiresAt }));
  const payerSig = await treasury.signTypedData(
    receiveWithAuthorizationTypedData({
      from: treasury.address,
      to: quietPay,
      value: amount,
      validAfter: 0n,
      validBefore: expiresAt,
      nonce,
    }),
  );
  console.log(`\n   order ${sessionId} -> orderId ${orderId}`);

  // 4. pay (relayer submits; treasury pays no gas)
  const args = [merchantId, orderId, amount, expiresAt, merchantSig, treasury.address, 0n, expiresAt, payerSig] as const;
  await publicClient.simulateContract({ account: relayer, address: quietPay, abi: quietPayAbi, functionName: "pay", args });
  await confirm(
    `-> QuietPay(${quietPay}).pay(merchantId=${merchantId}, amount=${formatUsdt(amount)}, payer=${treasury.address}) from ${relayer.address}`,
  );
  const payHash = await wallet.writeContract({ address: quietPay, abi: quietPayAbi, functionName: "pay", args });
  const payReceipt = await publicClient.waitForTransactionReceipt({ hash: payHash });
  const [paid] = parseEventLogs({ abi: quietPayAbi, eventName: "PaymentReceived", logs: payReceipt.logs });

  console.log(`\nPaid ${formatUsdt(amount)} gaslessly for the payer.`);
  console.log(`   paymentId ${paid?.args.paymentId}`);
  console.log(`   gas used  ${payReceipt.gasUsed} (paid by the relayer)`);
  console.log(`   tx        ${explorerTx(payHash)}`);
  console.log(`\nAdd to docs/EVIDENCE.md:\n| First payment (pay, 1.00 USDT) | ${explorerTx(payHash)} | merchant #${merchantId}, gas paid by relayer |`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
