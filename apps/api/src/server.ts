import { serve } from "@hono/node-server";
import { createApp, createServices } from "./app";
import { createChain } from "./chain";
import { openDb } from "./db/client";
import { loadEnv } from "./env";
import { startWorkers } from "./workers";

const env = loadEnv();
const deps = { env, db: openDb(env.DATABASE_PATH), chain: createChain(env) };
const services = createServices(deps);

serve({ fetch: createApp(deps, services).fetch, port: env.PORT }, (info) => {
  console.log(`QuietPay API listening on http://localhost:${info.port}`);
  console.log(`  QuietPay ${deps.chain.quietPay}, relayer ${deps.chain.relayerAddress}, db ${env.DATABASE_PATH}`);
  startWorkers(deps, services);
});
