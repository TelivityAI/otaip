/**
 * HAIP money-path: create/cancel once-only on ambiguous failure.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutcomeUnknownError } from '@otaip/core';
import { createAdapter, GuardedConnectAdapter } from '../../../index.js';
import { HaipAdapter } from '../index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const BOOK_PARAMS = {
  propertyId: 'prop-1',
  roomTypeId: 'rt-1',
  rateId: 'rate-1',
  checkIn: '2026-06-01',
  checkOut: '2026-06-03',
  rooms: 1,
  guest: { firstName: 'Test', lastName: 'User' },
  idempotencyKey: 'haip-book-1',
};

describe('HAIP money-path', () => {
  it('createBooking wire call once on 503; replay zero additional', async () => {
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/v1/connect/book')) {
          posts += 1;
          return new Response('unavailable', { status: 503, statusText: 'Service Unavailable' });
        }
        return new Response('{}', { status: 404 });
      }),
    );

    const adapter = new HaipAdapter(
      { baseUrl: 'http://haip.test.local', apiKey: '', timeoutMs: 1000, maxRetries: 0 },
      { liveMode: false },
    );

    await expect(adapter.createBooking(BOOK_PARAMS)).rejects.toBeInstanceOf(OutcomeUnknownError);
    await expect(adapter.createBooking(BOOK_PARAMS)).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(posts).toBe(1);
  });

  it('cancelBooking wire call once on timeout-shaped 503; replay zero', async () => {
    let deletes = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/bookings/')) {
          deletes += 1;
          return new Response('timeout', { status: 503 });
        }
        return new Response('{}', { status: 404 });
      }),
    );

    const adapter = new HaipAdapter(
      { baseUrl: 'http://haip.test.local', apiKey: '' },
      { liveMode: false },
    );

    await expect(
      adapter.cancelBooking('CONF-1', { idempotencyKey: 'haip-cxl-1' }),
    ).rejects.toBeInstanceOf(OutcomeUnknownError);
    await expect(
      adapter.cancelBooking('CONF-1', { idempotencyKey: 'haip-cxl-1' }),
    ).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(deletes).toBe(1);
  });

  it('createAdapter registers haip as GuardedConnectAdapter', () => {
    const adapter = createAdapter(
      'haip',
      { baseUrl: 'http://haip.test.local', apiKey: '' },
      { liveMode: false },
    );
    expect(adapter).toBeInstanceOf(GuardedConnectAdapter);
  });

  it('requires idempotencyKey in live mode', async () => {
    const adapter = new HaipAdapter(
      { baseUrl: 'http://haip.test.local', apiKey: '' },
      { liveMode: true },
    );
    await expect(
      adapter.createBooking({
        ...BOOK_PARAMS,
        idempotencyKey: undefined,
      }),
    ).rejects.toThrow(/idempotencyKey/);
  });
});
