/** In-memory token buckets (SPEC_API relayer check 6). Per process; fine for one API instance. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();

  constructor(
    private readonly capacity: number,
    private readonly perSeconds: number,
    private readonly now: () => number = () => Date.now() / 1000,
  ) {}

  /** Takes one token for `key`; false when the bucket is empty. */
  take(key: string): boolean {
    const t = this.now();
    const refillPerSecond = this.capacity / this.perSeconds;
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updated: t };
    b.tokens = Math.min(this.capacity, b.tokens + (t - b.updated) * refillPerSecond);
    b.updated = t;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }
}

export function relayerRateLimits(now?: () => number) {
  return {
    perIp: new RateLimiter(10, 60, now), // 10 submits / min
    perPayer: new RateLimiter(5, 60, now), // 5 / min
    global: new RateLimiter(5, 1, now), // 5 tx / s
  };
}
