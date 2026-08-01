/**
 * Navitaire money-path: commit-step 503 → one commit POST; replay → zero.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutcomeUnknownError } from '@otaip/core';
import { createAdapter, GuardedConnectAdapter } from '../../../index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const CONFIG = {
  baseUrl: 'https://navitaire.test.local',
  credentials: {
    domain: 'WW',
    username: 'user',
    password: 'pass',
  },
  defaultCurrencyCode: 'USD',
};

const bookingInput = {
  offerId: 'navitaire-journeyKey1-fareKey1',
  passengers: [
    {
      type: 'adult' as const,
      gender: 'M' as const,
      firstName: 'A',
      lastName: 'B',
      dateOfBirth: '1990-01-01',
    },
  ],
  contact: { email: 'a@b.com', phone: '+1' },
  idempotencyKey: 'nav-book-1',
};

describe('Navitaire money-path via createAdapter', () => {
  it('503 at commit → one commit POST; replay → zero', async () => {
    let commitPosts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? 'GET').toUpperCase();

        if (url.includes('/api/auth/v1/token')) {
          return new Response(
            JSON.stringify({ token: 'tok', idleTimeoutInMinutes: 60 }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (method === 'POST' && url.includes('/api/nsk/v3/booking')) {
          commitPosts += 1;
          return new Response('unavailable', { status: 503, statusText: 'Service Unavailable' });
        }

        // Prior stateful hops succeed with minimal bodies
        if (url.includes('/trip/sell') || url.includes('/passengers') || url.includes('/contacts')) {
          return new Response(JSON.stringify({ data: { passengers: { P0: {} } } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('/booking/payments')) {
          return new Response(JSON.stringify({ data: {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (method === 'GET' && url.includes('/api/nsk/v1/booking')) {
          return new Response(
            JSON.stringify({ data: { breakdown: { balanceDue: 100, totalAmount: 100 } } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const adapter = createAdapter('navitaire', CONFIG, { liveMode: false });
    expect(adapter).toBeInstanceOf(GuardedConnectAdapter);

    await expect(adapter.createBooking(bookingInput)).rejects.toBeInstanceOf(OutcomeUnknownError);
    await expect(adapter.createBooking(bookingInput)).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(commitPosts).toBe(1);
  });
});
