/**
 * TripPro money-path: SOAP ticket/cancel use fetchOnce; cancel via withRetry.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutcomeUnknownError } from '@otaip/core';
import { createAdapter, GuardedConnectAdapter } from '../../../index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const CONFIG = {
  soapBaseUrl: 'https://trippro.test.local/soap',
  accessToken: 'tok',
  searchAccessToken: 'search-tok',
  whitelistedIp: '127.0.0.1',
};

describe('TripPro money-path SOAP', () => {
  it('CancelPNR attempted exactly once on 503 via Guarded; replay zero', async () => {
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        posts += 1;
        return new Response('unavailable', { status: 503, statusText: 'Service Unavailable' });
      }),
    );

    const adapter = createAdapter('trippro', CONFIG, { liveMode: false });
    expect(adapter).toBeInstanceOf(GuardedConnectAdapter);

    await expect(adapter.cancelBooking!('ABC123')).rejects.toBeInstanceOf(OutcomeUnknownError);
    await expect(adapter.cancelBooking!('ABC123')).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(posts).toBe(1);
  });

  it('OrderTicket attempted exactly once on 503 via Guarded', async () => {
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        posts += 1;
        return new Response('unavailable', { status: 503, statusText: 'Service Unavailable' });
      }),
    );

    const adapter = createAdapter('trippro', CONFIG, { liveMode: false });
    await expect(adapter.requestTicketing!('ABC123')).rejects.toBeInstanceOf(OutcomeUnknownError);
    await expect(adapter.requestTicketing!('ABC123')).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(posts).toBe(1);
  });
});
