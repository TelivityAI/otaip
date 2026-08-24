/**
 * Mapper + fixture tests for Hotelbeds Activities / Transfers DQ close-outs (#149).
 *
 * Fixtures are redacted shapes derived from official developer.hotelbeds.com
 * docs — no API keys. Unresolved DQs stay open in the KB.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  mapActivityAvailability,
  mapActivityBookingResponse,
  mapActivityCancellation,
} from '../activities-mapper.js';
import type {
  HotelbedsActivitiesAvailabilityResponse,
  HotelbedsActivitiesBookingResponse,
  HotelbedsActivitiesCancellationResponse,
} from '../activities-types.js';
import {
  mapTransferAvailability,
  mapTransferBookingResponse,
} from '../transfers-mapper.js';
import type {
  HotelbedsTransfersAvailabilityResponse,
  HotelbedsTransfersBookingResponse,
} from '../transfers-types.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../__fixtures__');

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

describe('Activities fixtures — cancellation policy + booking status (DQ-A3/A5)', () => {
  it('maps NOR/NRF rateClass and stepped cancellationPolicies from recorded fixture', () => {
    const raw = loadJson<HotelbedsActivitiesAvailabilityResponse>(
      'activities-availability-cancellation-policies.json',
    );
    const offers = mapActivityAvailability(raw);
    expect(offers).toHaveLength(2);

    const nor = offers[0]!;
    expect(nor.cancellationPolicy).toBe('NOR');
    expect(nor.cancellationPolicies).toEqual([
      { dateFrom: '2026-06-09T00:00:00.000Z', amount: '45.00' },
    ]);
    expect(nor.modalities[0]!.price).toEqual({ amount: '45.00', currency: 'EUR' });
    expect(nor.modalities[0]!.boxOfficePrice).toEqual({ amount: '55.00', currency: 'EUR' });

    const nrf = offers[1]!;
    expect(nrf.cancellationPolicy).toBe('NRF');
    expect(nrf.cancellationPolicies).toBeUndefined();
  });

  it('maps PRECONFIRMED distinctly from CONFIRMED (not ON_REQUEST)', () => {
    const raw = loadJson<HotelbedsActivitiesBookingResponse>(
      'activities-booking-preconfirmed.json',
    );
    const result = mapActivityBookingResponse(raw);
    expect(result.status).toBe('PRECONFIRMED');
    expect(result.bookingReference).toBe('102-6112608');
  });

  it('maps CONFIRMED booking and prefers brief voucherUrl', () => {
    const raw = loadJson<HotelbedsActivitiesBookingResponse>(
      'activities-booking-confirmed.json',
    );
    const result = mapActivityBookingResponse(raw);
    expect(result.status).toBe('CONFIRMED');
    expect(result.voucherUrl).toBe(
      'https://example.invalid/vouchers/102-123456798.pdf',
    );
  });

  it('maps cancel SIMULATION fixture to CANCELLED + cancellationReference', () => {
    const raw = loadJson<HotelbedsActivitiesCancellationResponse>(
      'activities-cancel-simulation.json',
    );
    expect(mapActivityCancellation(raw)).toEqual({
      status: 'CANCELLED',
      cancellationReference: 'CXL-102-123456798',
    });
  });

  it('rejects unsupported ON_REQUEST on Activities confirm (DQ-A3 CLOSED)', () => {
    const raw = loadJson<HotelbedsActivitiesBookingResponse>(
      'unsupported-on-request-booking.json',
    );
    expect(() => mapActivityBookingResponse(raw)).toThrow(/ON_REQUEST|unsupported status/i);
  });
});

describe('Transfers fixtures — cancellation policies + pricing (DQ-T4/T5/T6/T7)', () => {
  it('maps official services[] price + destination-local cancellationPolicies', () => {
    const raw = loadJson<HotelbedsTransfersAvailabilityResponse>(
      'transfers-availability-cancellation-policies.json',
    );
    const offers = mapTransferAvailability(raw);
    expect(offers).toHaveLength(2);

    const shared = offers[0]!;
    expect(shared.transferType).toBe('SHARED');
    expect(shared.maxPassengers).toBe(99);
    // netAmount null → fall back to totalAmount
    expect(shared.price).toEqual({ amount: '24.28', currency: 'EUR' });
    expect(shared.pickupInfo.time).toBe('10:00:00');
    expect(shared.cancellationPolicies).toEqual([
      {
        amount: '24.28',
        from: '2026-05-07T10:00:00',
        currencyId: 'EUR',
        utcOffset: '+02:00',
      },
    ]);

    const priv = offers[1]!;
    expect(priv.price).toEqual({ amount: '48.60', currency: 'EUR' });
    expect(priv.totalPrice).toEqual({ amount: '54.00', currency: 'EUR' });
  });

  it('maps brief-shape booking CONFIRMED pickup wrapper', () => {
    // Adapter book response uses booking.pickup brief shape (not full bookings[]).
    const brief: HotelbedsTransfersBookingResponse = {
      booking: {
        reference: '102-20100194',
        clientReference: 'AVR-TRF-001',
        status: 'CONFIRMED',
        pickup: {
          location: 'Barcelona Airport',
          time: '10:00:00',
          instructions: 'Driver will meet in arrivals (fixture).',
        },
      },
    };
    const result = mapTransferBookingResponse(brief);
    expect(result.status).toBe('CONFIRMED');
    expect(result.pickupDetails.time).toBe('10:00:00');
  });

  it('rejects unsupported ON_REQUEST on Transfers confirm (DQ-T6 CLOSED)', () => {
    const raw = loadJson<HotelbedsTransfersBookingResponse>(
      'unsupported-on-request-booking.json',
    );
    expect(() => mapTransferBookingResponse(raw)).toThrow(/ON_REQUEST|unsupported status/i);
  });
});
