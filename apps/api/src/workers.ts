import type { Services } from "./app";
import type { Deps } from "./deps";
import { Indexer } from "./indexer";
import { KEEPER_INTERVAL_MS, Keeper } from "./keeper";

export const INDEXER_INTERVAL_MS = 2_000;
export const DISPATCH_INTERVAL_MS = 1_000;

/** Background loops in the API process: indexer (2s), webhook dispatcher (1s), subscription keeper (10s). */
export function startWorkers(deps: Deps, services: Services) {
  const indexer = new Indexer(deps);
  const keeper = new Keeper(deps, services.relayer);
  const run = (name: string, fn: () => Promise<void>) => () =>
    fn().catch((err) => console.error(`[${name}]`, err instanceof Error ? err.message : err));

  const timers = [
    setInterval(run("indexer", () => indexer.tick()), INDEXER_INTERVAL_MS),
    setInterval(run("webhooks", () => services.dispatcher.tick()), DISPATCH_INTERVAL_MS),
    setInterval(run("keeper", () => keeper.tick()), KEEPER_INTERVAL_MS),
    setInterval(run("gas receipts", () => services.relayer.recoverPending()), 10_000),
  ];
  console.log(`  indexer from block ${(indexer.lastBlock() ?? "deploy").toString()}, webhooks dispatcher and keeper on`);
  return {
    indexer,
    keeper,
    stop: () => timers.forEach(clearInterval),
  };
}
