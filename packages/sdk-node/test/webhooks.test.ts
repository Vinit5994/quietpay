import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { QuietPay, QuietPayError, signWebhook } from "../src";

const secret = "whsec_test_123";
const body = JSON.stringify({
  id: "evt_1",
  type: "ping",
  createdAt: "2026-11-06T10:00:00.000Z",
  data: { merchantReference: null, txHash: null, explorerUrl: null, message: "hi" },
});
const now = 1_800_000_000;
const qp = new QuietPay("sk_test_x", { baseUrl: "http://example.test" });

const expectInvalid = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(QuietPayError);
    expect((e as QuietPayError).code).toBe("invalid_webhook_signature");
    return;
  }
  throw new Error("expected verify to throw");
};

describe("webhooks.verify", () => {
  it("accepts a valid signature and returns the event", () => {
    const header = signWebhook(body, secret, now);
    const event = qp.webhooks.verify(body, header, secret, { now: now + 10 });
    expect(event.id).toBe("evt_1");
    expect(event.type).toBe("ping");
  });

  it("matches the spec format: t=<unix>,v1=<hex HMAC-SHA256(secret, '<t>.<rawBody>')>", () => {
    const v1 = createHmac("sha256", secret).update(`${now}.${body}`).digest("hex");
    expect(signWebhook(body, secret, now)).toBe(`t=${now},v1=${v1}`);
  });

  it("rejects a tampered body", () => {
    const header = signWebhook(body, secret, now);
    expectInvalid(() => qp.webhooks.verify(body.replace("hi", "ho"), header, secret, { now }));
  });

  it("rejects the wrong secret", () => {
    const header = signWebhook(body, "other", now);
    expectInvalid(() => qp.webhooks.verify(body, header, secret, { now }));
  });

  it("rejects signatures older than 5 minutes, accepts at exactly 5", () => {
    const header = signWebhook(body, secret, now);
    expect(qp.webhooks.verify(body, header, secret, { now: now + 300 }).id).toBe("evt_1");
    expectInvalid(() => qp.webhooks.verify(body, header, secret, { now: now + 301 }));
    expectInvalid(() => qp.webhooks.verify(body, header, secret, { now: now - 301 }));
  });

  it("rejects missing or malformed headers", () => {
    for (const h of [null, undefined, "", "garbage", `t=${now}`, "v1=abc", `t=abc,v1=00`]) {
      expectInvalid(() => qp.webhooks.verify(body, h, secret, { now }));
    }
  });

  it("accepts when one of several v1 signatures matches (secret rotation)", () => {
    const good = signWebhook(body, secret, now).split(",")[1];
    expect(qp.webhooks.verify(body, `t=${now},v1=deadbeef,${good}`, secret, { now }).id).toBe("evt_1");
  });

  it("rejects a valid signature over non-JSON", () => {
    expectInvalid(() => qp.webhooks.verify("not json", signWebhook("not json", secret, now), secret, { now }));
  });
});

describe("client", () => {
  it("sends the secret key and parses JSON", async () => {
    let seen: Request | undefined;
    const client = new QuietPay("sk_test_abc", {
      baseUrl: "http://api.test/",
      fetch: async (input, init) => {
        seen = new Request(input, init);
        return new Response(JSON.stringify({ id: "sess_1" }), { status: 201 });
      },
    });
    const s = await client.checkout.sessions.create({
      mode: "payment",
      reference: "ord_1",
      lineItems: [{ name: "Tee", unitAmount: "12.00", quantity: 1 }],
      successUrl: "http://s.test/ok",
      cancelUrl: "http://s.test/cart",
    });
    expect(s.id).toBe("sess_1");
    expect(seen!.url).toBe("http://api.test/v1/checkout/sessions");
    expect(seen!.headers.get("authorization")).toBe("Bearer sk_test_abc");
    expect(await seen!.json()).toMatchObject({ reference: "ord_1" });
  });

  it("throws QuietPayError with the API error code", async () => {
    const client = new QuietPay("sk_test_abc", {
      fetch: async () =>
        new Response(JSON.stringify({ error: { code: "refund_exceeds_payment", message: "Too much" } }), {
          status: 422,
        }),
    });
    await expect(client.refunds.create({ paymentId: "pay_1", amount: "99.00" })).rejects.toMatchObject({
      code: "refund_exceeds_payment",
      status: 422,
      message: "Too much",
    });
  });

  it("defaults baseUrl to QUIETPAY_API_URL, then localhost:4000", () => {
    const prev = process.env.QUIETPAY_API_URL;
    delete process.env.QUIETPAY_API_URL;
    expect(new QuietPay("sk_test_x").baseUrl).toBe("http://localhost:4000");
    process.env.QUIETPAY_API_URL = "http://localhost:4010";
    expect(new QuietPay("sk_test_x").baseUrl).toBe("http://localhost:4010");
    if (prev === undefined) delete process.env.QUIETPAY_API_URL;
    else process.env.QUIETPAY_API_URL = prev;
  });
});
