import { eq } from "drizzle-orm";
import { keccak256, toBytes, verifyTypedData, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { CheckoutSession, invoiceTypedData, orderIdFromSessionId } from "@quietpay/shared";
import { checkoutSessions } from "../src/db/schema";
import { priceLineItems } from "../src/services/sessions";
import { QUIETPAY, hoodieSession, setup } from "./helpers";

describe("amounts", () => {
  it("sums line items in base units", () => {
    const { total, stored } = priceLineItems([
      { name: "Hoodie", unitAmount: "25.00", quantity: 1 },
      { name: "Sticker", unitAmount: "3", quantity: 4 },
      { name: "Cent", unitAmount: "0.01", quantity: 3 },
    ]);
    expect(total).toBe(37_030_000n);
    expect(stored[1]).toEqual({ name: "Sticker", unitAmountUnits: "3000000", quantity: 4 });
  });

  it("rejects more than 2 decimals", async () => {
    const { call, merchant } = setup();
    const bad = { ...hoodieSession, lineItems: [{ name: "x", unitAmount: "1.005", quantity: 1 }] };
    const res = await call("POST", "/v1/checkout/sessions", { body: bad, token: merchant.secretKey });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
  });

  it("rejects checkouts below 0.50 USDT", async () => {
    const { call, merchant } = setup();
    const tiny = { ...hoodieSession, lineItems: [{ name: "Gum", unitAmount: "0.49", quantity: 1 }] };
    const res = await call("POST", "/v1/checkout/sessions", { body: tiny, token: merchant.secretKey });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("amount_below_minimum");
  });
});

describe("POST /v1/checkout/sessions", () => {
  it("creates a session the SDK can redirect to", async () => {
    const { call, merchant } = setup();
    const res = await call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: merchant.secretKey });

    expect(res.status).toBe(201);
    const s = CheckoutSession.parse(res.body);
    expect(s.id).toMatch(/^sess_[0-9a-zA-Z]{24}$/);
    expect(s.url).toBe(`http://localhost:3001/c/${s.id}`);
    expect(s.amount).toBe("37.00");
    expect(s.status).toBe("open");
    expect(s.lineItems[1]).toEqual({ name: "Sticker Pack", unitAmount: "3.00", quantity: 4, amount: "12.00" });
    expect(new Date(s.expiresAt).getTime() - new Date(s.createdAt).getTime()).toBe(1800_000);
  });

  it("stores order_id_hex = keccak256(sessionId) and a valid merchant-signed Invoice", async () => {
    const { call, merchant, deps } = setup();
    const { body } = await call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: merchant.secretKey });
    const row = deps.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, body.id)).get()!;

    expect(row.orderIdHex).toBe(keccak256(toBytes(body.id)));
    expect(row.orderIdHex).toBe(orderIdFromSessionId(body.id));
    expect(row.amountUnits).toBe("37000000");

    const td = invoiceTypedData(QUIETPAY, {
      merchantId: 7n,
      orderId: row.orderIdHex as Hex,
      amount: 37_000_000n,
      expiresAt: BigInt(row.expiresAt),
    });
    expect(await verifyTypedData({ ...td, address: merchant.signer.address, signature: row.invoiceSig as Hex })).toBe(true);
  });

  it("gives every session a distinct order id", async () => {
    const { call, merchant } = setup();
    const a = await call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: merchant.secretKey });
    const b = await call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: merchant.secretKey });
    expect(orderIdFromSessionId(a.body.id)).not.toBe(orderIdFromSessionId(b.body.id));
  });

  it("rejects a subscription session for an unknown plan", async () => {
    const { call, merchant } = setup();
    const res = await call("POST", "/v1/checkout/sessions", {
      body: { mode: "subscription", planId: "plan_x", reference: "box_1", successUrl: "http://s.test/a", cancelUrl: "http://s.test/b" },
      token: merchant.secretKey,
    });
    expect(res.status).toBe(404);
  });
});

describe("auth on /v1", () => {
  it("requires a secret key", async () => {
    const { call } = setup();
    expect((await call("POST", "/v1/checkout/sessions", { body: hoodieSession })).status).toBe(401);
    const wrong = await call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: "sk_test_nope" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("unauthorized");
  });

  it("only shows a merchant its own sessions", async () => {
    const { call, merchant, addMerchant } = setup();
    const other = addMerchant("Other Shop", "8");
    const { body } = await call("POST", "/v1/checkout/sessions", { body: hoodieSession, token: merchant.secretKey });

    expect((await call("GET", `/v1/checkout/sessions/${body.id}`, { token: merchant.secretKey })).status).toBe(200);
    expect((await call("GET", `/v1/checkout/sessions/${body.id}`, { token: other.secretKey })).status).toBe(404);
  });

  it("returns the error envelope for unknown routes", async () => {
    const { call } = setup();
    const res = await call("GET", "/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });
});
