/**
 * Amadeus cancel must not swallow ambiguous errors as { success: false }.
 */

import { describe, expect, it, vi } from 'vitest';
import { OutcomeUnknownError } from '@otaip/core';
import { createAdapter, GuardedConnectAdapter } from '../../../index.js';
import { AmadeusAdapter } from '../index.js';

describe('Amadeus cancel money-path', () => {
  it('ambiguous 503 delete throws — not swallowed as success:false', async () => {
    const deleteFn = vi.fn(async () => {
      throw new Error('Amadeus API error 503: unavailable');
    });
    const adapter = Object.create(AmadeusAdapter.prototype) as AmadeusAdapter;
    Object.assign(adapter, {
      supplierId: 'amadeus',
      withRetry: async (_op: string, fn: () => Promise<unknown>) => fn(),
      client: {
        booking: {
          flightOrders: () => ({ delete: deleteFn }),
        },
      },
    });

    await expect(adapter.cancelBooking('ORD-1')).rejects.toThrow(/503/);
    expect(deleteFn).toHaveBeenCalledOnce();
  });

  it('Guarded path surfaces OutcomeUnknownError on ambiguous cancel; replay zero', async () => {
    const { guardAdapter } = await import('../../../guarded-adapter.js');
    let calls = 0;
    const raw = {
      supplierId: 'amadeus-stub',
      supplierName: 'stub',
      async searchFlights() {
        return [];
      },
      async priceItinerary() {
        throw new Error('n/a');
      },
      async createBooking() {
        throw new Error('n/a');
      },
      async getBookingStatus() {
        throw new Error('n/a');
      },
      async cancelBooking() {
        calls += 1;
        throw new Error('Amadeus API error 503: unavailable');
      },
      async healthCheck() {
        return { healthy: true, latencyMs: 1 };
      },
    };
    const guarded = guardAdapter(raw, { liveMode: false });
    expect(guarded).toBeInstanceOf(GuardedConnectAdapter);
    await expect(guarded.cancelBooking('X')).rejects.toBeInstanceOf(OutcomeUnknownError);
    await expect(guarded.cancelBooking('X')).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(calls).toBe(1);
  });

  it('createAdapter registers amadeus as GuardedConnectAdapter', () => {
    const adapter = createAdapter(
      'amadeus',
      { clientId: 'id', clientSecret: 'secret', environment: 'test' },
      { liveMode: false },
    );
    expect(adapter).toBeInstanceOf(GuardedConnectAdapter);
  });
});
