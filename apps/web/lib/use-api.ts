"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

/**
 * Minimal data hook: runs `load`, keeps the last good data while refreshing, optional polling.
 * `reload()` re-runs it (after a mutation).
 */
export function useApi<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], { pollMs }: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(async (signal?: AbortSignal) => {
    const ctrl = new AbortController();
    try {
      const result = await loadRef.current(signal ?? ctrl.signal);
      setData(result);
      setError(null);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    void run(ctrl.signal);
    const t = pollMs ? setInterval(() => void run(), pollMs) : undefined;
    return () => {
      ctrl.abort();
      if (t) clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload: () => run() };
}
