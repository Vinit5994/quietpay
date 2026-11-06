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
 *
 * Also creates the "Builder Box" plan on-chain (15.00 USDT every DEMO_PERIOD_OVERRIDE or 120s, 60s grace)
 * and prints QUIETPAY_BOX_PLAN_ID for the store.
 */
import { eq } from "drizzle-orm";
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { explorerTx } from "@quietpay/shared";
import { createChain } from "./chain";
import { openDb } from "./db/client";
import { merchants, plans } from "./db/schema";
import type { MerchantRow } from "./deps";
import { Relayer } from "./relayer";
import { createPlan } from "./services/plans";
import { loadEnv } from "./env";
import { encrypt, newSecretKey, newWebhookSecret } from "./lib/crypto";
import { newId, nowSeconds } from "./lib/ids";

const NAME = "Swag Counter";
const GAS_BUDGET_WEI = 50_000_000_000_000_000n; // 0.05 WBT demo budget

const env = loadEnv();
const db = openDb(env.DATABASE_PATH);
const chain = createChain(env);
const resetKeys = process.argv.includes("--reset-keys");
const deps = { env, db, chain };

const BOX_PLAN = "Builder Box";

/** Creates the Builder Box plan once per merchant and prints its id. */
async function ensureBoxPlan(merchant: MerchantRow) {
  let plan = db.select().from(plans).where(eq(plans.name, BOX_PLAN)).all().find((p) => p.merchantId === merchant.id);
  if (!plan) {
    plan = await createPlan(deps, new Relayer(deps), merchant, {
      name: BOX_PLAN,
      amount: "15.00",
      interval: "custom",
      periodSeconds: env.DEMO_PERIOD_OVERRIDE ?? 120,
      graceSeconds: 60,
    });
    console.log(`Created plan ${BOX_PLAN} on-chain #${plan.onchainPlanId}: 15.00 USDT every ${plan.periodSeconds}s, grace ${plan.graceSeconds}s`);
  }
  console.log(`\nPut in apps/store/.env:\nQUIETPAY_BOX_PLAN_ID=${plan.id}`);
}

function printKeys(secretKey: string, webhookSecret: string) {
  console.log("\nShown once. Put these in apps/store/.env:\n");
  console.log(`QUIETPAY_SECRET_KEY=${secretKey}`);
  console.log(`QUIETPAY_WEBHOOK_SECRET=${webhookSecret}`);
}

async function main() {
  const existing = db.select().from(merchants).where(eq(merchants.name, NAME)).get();
  if (existing) {
    console.log(`${NAME} already seeded: ${existing.id} (on-chain #${existing.onchainId}), payout ${existing.payoutAddress}`);
    await ensureBoxPlan(existing);
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
  await ensureBoxPlan(db.select().from(merchants).where(eq(merchants.id, id)).get()!);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
