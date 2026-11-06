/**
 * Local webhook endpoint for testing: verifies the QuietPay-Signature with @quietpay/node and prints each event.
 *
 *   WEBHOOK_SECRET=whsec_... pnpm webhook-receiver          # listens on http://localhost:3999/hook
 *
 * Point a merchant at it:  PUT /v1/webhook_endpoint {"url":"http://localhost:3999/hook"}  (returns the secret)
 * Env: WEBHOOK_SECRET (required), RECEIVER_PORT (default 3999), FAIL_FIRST=n to answer 500 to the first n requests (retry demo).
 */
import { createServer } from "node:http";
import { QuietPayError, verifyWebhook } from "@quietpay/node";

const secret = process.env.WEBHOOK_SECRET;
if (!secret) throw new Error("Set WEBHOOK_SECRET (returned by PUT /v1/webhook_endpoint, or QUIETPAY_WEBHOOK_SECRET from the seed)");
const port = Number(process.env.RECEIVER_PORT || 3999);
let failFirst = Number(process.env.FAIL_FIRST || 0);
const seen = new Set<string>();

createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    if (failFirst > 0) {
      failFirst--;
      console.log(`↩︎ answering 500 on purpose (${failFirst} left)`);
      res.writeHead(500).end("fail");
      return;
    }
    try {
      const event = verifyWebhook(raw, req.headers["quietpay-signature"] as string | undefined, secret);
      const dup = seen.has(event.id);
      seen.add(event.id);
      console.log(`✔ ${event.type} ${event.id}${dup ? " (duplicate, ignored)" : ""}`);
      console.log(JSON.stringify(event.data, null, 2));
      res.writeHead(200).end("ok");
    } catch (err) {
      console.log(`✘ rejected: ${err instanceof QuietPayError ? err.message : String(err)}`);
      res.writeHead(400).end("bad signature");
    }
  });
}).listen(port, () => console.log(`webhook receiver on http://localhost:${port}/hook`));
