/**
 * MockHotelbedsAdapter — Activities + Transfers in-memory behavior.
 *
 * No network, no fetch mocks. Verifies the mock adapter exposes the same
 * surface as the live adapter and that book/cancel state is consistent.
 */

import { describe, expect, it } from 'vitest';
import { MockHotelbedsAdapter } from '../mock-hotelbeds-adapter.js';

describe('MockHotelbedsAdapter — Activities', () => {
  it('returns synthetic activities for known destinations', async () => {
    const adapter = new MockHotelbedsAdapter();
    const offers = await adapter.searchActivities({
      destination: 'BCN',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-03',
      paxes: { adults: 2 },
    });
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0]!.activityCode).toBe('E-A10-000100301');
    expect(offers[0]!.modalities[0]!.price).toEqual({
      amount: '45.00',
      currency: 'EUR',
    });
  });

  it('returns an empty array for unknown destinations', async () => {
    const adapter = new MockHotelbedsAdapter();
    const offers = await adapter.searchActivities({
      destination: 'UNK',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-03',
      paxes: { adults: 1 },
    });
    expect(offers).toEqual([]);
  });

  it('book → cancel round-trips on a deterministic reference', async () => {
    const adapter = new MockHotelbedsAdapter();
    const booking = await adapter.bookActivity({
      activityCode: 'E-A10-000100301',
      modalityCode: 'TOUR_GUIDE|EN|1',
      date: '2026-06-01',
      paxes: [{ age: 30 }, { age: 28 }],
      holder: { name: 'Ada', surname: 'Lovelace' },
      clientReference: 'AVR-MOCK-1',
    });
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.bookingReference).toMatch(/^MOCK-ACT-\d{6}$/);

    const cancellation = await adapter.cancelActivity(booking.bookingReference);
    expect(cancellation.status).toBe('CANCELLED');
    expect(cancellation.cancellationReference).toBe(`CXL-${booking.bookingReference}`);
  });

  it('cancelling an unknown reference throws', async () => {
    const adapter = new MockHotelbedsAdapter();
    await expect(adapter.cancelActivity('does-not-exist')).rejects.toThrow(/unknown/);
  });

  it('rejects pre-aborted searchActivities calls', async () => {
    const adapter = new MockHotelbedsAdapter();
    const ac = new AbortController();
    ac.abort();
    await expect(
      adapter.searchActivities({
        destination: 'BCN',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-02',
        paxes: { adults: 1 },
        signal: ac.signal,
      }),
    ).rejects.toThrow(/aborted/);
  });

  it('respects setAvailable(false) for activities flow', async () => {
    const adapter = new MockHotelbedsAdapter();
    adapter.setAvailable(false);
    await expect(
      adapter.searchActivities({
        destination: 'BCN',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-02',
        paxes: { adults: 1 },
      }),
    ).rejects.toThrow(/not available/);
  });
});

describe('MockHotelbedsAdapter — Transfers', () => {
  it('returns synthetic transfers keyed on the from-location', async () => {
    const adapter = new MockHotelbedsAdapter();
    const offers = await adapter.searchTransfers({
      from: { type: 'IATA', code: 'BCN' },
      to: { type: 'ATLAS', code: '1234' },
      outboundDate: '2026-06-01',
      outboundTime: '14:30',
      adults: 2,
    });
    expect(offers.length).toBeGreaterThan(0);
    const types = offers.map((o) => o.transferType);
    expect(types).toContain('PRIVATE');
    expect(types).toContain('SHARED');
  });

  it('returns empty for an unknown from-location', async () => {
    const adapter = new MockHotelbedsAdapter();
    const offers = await adapter.searchTransfers({
      from: { type: 'IATA', code: 'XYZ' },
      to: { type: 'ATLAS', code: '0' },
      outboundDate: '2026-06-01',
      outboundTime: '14:30',
      adults: 1,
    });
    expect(offers).toEqual([]);
  });

  it('book → cancel round-trips on a deterministic reference', async () => {
    const adapter = new MockHotelbedsAdapter();
    const booking = await adapter.bookTransfer({
      transferCode: 'mock-trf-BCN-private-sedan',
      holder: { name: 'Ada', surname: 'Lovelace' },
      passengers: [{ type: 'ADULT', name: 'Ada', surname: 'Lovelace' }],
      clientReference: 'AVR-MOCK-T-1',
    });
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.bookingReference).toMatch(/^MOCK-TRF-\d{6}$/);
    expect(booking.pickupDetails.location).toBeTruthy();

    const cancellation = await adapter.cancelTransfer(booking.bookingReference);
    expect(cancellation.status).toBe('CANCELLED');
    expect(cancellation.cancellationReference).toBe(`CXL-${booking.bookingReference}`);
  });
});
