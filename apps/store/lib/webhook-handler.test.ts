import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { signWebhook, verifyWebhook } from "@quietpay/node";
import { beforeEach, describe, expect, it } from "vitest";
import { createOrder, getOrder } from "./orders";
import { handleQuietPayEvent } from "./webhook-handler";

const SECRET = "whsec_test";
const TX = `0x${"ab".repeat(32)}`;
const EXPLORER = `https://explorer.testnet.whitechain.io/tx/${TX}`;
let n = 0;

beforeEach(() => {
  process.env.STORE_DATA_FILE = path.join(mkdtempSync(path.join(tmpdir(), "store-")), "store.json");
});

/** Build a raw webhook exactly as QuietPay sends it, then verify it with the SDK like the route does. */
function deliver(type: string, data: Record<string, unknown>) {
  const raw = JSON.stringify({ id: `evt_${++n}`, type, createdAt: new Date().toISOString(), data });
  const event = verifyWebhook(raw, signWebhook(raw, SECRET), SECRET);
  return { event, result: handleQuietPayEvent(event) };
}

const paymentData = (reference: string) => ({
  merchantReference: reference,
  txHash: TX,
  explorerUrl: EXPLORER,
  paymentId: "pay_1",
  kind: "checkout",
  sessionId: "sess_1",
  subscriptionId: null,
  payerAddress: "0x1111111111111111111111111111111111111111",
  amount: "25.00",
  fee: "0.00",
  net: "25.00",
  paidAt: new Date().toISOString(),
});

const refundData = (reference: string, amount: string, total: string, full: boolean) => ({
  merchantReference: reference,
  txHash: TX,
  explorerUrl: EXPLORER,
  refundId: `re_${n}`,
  paymentId: "pay_1",
  amount,
  totalRefunded: total,
  paymentAmount: "25.00",
  fullyRefunded: full,
});

describe("QuietPay webhooks → orders", () => {
  it("payment.succeeded marks the order paid with the tx link", () => {
    const order = createOrder([{ productId: "builder-hoodie", size: "L", qty: 1 }]);
    expect(deliver("payment.succeeded", paymentData(order.id)).result).toBe("handled");
    expect(getOrder(order.id)).toMatchObject({ status: "paid", paymentId: "pay_1", explorerUrl: EXPLORER });
  });

  it("ignores a repeated delivery of the same event", () => {
    const order = createOrder([{ productId: "sticker-pack", size: null, qty: 1 }]);
    const raw = JSON.stringify({ id: "evt_same", type: "payment.succeeded", createdAt: new Date().toISOString(), data: paymentData(order.id) });
    const event = verifyWebhook(raw, signWebhook(raw, SECRET), SECRET);
    expect(handleQuietPayEvent(event)).toBe("handled");
    expect(handleQuietPayEvent(event)).toBe("duplicate");
  });

  it("partial then full refund", () => {
    const order = createOrder([{ productId: "builder-hoodie", size: "M", qty: 1 }]);
    deliver("payment.succeeded", paymentData(order.id));
    deliver("refund.succeeded", refundData(order.id, "8.00", "8.00", false));
    expect(getOrder(order.id)).toMatchObject({ status: "partially_refunded", refunded: "8.00" });
    deliver("refund.succeeded", refundData(order.id, "17.00", "25.00", true));
    expect(getOrder(order.id)).toMatchObject({ status: "refunded", refunded: "25.00" });
  });

  it("ignores events for unknown orders and other event types", () => {
    expect(deliver("payment.succeeded", paymentData("order_unknown")).result).toBe("ignored");
    expect(deliver("ping", { merchantReference: null, txHash: null, explorerUrl: null, message: "hi" }).result).toBe("ignored");
  });

  it("a tampered body fails verification", () => {
    const raw = JSON.stringify({ id: "evt_x", type: "ping", createdAt: new Date().toISOString(), data: {} });
    const sig = signWebhook(raw, SECRET);
    expect(() => verifyWebhook(raw.replace("ping", "pong"), sig, SECRET)).toThrow();
  });
});
