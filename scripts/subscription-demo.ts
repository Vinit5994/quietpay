/**
 * A9 end-to-end on the real chain with a 2-minute plan: subscribe → renewed → past due → canceled after grace.
 * The subscriber only signs (Subscribe + Permit); the API relayer and keeper send every transaction.
 *
 * Fund SUBSCRIBER_PK with exactly 2 periods (30.00 USDT for the 15.00 Builder Box, no WBT needed):
 * the first charge and one renewal succeed, then the wallet is empty, so the next charge fails on its own.
 *
 * Env:
 *   SUBSCRIBER_PK         fresh wallet holding 2 × plan amount of USDT
 *   QUIETPAY_SECRET_KEY   Swag Counter secret key
 *   QUIETPAY_BOX_PLAN_ID  plan id printed by the seed (2-minute period, 60s grace)
 *   QUIETPAY_API_URL      default http://localhost:4000
 *   WHITECHAIN_SEPOLIA_RPC_URL  default https://rpc.testnet.whitechain.io (for the evidence links)
 *
 *   pnpm subscription-demo        (takes about 5–6 minutes; keep `pnpm dev:api` running)
 */
import { createPublicClient, http, parseAbiItem, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  PrepareSessionResponse,
  QUIETPAY_ADDRESS,
  SessionStatusResponse,
  Subscription,
  explorerTx,
  whitechainSepolia,
} from "@quietpay/shared";

const api = (process.env.QUIETPAY_API_URL || "http://localhost:4000").replace(/\/$/, "");
const sk = need("QUIETPAY_SECRET_KEY");
const planId = need("QUIETPAY_BOX_PLAN_ID");
const subscriber = privateKeyToAccount(need("SUBSCRIBER_PK") as Hex);
const client = createPublicClient({ chain: whitechainSepolia, transport: http(process.env.WHITECHAIN_SEPOLIA_RPC_URL || undefined) });

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name}`);
  return v;
}

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(api + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T & { error?: { code: string; message: string } };
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.error?.code}: ${json.error?.message}`);
  return json;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleTimeString();

async function findSub(): Promise<Subscription> {
  const list = await call<{ data: Subscription[] }>("GET", "/v1/subscriptions", undefined, sk);
  const mine = list.data.find((s) => s.subscriberAddress.toLowerCase() === subscriber.address.toLowerCase() && s.status !== "canceled")
    ?? list.data.find((s) => s.subscriberAddress.toLowerCase() === subscriber.address.toLowerCase());
  if (!mine) throw new Error("subscription not found yet");
  return mine;
}

/** Polls until `done(sub)`; prints every change. */
async function waitFor(label: string, done: (s: Subscription) => boolean, timeoutS: number) {
  let last = "";
  for (let i = 0; i < timeoutS / 3; i++) {
    const s = await findSub();
    const line = `${s.status} cycle ${s.cycle} failed ${s.failedAttempts}${s.cancelReason ? ` (${s.cancelReason})` : ""}`;
    if (line !== last) console.log(`  ${stamp()}  ${line}`);
    last = line;
    if (done(s)) return s;
    await sleep(3000);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function main() {
  const session = await call<{ id: string }>(
    "POST",
    "/v1/checkout/sessions",
    { mode: "subscription", planId, reference: `box_demo_${Date.now()}`, successUrl: "http://localhost:3002/box", cancelUrl: "http://localhost:3002/box" },
    sk,
  );
  const prep = PrepareSessionResponse.parse(await call("POST", `/public/sessions/${session.id}/prepare`, { payer: subscriber.address }));
  if (prep.mode !== "subscription") throw new Error("not a subscription session");
  console.log(`${subscriber.address} has ${prep.balance} USDT; plan ${prep.amount} per period, cap ${prep.spendingCap}`);
  if (!prep.sufficientBalance) throw new Error("subscriber needs USDT");

  const signatures = {
    subscribe: await subscriber.signTypedData(prep.typedData.subscribe as never),
    permit: await subscriber.signTypedData(prep.typedData.permit as never),
  };
  await call("POST", `/public/sessions/${session.id}/submit`, { payer: subscriber.address, signatures });
  for (let i = 0; i < 60; i++) {
    const st = SessionStatusResponse.parse(await call("GET", `/public/sessions/${session.id}/status`));
    if (st.status === "complete") {
      console.log(`\n1. Subscribed (first charge): ${st.explorerUrl}`);
      break;
    }
    if (st.error) throw new Error(`${st.error.code}: ${st.error.message}`);
    await sleep(1000);
  }

  const sub = await findSub();
  console.log(`   ${sub.id} (on-chain #${sub.onchainSubId}), every ${sub.periodSeconds}s, grace ${sub.graceSeconds}s\n`);
  console.log("2. Waiting for the keeper to renew…");
  await waitFor("renewal", (s) => s.cycle >= 1, sub.periodSeconds + 120);
  console.log("3. Waiting for the next charge to fail (wallet is now empty)…");
  await waitFor("past due", (s) => s.status === "past_due", sub.periodSeconds + 120);
  console.log("4. Waiting for cancellation after the grace period…");
  await waitFor("cancel", (s) => s.status === "canceled", sub.graceSeconds + 120);

  // evidence: every QuietPay event for this subscription
  const from = BigInt(process.env.FROM_BLOCK || (await client.getBlockNumber()) - 2_000n);
  const subId = BigInt(sub.onchainSubId);
  const events = [
    parseAbiItem("event Subscribed(uint256 indexed subId, uint256 indexed planId, address indexed subscriber)"),
    parseAbiItem("event Renewed(uint256 indexed subId, uint32 cycle, bytes32 paymentId, uint256 amount)"),
    parseAbiItem("event RenewalFailed(uint256 indexed subId, uint32 attemptedCycle)"),
    parseAbiItem("event SubscriptionCanceled(uint256 indexed subId, uint8 reason)"),
  ];
  console.log("\nAdd to docs/EVIDENCE.md:");
  const rows: [bigint, string][] = [];
  for (const event of events) {
    const logs = await client.getLogs({ address: QUIETPAY_ADDRESS!, event, args: { subId } as never, fromBlock: from });
    for (const l of logs) rows.push([l.blockNumber, `| ${event.name} (sub #${subId}) | ${explorerTx(l.transactionHash)} | A9, 2-minute Builder Box |`]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([, r]) => console.log(r));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
