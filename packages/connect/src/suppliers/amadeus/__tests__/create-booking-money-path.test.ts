/**
 * Amadeus createBooking money-path — ambiguous failure → OUTCOME_UNKNOWN; replay → zero.
 */

import { describe, expect, it, vi } from 'vitest';
import { OutcomeUnknownError } from '@otaip/core';
import { GuardedConnectAdapter, guardAdapter } from '../../../index.js';

describe('Amadeus createBooking money-path', () => {
  it('Guarded createBooking 503 → one wire; replay → zero', async () => {
    let posts = 0;
    const raw = {
      supplierId: 'amadeus',
      supplierName: 'Amadeus Self-Service',
      async searchFlights() {
        return [];
      },
      async priceItinerary() {
        throw new Error('n/a');
      },
      async createBooking() {
        posts += 1;
        throw new Error('Amadeus API error 503: unavailable');
      },
      async getBookingStatus() {
        throw new Error('n/a');
      },
      async healthCheck() {
        return { healthy: true, latencyMs: 1 };
      },
    };

    const guarded = guardAdapter(raw, { liveMode: false });
    expect(guarded).toBeInstanceOf(GuardedConnectAdapter);

    const input = {
      offerId: 'amadeus-1',
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
      idempotencyKey: 'amadeus-book-1',
    };

    await expect(guarded.createBooking(input)).rejects.toBeInstanceOf(OutcomeUnknownError);
    await expect(guarded.createBooking(input)).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(posts).toBe(1);
  });
});
