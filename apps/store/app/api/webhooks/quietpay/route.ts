import { qp } from "@/lib/quietpay";
import { handleQuietPayEvent } from "@/lib/webhook-handler";

export async function POST(req: Request) {
  let event;
  try {
    event = qp.webhooks.verify(await req.text(), req.headers.get("quietpay-signature"), process.env.QUIETPAY_WEBHOOK_SECRET!);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }
  const result = handleQuietPayEvent(event);
  return Response.json({ received: true, result });
}
