import { describe, it, expect } from 'vitest';
import { OutcomeUnknownError } from '@otaip/core';
import { GuardedConnectAdapter, guardAdapter } from '../guarded-adapter.js';
import { createAdapter, registerSupplier } from '../suppliers/index.js';
import type { ConnectAdapter, CreateBookingInput, BookingResult } from '../types.js';
import { ConnectError } from '../base-adapter.js';

function mkAdapter(createFn: ConnectAdapter['createBooking']): ConnectAdapter {
  return {
    supplierId: 'test',
    supplierName: 'Test',
    searchFlights: async () => [],
    priceItinerary: async () => ({
      offerId: 'o',
      supplier: 'test',
      totalPrice: { amount: '1', currency: 'USD' },
      fares: [],
      fareRules: { refundable: false, changeable: false },
      priceChanged: false,
      available: true,
    }),
    createBooking: createFn,
    getBookingStatus: async () => ({
      bookingId: 'B1',
      supplier: 'test',
      status: 'confirmed',
      segments: [],
      passengers: [],
      totalPrice: { amount: '1', currency: 'USD' },
    }),
    cancelBooking: async () => ({ success: true, message: 'ok' }),
    healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
  };
}

const bookingInput: CreateBookingInput = {
  offerId: 'off_1',
  passengers: [
    {
      type: 'adult',
      gender: 'M',
      firstName: 'A',
      lastName: 'B',
      dateOfBirth: '1990-01-01',
    },
  ],
  contact: { email: 'a@b.com', phone: '+1' },
  idempotencyKey: 'idem-1',
};

const bookingResult: BookingResult = {
  bookingId: 'B1',
  supplier: 'test',
  status: 'confirmed',
  segments: [],
  passengers: bookingInput.passengers,
  totalPrice: { amount: '10', currency: 'USD' },
};

describe('GuardedConnectAdapter', () => {
  it('requires idempotencyKey', async () => {
    const guarded = new GuardedConnectAdapter({
      adapter: mkAdapter(async () => bookingResult),
      liveMode: false,
    });
    await expect(
      guarded.createBooking({ ...bookingInput, idempotencyKey: undefined }),
    ).rejects.toThrow(/idempotencyKey/);
  });

  it('does not re-invoke supplier on same idempotency key', async () => {
    let calls = 0;
    const guarded = new GuardedConnectAdapter({
      adapter: mkAdapter(async () => {
        calls += 1;
        return bookingResult;
      }),
      liveMode: false,
    });
    await guarded.createBooking(bookingInput);
    await guarded.createBooking(bookingInput);
    expect(calls).toBe(1);
  });

  it('throws OutcomeUnknownError on ambiguous 503 without retrying', async () => {
    let calls = 0;
    const guarded = new GuardedConnectAdapter({
      adapter: mkAdapter(async () => {
        calls += 1;
        throw new ConnectError('createBooking failed: 503', 'test', 'createBooking', true);
      }),
      liveMode: false,
    });
    await expect(guarded.createBooking(bookingInput)).rejects.toBeInstanceOf(
      OutcomeUnknownError,
    );
    expect(calls).toBe(1);
  });
});

describe('createAdapter default guard', () => {
  it('wraps with GuardedConnectAdapter by default; unguarded opt-out', () => {
    registerSupplier('guard-test-supplier', () => mkAdapter(async () => bookingResult));
    const raw = createAdapter('guard-test-supplier', {}, { unguarded: true });
    expect(raw).not.toBeInstanceOf(GuardedConnectAdapter);
    const guarded = createAdapter('guard-test-supplier', {}, { liveMode: false });
    expect(guarded).toBeInstanceOf(GuardedConnectAdapter);
    expect(guardAdapter(raw, { liveMode: false })).toBeInstanceOf(GuardedConnectAdapter);
  });
});
