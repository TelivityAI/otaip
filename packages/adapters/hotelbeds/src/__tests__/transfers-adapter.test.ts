/**
 * HotelbedsAdapter — Transfers API unit tests with mocked fetch.
 *
 * No real network. Validates path routing to /transfer-api/1.0, body shape
 * (IATA/ATLAS/GPS location encoding, outbound date/time), mapper output,
 * and abort-signal handling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HotelbedsAdapter } from '../hotelbeds-adapter.js';
import type {
  HotelbedsTransfersAvailabilityResponse,
  HotelbedsTransfersBookingResponse,
  HotelbedsTransfersCancellationResponse,
} from '../transfers-types.js';

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function captureFetch(responses: Array<{ status: number; body: unknown }>): {
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses[i++];
      if (!r) throw new Error(`Unexpected fetch call #${i}: ${url}`);
      return Promise.resolve({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        statusText: r.status === 200 ? 'OK' : 'Error',
        json: () => Promise.resolve(r.body),
      });
    }),
  );
  return { calls };
}

const AVAIL_RESPONSE: HotelbedsTransfersAvailabilityResponse = {
  transfers: [
    {
      transferCode: 'trf-bcn-priv-sedan',
      transferType: 'PRIVATE',
      vehicleType: 'Sedan',
      maxPassengers: 3,
      amount: '54.00',
      currency: 'EUR',
      pickupInformation: {
        pickup: { location: 'BCN T1 Arrivals', time: '14:30' },
        dropoff: { location: 'Hotel Avenida Palace', estimatedTime: '15:30' },
      },
      cancellationPolicy: 'Free cancellation up to 48h before pickup.',
    },
    {
      transferCode: 'trf-bcn-shared-shuttle',
      transferType: 'SHARED',
      vehicleType: 'Shuttle 8pax',
      maxPassengers: 8,
      amount: '12.00',
      currency: 'EUR',
      pickupInformation: {
        pickup: { location: 'BCN T1 Arrivals (Shared)', time: '15:00' },
        dropoff: { location: 'Hotel Avenida Palace', estimatedTime: '16:15' },
      },
      cancellationPolicy: 'Non-refundable.',
    },
  ],
};

const BOOKING_RESPONSE: HotelbedsTransfersBookingResponse = {
  booking: {
    reference: 'HB-TRF-3001',
    clientReference: 'AVR-TRF-001',
    status: 'CONFIRMED',
    pickup: {
      location: 'BCN T1 Arrivals',
      time: '14:30',
      instructions: 'Driver will hold a sign with passenger surname.',
    },
  },
};

const CANCELLATION_RESPONSE: HotelbedsTransfersCancellationResponse = {
  booking: {
    reference: 'HB-TRF-3001',
    cancellationReference: 'CXL-HB-TRF-3001',
    status: 'CANCELLED',
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HotelbedsAdapter.searchTransfers', () => {
  let adapter: HotelbedsAdapter;
  beforeEach(() => {
    adapter = new HotelbedsAdapter({ apiKey: 'test-key', secret: 'test-secret' });
  });

  it('hits /transfer-api/1.0/availability with the brief-shape body', async () => {
    const { calls } = captureFetch([{ status: 200, body: AVAIL_RESPONSE }]);

    await adapter.searchTransfers({
      from: { type: 'IATA', code: 'BCN' },
      to: { type: 'ATLAS', code: '1234' },
      outboundDate: '2026-06-01',
      outboundTime: '14:30',
      adults: 2,
      children: 0,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://api.test.hotelbeds.com/transfer-api/1.0/availability',
    );
    expect(calls[0]!.init.method).toBe('POST');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toEqual({
      language: 'en',
      from: { type: 'IATA', code: 'BCN' },
      to: { type: 'ATLAS', code: '1234' },
      outbound: { date: '2026-06-01', time: '14:30' },
      adults: 2,
      children: 0,
    });
  });

  it('attaches Hotelbeds auth headers', async () => {
    const { calls } = captureFetch([{ status: 200, body: AVAIL_RESPONSE }]);
    await adapter.searchTransfers({
      from: { type: 'IATA', code: 'BCN' },
      to: { type: 'ATLAS', code: '1234' },
      outboundDate: '2026-06-01',
      outboundTime: '14:30',
      adults: 1,
    });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Api-key']).toBe('test-key');
    expect(headers['X-Signature']).toMatch(/^[a-f0-9]{64}$/);
  });

  it('omits children when undefined', async () => {
    const { calls } = captureFetch([{ status: 200, body: AVAIL_RESPONSE }]);
    await adapter.searchTransfers({
      from: { type: 'IATA', code: 'BCN' },
      to: { type: 'ATLAS', code: '1234' },
      outboundDate: '2026-06-01',
      outboundTime: '14:30',
      adults: 2,
    });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.children).toBeUndefined();
  });

  it('maps the response to the canonical TransferOffer shape', async () => {
    captureFetch([{ status: 200, body: AVAIL_RESPONSE }]);
    const offers = await adapter.searchTransfers({
      from: { type: 'IATA', code: 'BCN' },
      to: { type: 'ATLAS', code: '1234' },
      outboundDate: '2026-06-01',
      outboundTime: '14:30',
      adults: 2,
    });
    expect(offers).toHaveLength(2);

    const first = offers[0]!;
    expect(first.transferCode).toBe('trf-bcn-priv-sedan');
    expect(first.transferType).toBe('PRIVATE');
    expect(first.vehicleType).toBe('Sedan');
    expect(first.maxPassengers).toBe(3);
    expect(first.price).toEqual({ amount: '54.00', currency: 'EUR' });
    expect(first.pickupInfo).toEqual({ location: 'BCN T1 Arrivals', time: '14:30' });
    expect(first.dropoffInfo).toEqual({
      location: 'Hotel Avenida Palace',
      estimatedTime: '15:30',
    });
    expect(first.cancellationPolicy).toBe('Free cancellation up to 48h before pickup.');
  });

  it('passes through unknown transferType strings rather than coercing', async () => {
    captureFetch([
      {
        status: 200,
        body: {
          transfers: [
            {
              transferCode: 'wild',
              transferType: 'OFF_ROAD',
              amount: '99.00',
              currency: 'EUR',
              maxPassengers: 4,
              vehicleType: 'Jeep',
              pickupInformation: {},
              cancellationPolicy: '',
            },
          ],
        },
      },
    ]);
    const offers = await adapter.searchTransfers({
      from: { type: 'IATA', code: 'BCN' },
      to: { type: 'ATLAS', code: '1234' },
      outboundDate: '2026-06-01',
      outboundTime: '14:30',
      adults: 1,
    });
    expect(offers[0]!.transferType).toBe('OFF_ROAD');
  });

  it('aborts pre-flight when an aborted signal is supplied', async () => {
    captureFetch([]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      adapter.searchTransfers({
        from: { type: 'IATA', code: 'BCN' },
        to: { type: 'ATLAS', code: '1234' },
        outboundDate: '2026-06-01',
        outboundTime: '14:30',
        adults: 1,
        signal: ac.signal,
      }),
    ).rejects.toThrow(/aborted/);
  });

  it('returns empty array when no transfers found', async () => {
    captureFetch([{ status: 200, body: { transfers: [] } }]);
    const offers = await adapter.searchTransfers({
      from: { type: 'IATA', code: 'XYZ' },
      to: { type: 'ATLAS', code: '0' },
      outboundDate: '2026-06-01',
      outboundTime: '14:30',
      adults: 1,
    });
    expect(offers).toEqual([]);
  });

  it('passes GPS lat,lon codes through verbatim (DQ-T2 CLOSED — ≥3 decimals)', async () => {
    const { calls } = captureFetch([{ status: 200, body: AVAIL_RESPONSE }]);
    await adapter.searchTransfers({
      from: { type: 'GPS', code: '41.4036, 2.1744' },
      to: { type: 'ATLAS', code: '1234' },
      outboundDate: '2026-06-01',
      outboundTime: '14:30',
      adults: 1,
    });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.from).toEqual({ type: 'GPS', code: '41.4036, 2.1744' });
  });

  it('maps official services[] price.netAmount / cancellationPolicies when present', async () => {
    captureFetch([
      {
        status: 200,
        body: {
          services: [
            {
              rateKey: 'rate-key-redacted',
              transferType: 'PRIVATE',
              vehicle: { name: 'Car' },
              maxPaxCapacity: 3,
              price: { totalAmount: 54, netAmount: 48.6, currencyId: 'EUR' },
              pickupInformation: {
                from: { description: 'BCN T1' },
                time: '10:00:00',
                to: { description: 'Hotel' },
              },
              cancellationPolicies: [
                {
                  amount: 54,
                  from: '2026-05-07T10:00:00',
                  utcOffset: '+02:00',
                  currencyId: 'EUR',
                },
              ],
            },
          ],
        },
      },
    ]);
    const offers = await adapter.searchTransfers({
      from: { type: 'IATA', code: 'BCN' },
      to: { type: 'ATLAS', code: '57' },
      outboundDate: '2026-05-08',
      outboundTime: '10:00',
      adults: 2,
    });
    expect(offers[0]!.price).toEqual({ amount: '48.60', currency: 'EUR' });
    expect(offers[0]!.totalPrice).toEqual({ amount: '54.00', currency: 'EUR' });
    expect(offers[0]!.pickupInfo.time).toBe('10:00:00');
    expect(offers[0]!.cancellationPolicies?.[0]?.utcOffset).toBe('+02:00');
  });
});

describe('HotelbedsAdapter.bookTransfer', () => {
  let adapter: HotelbedsAdapter;
  beforeEach(() => {
    adapter = new HotelbedsAdapter({ apiKey: 'test-key', secret: 'test-secret' });
  });

  it('posts /bookings with the brief-shape body', async () => {
    const { calls } = captureFetch([{ status: 200, body: BOOKING_RESPONSE }]);
    await adapter.bookTransfer({
      transferCode: 'trf-bcn-priv-sedan',
      holder: { name: 'John', surname: 'Smith' },
      passengers: [{ type: 'ADULT', name: 'John', surname: 'Smith' }],
      clientReference: 'AVR-TRF-001',
    });
    expect(calls[0]!.url).toBe('https://api.test.hotelbeds.com/transfer-api/1.0/bookings');
    expect(calls[0]!.init.method).toBe('POST');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toEqual({
      transferCode: 'trf-bcn-priv-sedan',
      holder: { name: 'John', surname: 'Smith' },
      passengers: [{ type: 'ADULT', name: 'John', surname: 'Smith' }],
      clientReference: 'AVR-TRF-001',
    });
  });

  it('returns the canonical CONFIRMED response with pickup details', async () => {
    captureFetch([{ status: 200, body: BOOKING_RESPONSE }]);
    const result = await adapter.bookTransfer({
      transferCode: 'trf-bcn-priv-sedan',
      holder: { name: 'John', surname: 'Smith' },
      passengers: [{ type: 'ADULT', name: 'John', surname: 'Smith' }],
      clientReference: 'AVR-TRF-001',
    });
    expect(result).toEqual({
      bookingReference: 'HB-TRF-3001',
      status: 'CONFIRMED',
      clientReference: 'AVR-TRF-001',
      pickupDetails: {
        location: 'BCN T1 Arrivals',
        time: '14:30',
        instructions: 'Driver will hold a sign with passenger surname.',
      },
    });
  });

  it('preserves ON_REQUEST when present (DQ-T6 OPEN — Transfers-specific)', async () => {
    captureFetch([
      {
        status: 200,
        body: {
          booking: {
            reference: 'HB-TRF-3002',
            clientReference: 'AVR-TRF-002',
            status: 'ON_REQUEST',
            pickup: { location: 'TBD', time: 'TBD' },
          },
        },
      },
    ]);
    const result = await adapter.bookTransfer({
      transferCode: 'trf-onreq',
      holder: { name: 'Jane', surname: 'Doe' },
      passengers: [{ type: 'ADULT', name: 'Jane', surname: 'Doe' }],
      clientReference: 'AVR-TRF-002',
    });
    expect(result.status).toBe('ON_REQUEST');
  });

  it('accepts MODIFIED booking status from official Transfers enum', async () => {
    captureFetch([
      {
        status: 200,
        body: {
          booking: {
            reference: 'HB-TRF-3003',
            clientReference: 'AVR-TRF-003',
            status: 'MODIFIED',
            pickup: { location: 'BCN T1', time: '11:00:00' },
          },
        },
      },
    ]);
    const result = await adapter.bookTransfer({
      transferCode: 'trf-mod',
      holder: { name: 'Jane', surname: 'Doe' },
      passengers: [{ type: 'ADULT', name: 'Jane', surname: 'Doe' }],
      clientReference: 'AVR-TRF-003',
    });
    expect(result.status).toBe('MODIFIED');
  });
});

describe('HotelbedsAdapter.cancelTransfer', () => {
  let adapter: HotelbedsAdapter;
  beforeEach(() => {
    adapter = new HotelbedsAdapter({ apiKey: 'test-key', secret: 'test-secret' });
  });

  it('simulation hits documented DELETE path with simulation=true', async () => {
    const { calls } = captureFetch([{ status: 200, body: CANCELLATION_RESPONSE }]);
    const result = await adapter.cancelTransfer('HB-TRF-3001', { simulation: true });
    expect(result).toEqual({
      status: 'CANCELLED',
      cancellationReference: 'CXL-HB-TRF-3001',
    });
    expect(calls[0]!.url).toContain(
      '/transfer-api/1.0/bookings/en/reference/HB-TRF-3001?simulation=true',
    );
    expect(calls[0]!.init.method).toBe('DELETE');
  });

  it('hard cancel 503 → one wire; replay → zero', async () => {
    let deletes = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        deletes += 1;
        return {
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          json: async () => ({}),
        };
      }),
    );
    await expect(
      adapter.cancelTransfer('HB-TRF-3001', { idempotencyKey: 'trf-cxl-1' }),
    ).rejects.toThrow(/503|unknown|reconcil/i);
    await expect(
      adapter.cancelTransfer('HB-TRF-3001', { idempotencyKey: 'trf-cxl-1' }),
    ).rejects.toThrow(/503|unknown|reconcil/i);
    expect(deletes).toBe(1);
  });
});
