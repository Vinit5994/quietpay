import QRCode from "qrcode";
import { fromUnits, multiplyAmount, toUnits, type LineItem } from "@quietpay/shared";
import { randomHash, SEEDED, type MockConfig, type MockState, type SessionRec } from "./state";

const hours = (n: number) => n * 3_600_000;
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

export const lineItem = (name: string, unitAmount: string, quantity = 1): LineItem => ({
  name,
  unitAmount: fromUnits(toUnits(unitAmount)),
  quantity,
  amount: multiplyAmount(unitAmount, quantity),
});

export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}

/**
 * Fresh in-memory state with a "Swag Counter" merchant and ready-made sessions for frontend work:
 *   sess_demo_payment       open, 37.00 USDT (hoodie + tee)
 *   sess_demo_subscription  open, Builder Box 15.00 every 2 minutes
 *   sess_demo_expired       expired
 *   sess_demo_paid          already paid
 */
export async function createState(config: MockConfig): Promise<MockState> {
  const t0 = new Date();
  const state: MockState = {
    config,
    merchants: [],
    sessions: new Map(),
    plans: [],
    payments: [],
    subs: [],
    refunds: [],
    links: [],
    deliveries: [],
    balances: new Map(),
    permitNonces: new Map(),
    authNonces: new Map(),
    demoFundedAt: new Map(),
    counters: { merchant: 1n, plan: 1n, sub: 1n },
  };

  state.merchants.push({
    id: SEEDED.merchantId,
    name: "Swag Counter",
    payoutAddress: SEEDED.payoutAddress,
    onchainId: 1n,
    webhookUrl: config.webhookUrl,
    webhookSecret: SEEDED.webhookSecret,
    secretKey: SEEDED.secretKey,
    gasBudgetWei: 50_000_000_000_000_000n, // 0.05 WBT
    gasSpentWei: 2_400_000_000_000_000n,
    txCount: 3,
    createdAt: minutesAgo(600),
  });

  state.plans.push({
    id: SEEDED.planId,
    merchantId: SEEDED.merchantId,
    onchainId: 1n,
    name: "Builder Box",
    amount: toUnits("15.00"),
    interval: "custom",
    periodSeconds: 120,
    graceSeconds: 60,
    active: true,
    createdAt: minutesAgo(590),
  });

  const stickerUrl = `${config.webUrl}/l/${SEEDED.linkSlug}`;
  state.links.push({
    id: "link_sticker_pack",
    merchantId: SEEDED.merchantId,
    slug: SEEDED.linkSlug,
    title: "Sticker Pack",
    description: "Ten holographic hackathon stickers",
    amount: toUnits("3.00"),
    active: true,
    qrSvg: await qrSvg(stickerUrl),
    createdAt: minutesAgo(580),
  });

  const session = (s: Partial<SessionRec> & Pick<SessionRec, "id" | "mode" | "lineItems" | "amount" | "reference">): SessionRec => ({
    merchantId: SEEDED.merchantId,
    status: "open",
    planId: null,
    customerEmail: null,
    successUrl: "http://localhost:3000/orders/demo",
    cancelUrl: "http://localhost:3000/cart",
    expiresAt: new Date(t0.getTime() + hours(24)),
    paymentId: null,
    subscriptionId: null,
    txHash: null,
    payer: null,
    createdAt: t0,
    ...s,
  });

  const cart = [lineItem("Builder Hoodie (L)", "25.00"), lineItem("Ship-It Tee", "12.00")];
  const box = [lineItem("Builder Box", "15.00")];
  for (const s of [
    session({ id: "sess_demo_payment", mode: "payment", lineItems: cart, amount: toUnits("37.00"), reference: "order_demo_1001" }),
    session({
      id: "sess_demo_subscription",
      mode: "subscription",
      lineItems: box,
      amount: toUnits("15.00"),
      planId: SEEDED.planId,
      reference: "box_demo_1",
      successUrl: "http://localhost:3000/box",
    }),
    session({
      id: "sess_demo_expired",
      mode: "payment",
      lineItems: [lineItem("Cap", "10.00")],
      amount: toUnits("10.00"),
      reference: "order_demo_0999",
      expiresAt: minutesAgo(5),
      status: "expired",
    }),
    session({
      id: "sess_demo_paid",
      mode: "payment",
      lineItems: [lineItem("Sticker Pack", "3.00", 2)],
      amount: toUnits("6.00"),
      reference: "order_demo_0998",
      status: "complete",
      payer: SEEDED.customer,
      txHash: randomHash(),
      paymentId: "pay_demo_0998",
    }),
  ]) {
    state.sessions.set(s.id, s);
  }

  // A little history so dashboard pages (B8) have something to show.
  state.payments.push(
    {
      id: "pay_demo_0998",
      onchainId: randomHash(),
      merchantId: SEEDED.merchantId,
      kind: "checkout",
      reference: "order_demo_0998",
      payer: SEEDED.customer,
      amount: toUnits("6.00"),
      fee: 0n,
      refunded: 0n,
      refundCount: 0,
      txHash: state.sessions.get("sess_demo_paid")!.txHash!,
      sessionId: "sess_demo_paid",
      subscriptionId: null,
      description: "Sticker Pack ×2",
      lineItems: [lineItem("Sticker Pack", "3.00", 2)],
      planName: null,
      paidAt: minutesAgo(40),
    },
    {
      id: "pay_demo_0997",
      onchainId: randomHash(),
      merchantId: SEEDED.merchantId,
      kind: "checkout",
      reference: "order_demo_0997",
      payer: SEEDED.customer,
      amount: toUnits("25.00"),
      fee: 0n,
      refunded: toUnits("8.00"),
      refundCount: 1,
      txHash: randomHash(),
      sessionId: null,
      subscriptionId: null,
      description: "Builder Hoodie (M)",
      lineItems: [lineItem("Builder Hoodie (M)", "25.00")],
      planName: null,
      paidAt: minutesAgo(120),
    },
  );
  state.refunds.push({
    id: "re_demo_1",
    paymentId: "pay_demo_0997",
    merchantId: SEEDED.merchantId,
    amount: toUnits("8.00"),
    reason: "Wrong size, exchanged",
    status: "succeeded",
    txHash: randomHash(),
    error: null,
    createdAt: minutesAgo(100),
  });

  return state;
}
