/**
 * Sabre money-path drills via createAdapter — 503 → one wire; replay → zero.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutcomeUnknownError } from '@otaip/core';
import { createAdapter, GuardedConnectAdapter } from '../../../index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const CONFIG = {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  environment: 'cert' as const,
};

function stubFetch503OnMutation(): { mutationPosts: () => number } {
  let mutationPosts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v2/auth/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (
        url.includes('createBooking') ||
        url.includes('fulfillFlightTickets') ||
        url.includes('cancelBooking')
      ) {
        mutationPosts += 1;
        return new Response('unavailable', { status: 503, statusText: 'Service Unavailable' });
      }
      return new Response('{}', { status: 200 });
    }),
  );
  return { mutationPosts: () => mutationPosts };
}

const bookingInput = {
  offerId: 'offer-1',
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
  idempotencyKey: 'sabre-book-1',
};

describe('Sabre money-path via createAdapter', () => {
  it('createBooking 503 → one wire; replay → zero', async () => {
    const { mutationPosts } = stubFetch503OnMutation();
    const adapter = createAdapter('sabre', CONFIG, { liveMode: false });
    expect(adapter).toBeInstanceOf(GuardedConnectAdapter);

    await expect(adapter.createBooking(bookingInput)).rejects.toBeInstanceOf(OutcomeUnknownError);
    await expect(adapter.createBooking(bookingInput)).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(mutationPosts()).toBe(1);
  });

  it('requestTicketing 503 → one wire; replay → zero', async () => {
    const { mutationPosts } = stubFetch503OnMutation();
    const adapter = createAdapter('sabre', CONFIG, { liveMode: false });

    await expect(adapter.requestTicketing!('ABC123')).rejects.toBeInstanceOf(OutcomeUnknownError);
    await expect(adapter.requestTicketing!('ABC123')).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(mutationPosts()).toBe(1);
  });

  it('cancelBooking 503 → one wire; replay → zero', async () => {
    const { mutationPosts } = stubFetch503OnMutation();
    const adapter = createAdapter('sabre', CONFIG, { liveMode: false });

    await expect(adapter.cancelBooking!('ABC123')).rejects.toBeInstanceOf(OutcomeUnknownError);
    await expect(adapter.cancelBooking!('ABC123')).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(mutationPosts()).toBe(1);
  });
});
