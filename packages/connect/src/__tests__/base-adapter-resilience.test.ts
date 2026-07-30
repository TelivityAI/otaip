import { describe, it, expect } from 'vitest';
import { BaseAdapter, ConnectError } from '../base-adapter.js';

class TestAdapter extends BaseAdapter {
  protected readonly supplierId = 'test';

  constructor() {
    super(
      { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2 },
      { rateLimiter: { maxRequests: 100, windowMs: 1000 }, circuitBreaker: { failureThreshold: 2, resetMs: 50 } },
    );
  }

  runSafe(fn: () => Promise<string>) {
    return this.withRetry('searchFlights', fn);
  }

  runUnsafe(fn: () => Promise<string>) {
    return this.withRetry('createBooking', fn);
  }

  exposeFetch(url: string, init: RequestInit) {
    return this.fetchWithTimeout(url, init, 1000);
  }
}

describe('BaseAdapter resilience', () => {
  it('does not auto-retry unsafe operations', async () => {
    const adapter = new TestAdapter();
    let calls = 0;
    await expect(
      adapter.runUnsafe(async () => {
        calls += 1;
        throw new ConnectError('fail', 'test', 'createBooking', true);
      }),
    ).rejects.toBeInstanceOf(ConnectError);
    expect(calls).toBe(1);
  });

  it('retries safe operations when retryable', async () => {
    const adapter = new TestAdapter();
    let calls = 0;
    const result = await adapter.runSafe(async () => {
      calls += 1;
      if (calls < 2) {
        throw new Error('fetch failed');
      }
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('opens circuit after transport failures', async () => {
    const adapter = new TestAdapter();
    for (let i = 0; i < 2; i++) {
      await expect(
        adapter.runSafe(async () => {
          throw new Error('fetch failed');
        }),
      ).rejects.toBeTruthy();
    }
    expect(adapter.getCircuitBreakerStatus().state).toBe('open');
  });
});
