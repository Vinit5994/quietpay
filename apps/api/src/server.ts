import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createChain } from "./chain";
import { openDb } from "./db/client";
import { loadEnv } from "./env";

const env = loadEnv();
const deps = { env, db: openDb(env.DATABASE_PATH), chain: createChain(env) };

serve({ fetch: createApp(deps).fetch, port: env.PORT }, (info) => {
  console.log(`QuietPay API listening on http://localhost:${info.port}`);
  console.log(`  QuietPay ${deps.chain.quietPay}, relayer ${deps.chain.relayerAddress}, db ${env.DATABASE_PATH}`);
});
