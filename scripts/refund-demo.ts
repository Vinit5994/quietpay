/**
 * A10 on the real chain: two partial refunds of a payment, signed by the merchant payout wallet exactly like the
 * dashboard does, then a too-large refund that the API rejects before sending anything.
 *
 * Env:
 *   PAYMENT_ID           pay_… of a payment of this merchant (e.g. the one `pnpm pay-session` printed)
 *   PAYOUT_PK            the merchant payout wallet (signs in to the dashboard and signs the refunds; needs USDT)
 *   QUIETPAY_SECRET_KEY  merchant secret key
 *   REFUNDS              default "0.30,0.40"
 *   QUIETPAY_API_URL     default http://localhost:4000
 *
 *   pnpm refund-demo
 */
import { createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AuthNonceResponse, AuthVerifyResponse, RefundTypedDataResponse, SubmitRefundResponse, explorerTx, whitechainSepolia } from "@quietpay/shared";

const api = (process.env.QUIETPAY_API_URL || "http://localhost:4000").replace(/\/$/, "");
const need = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name}`);
  return v;
};
const paymentId = need("PAYMENT_ID");
const sk = need("QUIETPAY_SECRET_KEY");
const payout = privateKeyToAccount(need("PAYOUT_PK") as Hex);
const amounts = (process.env.REFUNDS || "0.30,0.40").split(",").map((a) => a.trim());
const client = createPublicClient({ chain: whitechainSepolia, transport: http(process.env.WHITECHAIN_SEPOLIA_RPC_URL || undefined) });

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: T }> {
  const res = await fetch(api + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as T };
}
const ok = <T>(r: { status: number; body: T }, what: string): T => {
  if (r.status >= 400) throw new Error(`${what}: ${JSON.stringify(r.body)}`);
  return r.body;
};

async function main() {
  // dashboard sign-in with the payout wallet
  const n = AuthNonceResponse.parse(ok(await call("GET", `/auth/nonce?address=${payout.address}`), "nonce"));
  const login = AuthVerifyResponse.parse(
    ok(await call("POST", "/auth/verify", { address: payout.address, signature: await payout.signMessage({ message: n.message }), role: "merchant" }), "sign-in"),
  );
  if (!login.merchantId) throw new Error(`${payout.address} is not this API's merchant payout wallet`);
  console.log(`signed in as ${login.merchantId} (${payout.address})\n`);

  const rows: string[] = [];
  for (const [i, amount] of amounts.entries()) {
    const created = ok(await call<{ id: string }>("POST", "/v1/refunds", { paymentId, amount, reason: "demo partial refund" }, sk), "create refund");
    const td = RefundTypedDataResponse.parse(ok(await call("POST", `/dash/refunds/${created.id}/typed-data`, undefined, login.token), "typed data"));
    const signature = await payout.signTypedData(td.typedData as never);
    const sent = SubmitRefundResponse.parse(ok(await call("POST", `/dash/refunds/${created.id}/submit`, { signature }, login.token), "submit"));
    const receipt = await client.waitForTransactionReceipt({ hash: sent.txHash as Hex });
    console.log(`${i + 1}. refund ${amount} USDT (seq ${td.refund.seq}) → ${receipt.status}: ${explorerTx(sent.txHash)}`);
    rows.push(`| Refund ${i === 0 ? "(partial)" : "(second partial)"}, ${amount} USDT, seq ${td.refund.seq} | ${explorerTx(sent.txHash)} | A10, payout wallet signed EIP-3009, relayer paid gas |`);
  }

  const tooBig = await call<{ error: { code: string; message: string } }>("POST", "/v1/refunds", { paymentId, amount: "999999.00" }, sk);
  console.log(`\n3. too-large refund → HTTP ${tooBig.status} ${tooBig.body.error?.code}: ${tooBig.body.error?.message} (nothing sent)`);

  console.log("\nAdd to docs/EVIDENCE.md:");
  rows.forEach((r) => console.log(r));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
