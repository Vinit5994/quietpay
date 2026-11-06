import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { endpoints, toSignableTypedData, WebhookEvent, type PrepareResponse } from "@quietpay/shared";
import { createApp } from "./app";
import { chargeSubscription } from "./engine";
import { handlers } from "./handlers";
import { createState } from "./seed";
import { SEEDED, setBalance, type MockState } from "./state";

const SK = { authorization: `Bearer ${SEEDED.secretKey}`, "content-type": "application/json" };
const JSON_HEADERS = { "content-type": "application/json" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let server: Server;
let webhookUrl = "";
const received: { body: string; signature: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ body, signature: String(req.headers["quietpay-signature"] ?? "") });
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  webhookUrl = `http://localhost:${(server.address() as AddressInfo).port}/hook`;
});
afterAll(() => server.close());

async function setup(): Promise<{ state: MockState; app: ReturnType<typeof createApp> }> {
  const state = await createState({
    webUrl: "http://localhost:3001",
    webhookUrl,
    confirmMs: 30,
    defaultBalance: 100_000_000n,
    strictSignatures: true,
    retryMs: 0,
  });
  return { state, app: createApp(state) };
}

describe("mock API", () => {
  it("implements a handler for every endpoint in the shared map", () => {
    expect(Object.keys(handlers).sort()).toEqual(Object.keys(endpoints).sort());
  });

  it("rejects merchant calls without a valid secret key", async () => {
    const { app } = await setup();
    const res = await app.request("/v1/plans");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("validates request bodies with the shared schemas", async () => {
    const { app } = await setup();
    const res = await app.request("/v1/checkout/sessions", { method: "POST", headers: SK, body: JSON.stringify({ mode: "payment", lineItems: [] }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("runs a payment end to end: create, prepare, sign, submit, complete, signed webhook", async () => {
    const { app } = await setup();
    received.length = 0;
    const create = await app.request("/v1/checkout/sessions", {
      method: "POST",
      headers: SK,
      body: JSON.stringify({
        mode: "payment",
        reference: "order_42",
        lineItems: [{ name: "Builder Hoodie", unitAmount: "25.00", quantity: 1 }, { name: "Ship-It Tee", unitAmount: "12.00", quantity: 2 }],
        successUrl: "http://localhost:3000/orders/42",
        cancelUrl: "http://localhost:3000/cart",
      }),
    });
    expect(create.status).toBe(200);
    const session = await create.json();
    expect(session.amount).toBe("49.00");

    const account = privateKeyToAccount(generatePrivateKey());
    const prep = (await (await app.request(`/public/sessions/${session.id}/prepare`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ payer: account.address }) })).json()) as PrepareResponse;
    expect(prep.mode).toBe("payment");
    if (prep.mode !== "payment") return;
    expect(prep.toSign.payment.message.value).toBe("49000000");

    const signature = await account.signTypedData(toSignableTypedData(prep.toSign.payment) as Parameters<typeof account.signTypedData>[0]);
    const submit = await app.request(`/public/sessions/${session.id}/submit`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ payer: account.address, signatures: { payment: signature } }) });
    expect(submit.status).toBe(200);

    await wait(120);
    const status = await (await app.request(`/public/sessions/${session.id}/status`)).json();
    expect(status.status).toBe("complete");
    expect(status.redirectUrl).toBe("http://localhost:3000/orders/42");

    const paymentHook = received.find((r) => JSON.parse(r.body).type === "payment.succeeded")!;
    expect(WebhookEvent.parse(JSON.parse(paymentHook.body)).type).toBe("payment.succeeded");
    const [t, v1] = paymentHook.signature.split(",").map((p) => p.split("=")[1]);
    expect(v1).toBe(createHmac("sha256", SEEDED.webhookSecret).update(`${t}.${paymentHook.body}`).digest("hex"));
  });

  it("rejects a bad signature when strict, and an already-paid session", async () => {
    const { app } = await setup();
    const account = privateKeyToAccount(generatePrivateKey());
    const bad = await app.request("/public/sessions/sess_demo_payment/submit", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ payer: account.address, signatures: { payment: "0x1234" } }) });
    expect((await bad.json()).error.code).toBe("invalid_signature");
    const paid = await app.request("/public/sessions/sess_demo_paid/prepare", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ payer: account.address }) });
    expect((await paid.json()).error.code).toBe("session_not_open");
    const expired = await app.request("/public/sessions/sess_demo_expired/prepare", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ payer: account.address }) });
    expect((await expired.json()).error.code).toBe("session_expired");
  });

  it("reports insufficient funds in prepare", async () => {
    const { state, app } = await setup();
    const account = privateKeyToAccount(generatePrivateKey());
    setBalance(state, account.address, 4_000_000n);
    const prep = await (await app.request("/public/sessions/sess_demo_payment/prepare", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ payer: account.address }) })).json();
    expect(prep.sufficientFunds).toBe(false);
    expect(prep.balance).toBe("4.00");
  });

  it("caps refunds at the amount paid", async () => {
    const { app } = await setup();
    const auth = { authorization: "Bearer mock.merchant.demo", "content-type": "application/json" };
    const tooMuch = await app.request("/dash/refunds", { method: "POST", headers: auth, body: JSON.stringify({ paymentId: "pay_demo_0997", amount: "20.00" }) });
    expect((await tooMuch.json()).error.code).toBe("refund_exceeds_payment");
    const ok = await app.request("/dash/refunds", { method: "POST", headers: auth, body: JSON.stringify({ paymentId: "pay_demo_0997", amount: "17.00" }) });
    expect((await ok.json()).status).toBe("awaiting_signature");
  });

  it("subscription goes past due on failure and is canceled after grace", async () => {
    const { state } = await setup();
    state.subs.push({
      id: "sub_t",
      onchainId: 9n,
      merchantId: SEEDED.merchantId,
      planId: SEEDED.planId,
      subscriber: SEEDED.customer,
      customerEmail: null,
      reference: "box_t",
      status: "active",
      cycle: 0,
      failedAttempts: 0,
      nextChargeAt: new Date(),
      pastDueSince: null,
      lastAttemptAt: null,
      cancelReason: null,
      forceFail: false,
      createdAt: new Date(),
    });
    const sub = state.subs.at(-1)!;
    await chargeSubscription(state, sub);
    expect(sub.status).toBe("active");
    expect(sub.cycle).toBe(1);
    sub.forceFail = true;
    await chargeSubscription(state, sub);
    expect(sub.status).toBe("past_due");
    await chargeSubscription(state, sub, new Date(Date.now() + 61_000));
    expect(sub.status).toBe("canceled");
    expect(sub.cancelReason).toBe("nonpayment");
  });

  it("exports CSV", async () => {
    const { app } = await setup();
    const res = await app.request("/v1/exports/payments.csv", { headers: SK });
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect((await res.text()).split("\n")[0]).toContain("payment_id");
  });
});
