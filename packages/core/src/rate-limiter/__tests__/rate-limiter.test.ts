import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within the limit', async () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(limiter.available).toBe(0);
    expect(limiter.isAtLimit).toBe(true);
  });

  it('reports correct availability', () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });
    expect(limiter.available).toBe(5);
    expect(limiter.isAtLimit).toBe(false);
  });

  it('replenishes tokens after window expires', async () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 });

    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.available).toBe(0);

    vi.advanceTimersByTime(1001);
    expect(limiter.available).toBe(2);
  });

  it('waits when at limit and resolves after window', async () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 500 });

    await limiter.acquire();

    let resolved = false;
    const waitPromise = limiter.acquire().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    vi.advanceTimersByTime(501);
    await waitPromise;

    expect(resolved).toBe(true);
  });

  it('resets clears all tracked requests', async () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 });

    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.available).toBe(0);

    limiter.reset();
    expect(limiter.available).toBe(2);
  });

  it('handles high throughput scenarios', async () => {
    const limiter = new RateLimiter({ maxRequests: 10, windowMs: 1000 });

    for (let i = 0; i < 10; i++) {
      await limiter.acquire();
    }

    expect(limiter.available).toBe(0);
    expect(limiter.isAtLimit).toBe(true);

    // Advance past window — all tokens should be available again
    vi.advanceTimersByTime(1001);
    expect(limiter.available).toBe(10);
  });

  it('10 concurrent acquires with maxRequests:1 never exceed 1 dispatch per window', async () => {
    vi.useRealTimers();
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 50 });
    let inFlight = 0;
    let maxInFlight = 0;
    const dispatch = async (): Promise<void> => {
      await limiter.acquire();
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
    };
    await Promise.all(Array.from({ length: 10 }, () => dispatch()));
    expect(maxInFlight).toBe(1);
  });
});
