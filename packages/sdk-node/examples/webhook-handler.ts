/** Webhook route (Next.js / any Fetch-API runtime): verify, dedupe on event.id, handle every type. */
import { QuietPay, type QuietPayEvent } from "../src";

declare function alreadyHandled(eventId: string): Promise<boolean>;
declare function rememberHandled(eventId: string): Promise<void>;
declare function markPaid(orderId: string | null, txHash: string | null): Promise<void>;
declare function markRefunded(orderId: string | null, totalRefunded: string, fully: boolean): Promise<void>;
declare function syncSubscription(data: Extract<QuietPayEvent, { type: "subscription.renewed" }>["data"]): Promise<void>;

const qp = new QuietPay(process.env.QUIETPAY_SECRET_KEY ?? "sk_test_unused_for_verify");

export async function POST(req: Request): Promise<Response> {
  let event: QuietPayEvent;
  try {
    event = qp.webhooks.verify(await req.text(), req.headers.get("quietpay-signature"), process.env.QUIETPAY_WEBHOOK_SECRET!);
  } catch {
    return new Response("bad signature", { status: 400 });
  }
  if (await alreadyHandled(event.id)) return new Response("ok");

  switch (event.type) {
    case "payment.succeeded":
      await markPaid(event.data.merchantReference, event.data.txHash);
      break;
    case "refund.succeeded":
      await markRefunded(event.data.merchantReference, event.data.totalRefunded, event.data.fullyRefunded);
      break;
    case "subscription.created":
    case "subscription.renewed":
    case "subscription.payment_failed":
    case "subscription.canceled":
      await syncSubscription(event.data);
      break;
    case "checkout.session.completed":
    case "ping":
      break;
  }
  await rememberHandled(event.id);
  return new Response("ok");
}
