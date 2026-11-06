import QRCode from "qrcode";
import { fromUnits, toUnits, type LineItem } from "@quietpay/shared";
import { newPaymentIds, randomHash, SEEDED, type MockConfig, type MockState, type SessionRec } from "./state";

const hours = (n: number) => n * 3_600_000;
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

export const lineItem = (name: string, unitAmount: string, quantity = 1): LineItem => ({
  name,
  unitAmount: fromUnits(toUnits(unitAmount)),
  quantity,
  amount: fromUnits(toUnits(unitAmount) * BigInt(quantity)),
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
    demoFundedAt: new Map(),
    counters: { merchant: 1n, plan: 1n, sub: 1n, block: 1_000_000n },
  };

  state.merchants.push({
    id: SEEDED.merchantId,
    name: "Swag Counter",
    payoutAddress: SEEDED.payoutAddress,
    signerAddress: SEEDED.signerAddress,
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

  state.links.push({
    id: "link_sticker_pack",
    merchantId: SEEDED.merchantId,
    slug: SEEDED.linkSlug,
    title: "Sticker Pack",
    description: "Ten holographic hackathon stickers",
    amount: toUnits("3.00"),
    active: true,
    qrSvg: await qrSvg(`${config.webUrl}/l/${SEEDED.linkSlug}`),
    createdAt: minutesAgo(580),
  });

  const paid = newPaymentIds();
  const refundedPayment = newPaymentIds();
  const paidTx = randomHash();

  const session = (s: Partial<SessionRec> & Pick<SessionRec, "id" | "mode" | "lineItems" | "amount" | "reference">): SessionRec => ({
    merchantId: SEEDED.merchantId,
    status: "open",
    planId: null,
    customerEmail: null,
    successUrl: "http://localhost:3000/orders/demo",
    cancelUrl: "http://localhost:3000/cart",
    expiresAt: new Date(t0.getTime() + hours(24)),
    paymentLinkId: null,
    paymentId: null,
    subscriptionId: null,
    txHash: null,
    payer: null,
    createdAt: t0,
    ...s,
  });

  for (const s of [
    session({
      id: "sess_demo_payment",
      mode: "payment",
      lineItems: [lineItem("Builder Hoodie (L)", "25.00"), lineItem("Ship-It Tee", "12.00")],
      amount: toUnits("37.00"),
      reference: "order_demo_1001",
    }),
    session({
      id: "sess_demo_subscription",
      mode: "subscription",
      lineItems: [lineItem("Builder Box", "15.00")],
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
      txHash: paidTx,
      paymentId: paid.id,
    }),
  ]) {
    state.sessions.set(s.id, s);
  }

  // A little history so dashboard pages (B8) have something to show.
  state.payments.push(
    {
      ...paid,
      merchantId: SEEDED.merchantId,
      kind: "checkout",
      reference: "order_demo_0998",
      customerEmail: null,
      payer: SEEDED.customer,
      amount: toUnits("6.00"),
      fee: 0n,
      refunded: 0n,
      refundCount: 0,
      txHash: paidTx,
      blockNumber: 999_990n,
      sessionId: "sess_demo_paid",
      subscriptionId: null,
      lineItems: [lineItem("Sticker Pack", "3.00", 2)],
      planName: null,
      paidAt: minutesAgo(40),
    },
    {
      ...refundedPayment,
      merchantId: SEEDED.merchantId,
      kind: "checkout",
      reference: "order_demo_0997",
      customerEmail: null,
      payer: SEEDED.customer,
      amount: toUnits("25.00"),
      fee: 0n,
      refunded: toUnits("8.00"),
      refundCount: 1,
      txHash: randomHash(),
      blockNumber: 999_950n,
      sessionId: null,
      subscriptionId: null,
      lineItems: [lineItem("Builder Hoodie (M)", "25.00")],
      planName: null,
      paidAt: minutesAgo(120),
    },
  );
  state.refunds.push({
    id: "re_demo_1",
    paymentId: refundedPayment.id,
    merchantId: SEEDED.merchantId,
    amount: toUnits("8.00"),
    reason: "Wrong size, exchanged",
    status: "succeeded",
    seq: 0,
    txHash: randomHash(),
    error: null,
    createdAt: minutesAgo(100),
  });

  return state;
}

/** API id of the seeded partially-refunded hoodie payment (25.00, 8.00 refunded). */
export function seededRefundedPaymentId(state: MockState): string {
  return state.refunds.find((r) => r.id === "re_demo_1")!.paymentId;
}
