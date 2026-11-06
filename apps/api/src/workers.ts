import type { Services } from "./app";
import type { Deps } from "./deps";
import { Indexer } from "./indexer";

export const INDEXER_INTERVAL_MS = 2_000;
export const DISPATCH_INTERVAL_MS = 1_000;

/** Background loops in the API process: indexer (2s) and webhook dispatcher (1s). Keeper arrives in A9. */
export function startWorkers(deps: Deps, services: Services) {
  const indexer = new Indexer(deps);
  const run = (name: string, fn: () => Promise<void>) => () =>
    fn().catch((err) => console.error(`[${name}]`, err instanceof Error ? err.message : err));

  const timers = [
    setInterval(run("indexer", () => indexer.tick()), INDEXER_INTERVAL_MS),
    setInterval(run("webhooks", () => services.dispatcher.tick()), DISPATCH_INTERVAL_MS),
  ];
  console.log(`  indexer from block ${(indexer.lastBlock() ?? "deploy").toString()}, webhooks dispatcher on`);
  return {
    indexer,
    stop: () => timers.forEach(clearInterval),
  };
}
