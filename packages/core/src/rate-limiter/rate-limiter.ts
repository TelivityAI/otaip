import type { RateLimiterConfig } from './types.js';

/**
 * Token-bucket rate limiter for controlling external API call throughput.
 *
 * Adapters should wrap their HTTP calls with `await limiter.acquire()`
 * to respect supplier rate limits and avoid throttling.
 *
 * Concurrent waiters are serialized: on wake each waiter rechecks capacity
 * and only one grant is issued per freed slot.
 */
export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly timestamps: number[] = [];
  private readonly waitQueue: Array<() => void> = [];
  private drainScheduled = false;

  constructor(config: RateLimiterConfig) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
  }

  /**
   * Acquire a rate limit token. Resolves immediately if under limit,
   * otherwise waits until a token becomes available.
   */
  async acquire(): Promise<void> {
    this.pruneExpired();

    if (this.timestamps.length < this.maxRequests) {
      this.timestamps.push(Date.now());
      return;
    }

    await new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
      this.scheduleDrain();
    });
  }

  /** Number of requests that can be made immediately without waiting. */
  get available(): number {
    this.pruneExpired();
    return Math.max(0, this.maxRequests - this.timestamps.length);
  }

  /** Whether the rate limiter is currently at capacity. */
  get isAtLimit(): boolean {
    this.pruneExpired();
    return this.timestamps.length >= this.maxRequests;
  }

  /** Reset the limiter, clearing tracked requests and granting queued waiters. */
  reset(): void {
    this.timestamps.length = 0;
    this.grantNextWaiters();
  }

  private pruneExpired(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! <= cutoff) {
      this.timestamps.shift();
    }
  }

  private scheduleDrain(): void {
    if (this.drainScheduled || this.waitQueue.length === 0) return;
    this.drainScheduled = true;

    this.pruneExpired();
    if (this.timestamps.length < this.maxRequests) {
      this.drainScheduled = false;
      this.grantNextWaiters();
      return;
    }

    const oldestTimestamp = this.timestamps[0]!;
    const waitTime = Math.max(0, oldestTimestamp + this.windowMs - Date.now());

    const timer = setTimeout(() => {
      this.drainScheduled = false;
      this.pruneExpired();
      this.grantNextWaiters();
      if (this.waitQueue.length > 0) {
        this.scheduleDrain();
      }
    }, waitTime);

    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }
  }

  /** Grant at most one waiter per available slot after rechecking capacity. */
  private grantNextWaiters(): void {
    this.pruneExpired();
    while (this.waitQueue.length > 0 && this.timestamps.length < this.maxRequests) {
      const resolve = this.waitQueue.shift();
      this.timestamps.push(Date.now());
      resolve?.();
    }
  }
}
