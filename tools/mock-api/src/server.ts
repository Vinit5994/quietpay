import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { tickSubscriptions } from "./engine";
import { createState } from "./seed";
import { SEEDED, configFromEnv } from "./state";

const port = Number(process.env.MOCK_PORT ?? 4010);
const config = configFromEnv();
const state = await createState(config);
const app = createApp(state);

setInterval(() => void tickSubscriptions(state), 1_000);

serve({ fetch: app.fetch, port }, () => {
  const web = config.webUrl;
  console.log(`
QuietPay MOCK API on http://localhost:${port}   (fake data, no blockchain)

  Secret key (store):     ${SEEDED.secretKey}
  Webhook secret:         ${SEEDED.webhookSecret}
  Webhooks go to:         ${config.webhookUrl}
  Dashboard token:        mock.merchant.demo

  Ready-made checkouts:
    ${web}/c/sess_demo_payment        37.00 USDT, open
    ${web}/c/sess_demo_subscription   Builder Box, open
    ${web}/c/sess_demo_expired        expired
    ${web}/c/sess_demo_paid           already paid
  Payment link:           ${web}/l/${SEEDED.linkSlug}

  Mock controls: GET /mock/state · POST /mock/set-balance {address, amount}
                 POST /mock/fail-next-renewal/:subId · /mock/recover/:subId · /mock/charge-now/:subId
`);
});
