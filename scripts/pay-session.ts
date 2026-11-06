/**
 * Pays a checkout session through the API exactly like the hosted checkout page does:
 * GET session → POST /prepare → sign the returned typed data → POST /submit → poll /status.
 * The payer signs only; the API relayer pays the gas.
 *
 * Env:
 *   PAYER_PK             wallet that pays (needs USDT, no WBT)
 *   SESSION_ID           existing session, or leave empty and set QUIETPAY_SECRET_KEY to create one
 *   QUIETPAY_SECRET_KEY  merchant secret key (from the seed), used only to create a session
 *   QUIETPAY_API_URL     default http://localhost:4000
 *
 *   pnpm pay-session
 */
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PrepareSessionResponse, PublicSession, SessionStatusResponse, SubmitSessionResponse } from "@quietpay/shared";

const api = (process.env.QUIETPAY_API_URL || "http://localhost:4000").replace(/\/$/, "");
const payerPk = process.env.PAYER_PK;
if (!payerPk) throw new Error("Set PAYER_PK (the customer wallet that signs)");
const payer = privateKeyToAccount(payerPk as Hex);

async function http<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(api + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T & { error?: { code: string; message: string } };
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json.error?.code}: ${json.error?.message}`);
  return json;
}

async function main() {
  let sessionId = process.env.SESSION_ID;
  if (!sessionId) {
    const sk = process.env.QUIETPAY_SECRET_KEY;
    if (!sk) throw new Error("Set SESSION_ID, or QUIETPAY_SECRET_KEY to create a session");
    const created = await http<{ id: string; url: string }>(
      "POST",
      "/v1/checkout/sessions",
      {
        mode: "payment",
        reference: `script_${Date.now()}`,
        lineItems: [{ name: "Sticker Pack", unitAmount: "1.00", quantity: 1 }],
        successUrl: "http://localhost:3000/orders/script",
        cancelUrl: "http://localhost:3000/cart",
      },
      sk,
    );
    sessionId = created.id;
    console.log(`created ${created.id}  ${created.url}`);
  }

  const session = PublicSession.parse(await http("GET", `/public/sessions/${sessionId}`));
  console.log(`${session.merchant.name}: ${session.amount} USDT, status ${session.status}`);

  const prep = PrepareSessionResponse.parse(await http("POST", `/public/sessions/${sessionId}/prepare`, { payer: payer.address }));
  if (prep.mode !== "payment") throw new Error("this script only pays payment-mode sessions");
  console.log(`payer ${payer.address} has ${prep.balance} USDT (needs ${prep.amount})`);
  if (!prep.sufficientBalance) throw new Error("not enough USDT");

  const signature = await payer.signTypedData(prep.typedData.payment as never);
  const submitted = SubmitSessionResponse.parse(
    await http("POST", `/public/sessions/${sessionId}/submit`, { payer: payer.address, signatures: { payment: signature } }),
  );
  console.log(`submitted ${submitted.txHash}, polling status…`);

  for (let i = 0; i < 60; i++) {
    const st = SessionStatusResponse.parse(await http("GET", `/public/sessions/${sessionId}/status`));
    if (st.status === "complete") {
      console.log(`\nPaid. ${st.explorerUrl}\n  payment ${st.paymentId}\n  receipt ${st.receiptUrl}`);
      return;
    }
    if (st.error) throw new Error(`${st.error.code}: ${st.error.message}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("timed out waiting for the payment");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
