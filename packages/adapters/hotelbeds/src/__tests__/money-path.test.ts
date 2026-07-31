/**
 * Hotelbeds money-path: fetchOnce on book/hard-cancel; ledger once-only.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutcomeUnknownError } from '@otaip/core';
import { HotelbedsAdapter } from '../hotelbeds-adapter.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const BOOK_BODY = {
  holder: { name: 'Test', surname: 'User' },
  rooms: [
    {
      rateKey: 'rk-1',
      paxes: [{ roomId: 1, type: 'AD' as const, name: 'Test', surname: 'User' }],
    },
  ],
  clientReference: 'AVR-1',
};

describe('Hotelbeds money-path book', () => {
  it('POST /bookings attempted exactly once on 503', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { message: 'unavailable' } }), {
        status: 503,
        statusText: 'Service Unavailable',
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new HotelbedsAdapter({
      apiKey: 'k',
      secret: 's',
      environment: 'test',
      liveMode: false,
    });

    await expect(
      adapter.book(BOOK_BODY, { idempotencyKey: 'hb-book-503' }),
    ).rejects.toBeInstanceOf(OutcomeUnknownError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('replay same idempotency key does not POST again after unknown', async () => {
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        posts += 1;
        return new Response('', { status: 503, statusText: 'Service Unavailable' });
      }),
    );

    const adapter = new HotelbedsAdapter({
      apiKey: 'k',
      secret: 's',
      environment: 'test',
      liveMode: false,
    });

    await expect(
      adapter.book(BOOK_BODY, { idempotencyKey: 'hb-book-replay' }),
    ).rejects.toBeInstanceOf(OutcomeUnknownError);
    await expect(
      adapter.book(BOOK_BODY, { idempotencyKey: 'hb-book-replay' }),
    ).rejects.toBeInstanceOf(OutcomeUnknownError);

    expect(posts).toBe(1);
  });

  it('requires idempotencyKey in live mode', async () => {
    const adapter = new HotelbedsAdapter({
      apiKey: 'k',
      secret: 's',
      environment: 'test',
      liveMode: true,
    });
    await expect(adapter.book(BOOK_BODY)).rejects.toThrow(/idempotencyKey/);
  });

  it('production environment forces live (cannot override off)', () => {
    const adapter = new HotelbedsAdapter({
      apiKey: 'k',
      secret: 's',
      environment: 'production',
      liveMode: false,
    });
    expect(adapter.moneyPathExecutor.safetyConfig.liveMode).toBe(true);
  });

  it('hard cancel CANCELLATION is once-only on 503', async () => {
    let deletes = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        deletes += 1;
        return new Response('', { status: 503, statusText: 'Service Unavailable' });
      }),
    );
    const adapter = new HotelbedsAdapter({
      apiKey: 'k',
      secret: 's',
      environment: 'test',
      liveMode: false,
    });
    await expect(
      adapter.cancelBooking('REF1', 'CANCELLATION', { idempotencyKey: 'hb-cxl' }),
    ).rejects.toBeInstanceOf(OutcomeUnknownError);
    await expect(
      adapter.cancelBooking('REF1', 'CANCELLATION', { idempotencyKey: 'hb-cxl' }),
    ).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(deletes).toBe(1);
  });
});
