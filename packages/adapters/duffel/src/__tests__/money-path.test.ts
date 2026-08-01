/**
 * DoD1: Duffel book must not blind-retry on 5xx; money path ledger enforces once.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { OutcomeUnknownError } from '@otaip/core';
import { DuffelAdapter } from '../duffel-adapter.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const PASSENGERS = [
  {
    title: 'mr' as const,
    given_name: 'Test',
    family_name: 'User',
    born_on: '1990-01-01',
    email: 't@example.com',
    phone_number: '+15555550100',
    gender: 'm' as const,
    type: 'adult' as const,
  },
];

describe('Duffel money-path book', () => {
  it('POST /air/orders is attempted exactly once on 503', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/air/offers/')) {
        return new Response(
          JSON.stringify({
            data: {
              id: 'off_1',
              total_amount: '10.00',
              total_currency: 'GBP',
              passengers: [{ id: 'pas_1', type: 'adult' }],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('/air/orders')) {
        return new Response(JSON.stringify({ errors: [{ message: 'unavailable' }] }), {
          status: 503,
          statusText: 'Service Unavailable',
        });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new DuffelAdapter({
      baseUrl: 'https://api.test.duffel.local',
      apiKey: 'duffel_test_key',
      liveMode: false,
    });

    await expect(
      adapter.book({
        offer_id: 'off_1',
        passengers: PASSENGERS,
        idempotencyKey: 'book-once-503',
      }),
    ).rejects.toBeInstanceOf(OutcomeUnknownError);

    const orderPosts = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/air/orders'),
    );
    expect(orderPosts.length).toBe(1);
  });

  it('replay same idempotency key does not POST again after unknown', async () => {
    let orderPosts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/air/offers/')) {
          return new Response(
            JSON.stringify({
              data: {
                id: 'off_1',
                total_amount: '10.00',
                total_currency: 'GBP',
                passengers: [{ id: 'pas_1', type: 'adult' }],
              },
            }),
            { status: 200 },
          );
        }
        if (url.includes('/air/orders')) {
          orderPosts += 1;
          return new Response('', { status: 503, statusText: 'Service Unavailable' });
        }
        return new Response('{}', { status: 404 });
      }),
    );

    const adapter = new DuffelAdapter({
      baseUrl: 'https://api.test.duffel.local',
 apiKey: 'duffel_test_key', liveMode: false });
    await expect(
      adapter.book({
        offer_id: 'off_1',
        passengers: PASSENGERS,
        idempotencyKey: 'book-replay',
      }),
    ).rejects.toBeInstanceOf(OutcomeUnknownError);

    await expect(
      adapter.book({
        offer_id: 'off_1',
        passengers: PASSENGERS,
        idempotencyKey: 'book-replay',
      }),
    ).rejects.toBeInstanceOf(OutcomeUnknownError);

    expect(orderPosts).toBe(1);
  });

  it('requires idempotencyKey in live mode', async () => {
    const adapter = new DuffelAdapter({
      baseUrl: 'https://api.test.duffel.local',
 apiKey: 'duffel_test_key', liveMode: true });
    await expect(
      adapter.book({ offer_id: 'off_1', passengers: PASSENGERS }),
    ).rejects.toThrow(/idempotencyKey/);
  });

  it('flight cancel confirm 503 → one confirm wire; replay → zero', async () => {
    let confirms = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/air/order_cancellations') && !url.includes('/actions/confirm')) {
          return new Response(JSON.stringify({ data: { id: 'ore_1' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('/actions/confirm')) {
          confirms += 1;
          return new Response('unavailable', { status: 503, statusText: 'Service Unavailable' });
        }
        return new Response('{}', { status: 200 });
      }),
    );
    const adapter = new DuffelAdapter({
      baseUrl: 'https://api.test.duffel.local',
      apiKey: 'duffel_test_key',
      liveMode: false,
    });
    await expect(
      adapter.cancelFlightBooking('ord_1', { idempotencyKey: 'air-cxl-1' }),
    ).rejects.toThrow(/503|unknown|reconcil/i);
    await expect(
      adapter.cancelFlightBooking('ord_1', { idempotencyKey: 'air-cxl-1' }),
    ).rejects.toThrow(/503|unknown|reconcil/i);
    expect(confirms).toBe(1);
  });
});
