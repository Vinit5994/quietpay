/**
 * Seeds the "Swag Counter" demo merchant into THIS instance's database and registers it on-chain
 * through THIS instance's relayer. Safe on both teammates' machines: each gets its own merchant id.
 * Running it again does nothing unless you pass --reset-keys (new secret key + webhook secret).
 *
 *   pnpm --filter @quietpay/api seed
 *
 * Env (apps/api/.env): RELAYER_PK, ENCRYPTION_KEY, JWT_SECRET, DATABASE_PATH, plus optional
 *   SEED_PAYOUT_ADDRESS  wallet that receives payments and signs in to the dashboard (default: relayer)
 *   SEED_WEBHOOK_URL     default http://localhost:3000/api/webhooks/quietpay (Swag Counter)
 */
import { eq } from "drizzle-orm";
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { explorerTx } from "@quietpay/shared";
import { createChain } from "./chain";
import { openDb } from "./db/client";
import { merchants } from "./db/schema";
import { loadEnv } from "./env";
import { encrypt, newSecretKey, newWebhookSecret } from "./lib/crypto";
import { newId, nowSeconds } from "./lib/ids";

const NAME = "Swag Counter";
const GAS_BUDGET_WEI = 50_000_000_000_000_000n; // 0.05 WBT demo budget

const env = loadEnv();
const db = openDb(env.DATABASE_PATH);
const chain = createChain(env);
const resetKeys = process.argv.includes("--reset-keys");

function printKeys(secretKey: string, webhookSecret: string) {
  console.log("\nShown once. Put these in apps/store/.env:\n");
  console.log(`QUIETPAY_SECRET_KEY=${secretKey}`);
  console.log(`QUIETPAY_WEBHOOK_SECRET=${webhookSecret}`);
}

async function main() {
  const existing = db.select().from(merchants).where(eq(merchants.name, NAME)).get();
  if (existing) {
    console.log(`${NAME} already seeded: ${existing.id} (on-chain #${existing.onchainId}), payout ${existing.payoutAddress}`);
    if (!resetKeys) {
      console.log("Lost the keys? Run again with --reset-keys.");
      return;
    }
    const sk = newSecretKey();
    const webhookSecret = newWebhookSecret();
    db.update(merchants)
      .set({ secretKeyHash: sk.hash, secretKeyPrefix: sk.prefix, webhookSecret })
      .where(eq(merchants.id, existing.id))
      .run();
    printKeys(sk.key, webhookSecret);
    return;
  }

  const payout = getAddress(process.env.SEED_PAYOUT_ADDRESS || chain.relayerAddress);
  const signerKey = generatePrivateKey();
  const signer = privateKeyToAccount(signerKey);
  console.log(`Seeding ${NAME}: payout ${payout}, invoice signer ${signer.address}`);

  const { merchantId, txHash } = await chain.registerMerchant(payout, signer.address);
  console.log(`Registered on-chain as merchant #${merchantId}: ${explorerTx(txHash)}`);

  const sk = newSecretKey();
  const webhookSecret = newWebhookSecret();
  const id = newId("mer");
  db.insert(merchants)
    .values({
      id,
      name: NAME,
      onchainId: merchantId.toString(),
      payoutAddress: payout,
      payoutAddressLc: payout.toLowerCase(),
      signerAddress: signer.address,
      signerKeyEnc: encrypt(signerKey, env.ENCRYPTION_KEY),
      secretKeyHash: sk.hash,
      secretKeyPrefix: sk.prefix,
      webhookUrl: process.env.SEED_WEBHOOK_URL || "http://localhost:3000/api/webhooks/quietpay",
      webhookSecret,
      gasBudgetWei: GAS_BUDGET_WEI.toString(),
      gasSpentWei: "0",
      createdAt: nowSeconds(),
    })
    .run();
  console.log(`Saved ${id} in ${env.DATABASE_PATH}`);
  printKeys(sk.key, webhookSecret);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
