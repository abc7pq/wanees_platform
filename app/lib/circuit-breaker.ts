// A small circuit breaker for the AI model (audit 6.2). Before, one timeout switched the model off for
// every visitor for a minute. Now each visitor has a breaker: it opens after 5 failures within 60 seconds,
// stays open for 30 seconds, then lets exactly one trial request through (half-open). A success closes it,
// a failure opens it again. A shared breaker with a higher threshold still protects the provider when it is
// down for everyone. While a breaker is open, replies use the deterministic engine text, as before.

export type BreakerState = "closed" | "open" | "half_open";

export type BreakerOptions = { failureThreshold: number; windowMs: number; openMs: number };

export const VISITOR_BREAKER: BreakerOptions = { failureThreshold: 5, windowMs: 60_000, openMs: 30_000 };
export const SHARED_BREAKER: BreakerOptions = { failureThreshold: 25, windowMs: 60_000, openMs: 30_000 };

export class CircuitBreaker {
  private failures: number[] = [];
  private openedAt: number | null = null;
  private trialInFlight = false;
  private readonly options: BreakerOptions;
  lastUsedAt = 0;

  constructor(options: BreakerOptions) {
    this.options = options;
  }

  state(now: number): BreakerState {
    if (this.openedAt === null) return "closed";
    return now - this.openedAt >= this.options.openMs ? "half_open" : "open";
  }

  /** May a request go to the model now? In half-open, only one trial at a time. */
  allow(now: number) {
    this.lastUsedAt = now;
    const state = this.state(now);
    if (state === "closed") return true;
    if (state === "open" || this.trialInFlight) return false;
    this.trialInFlight = true;
    return true;
  }

  /** Give back a half-open trial that was taken but not used (another breaker said no). */
  release() {
    this.trialInFlight = false;
  }

  success(now: number) {
    this.lastUsedAt = now;
    this.failures = [];
    this.openedAt = null;
    this.trialInFlight = false;
  }

  failure(now: number) {
    this.lastUsedAt = now;
    if (this.openedAt !== null) {
      // The half-open trial failed (or a request that started before opening): stay open, from now.
      this.openedAt = now;
      this.trialInFlight = false;
      return;
    }
    this.failures = [...this.failures.filter((at) => now - at < this.options.windowMs), now];
    if (this.failures.length >= this.options.failureThreshold) {
      this.openedAt = now;
      this.failures = [];
    }
  }
}

/** Breakers by key (a visitor session), bounded so a crowd cannot grow memory without limit. */
export class BreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly options: BreakerOptions;
  private readonly maxEntries: number;
  private readonly idleMs: number;

  constructor(options: BreakerOptions, maxEntries = 5000, idleMs = 15 * 60_000) {
    this.options = options;
    this.maxEntries = maxEntries;
    this.idleMs = idleMs;
  }

  get(key: string, now: number) {
    let breaker = this.breakers.get(key);
    if (!breaker) {
      if (this.breakers.size >= this.maxEntries) this.prune(now);
      breaker = new CircuitBreaker(this.options);
      this.breakers.set(key, breaker);
    }
    return breaker;
  }

  get size() {
    return this.breakers.size;
  }

  private prune(now: number) {
    for (const [key, breaker] of this.breakers) {
      if (now - breaker.lastUsedAt > this.idleMs) this.breakers.delete(key);
    }
    // Still full: drop the least recently used quarter.
    if (this.breakers.size >= this.maxEntries) {
      const oldest = [...this.breakers.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt).slice(0, Math.ceil(this.maxEntries / 4));
      for (const [key] of oldest) this.breakers.delete(key);
    }
  }
}
