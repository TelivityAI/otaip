import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchOnce } from '../fetch-once.js';

const originalFetch = globalThis.fetch;

function mockFetch(impl: typeof fetch): void {
  globalThis.fetch = impl as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchOnce', () => {
  it('returns response without retrying 5xx', async () => {
    const fn = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    mockFetch(fn);

    const res = await fetchOnce('https://example.test/book');
    expect(res.status).toBe(503);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry network errors', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    mockFetch(fn);

    await expect(fetchOnce('https://example.test/book')).rejects.toThrow(/fetch failed/);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
