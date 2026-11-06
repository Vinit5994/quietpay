// QuietPay webhook receiver. Verification with @quietpay/node and order updates are added in task B6.
export async function POST(req: Request) {
  const body = await req.text();
  console.log("[webhook] received (not verified yet, B6):", body.slice(0, 200));
  return new Response("ok");
}
