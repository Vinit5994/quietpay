/** Refunds, payment links, payments list and CSV export. */
import { QuietPay } from "../src";

const qp = new QuietPay(process.env.QUIETPAY_SECRET_KEY!);

export async function refundOrder(orderId: string, amount: string) {
  const { data: [payment] } = await qp.payments.list({ reference: orderId });
  if (!payment) throw new Error(`No payment for ${orderId}`);
  if (Number(amount) > Number(payment.refundable)) throw new Error(`At most ${payment.refundable} USDT can be refunded`);
  const refund = await qp.refunds.create({ paymentId: payment.id, amount, reason: "customer request" });
  return refund.signUrl; // the payout wallet approves it in the dashboard
}

export async function counterQr() {
  const link = await qp.paymentLinks.create({ title: "Sticker Pack", amount: "3.00" });
  return { url: link.url, svg: link.qrSvg };
}

export async function allPayments() {
  const out = [];
  let cursor: string | undefined;
  do {
    const page = await qp.payments.list({ limit: 100, cursor });
    out.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return out;
}

export const monthlyExport = () => qp.exports.paymentsCsv();
