/**
 * DuffelAdapter — Unit Tests
 *
 * All tests use mocked fetch — no real network calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DuffelAdapter,
  mapOrderToBookResponse,
  parseDurationToMinutes,
  type DuffelOrder,
} from '../duffel-adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(body),
    }),
  );
}

function mockFetchNetworkError(message: string): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(message)));
}

const DUFFEL_OFFER = {
  id: 'off_test_123',
  slices: [
    {
      segments: [
        {
          marketing_carrier: { iata_code: 'BA' },
          operating_carrier: { iata_code: 'BA' },
          marketing_carrier_flight_number: '115',
          origin: { iata_code: 'LHR' },
          destination: { iata_code: 'JFK' },
          departing_at: '2026-06-15T10:00:00',
          arriving_at: '2026-06-15T13:30:00',
          duration: 'PT7H30M',
          aircraft: { name: '787-9' },
          passengers: [{ cabin_class: 'economy', fare_basis_code: 'Y26NR' }],
        },
      ],
      duration: 'PT7H30M',
    },
  ],
  total_amount: '595.50',
  total_currency: 'GBP',
  base_amount: '450.00',
  tax_amount: '145.50',
  passengers: [{ type: 'adult', fare_basis_codes: [{ fare_basis_code: 'Y26NR' }] }],
  expires_at: '2026-06-14T23:59:59Z',
  payment_requirements: { requires_instant_payment: true },
};

const SEARCH_REQUEST = {
  segments: [{ origin: 'LHR', destination: 'JFK', departure_date: '2026-06-15' }],
  passengers: [{ type: 'ADT' as const, count: 1 }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// parseDurationToMinutes
// ---------------------------------------------------------------------------

describe('parseDurationToMinutes', () => {
  it('parses PT7H30M to 450', () => {
    expect(parseDurationToMinutes('PT7H30M')).toBe(450);
  });

  it('parses PT2H to 120', () => {
    expect(parseDurationToMinutes('PT2H')).toBe(120);
  });

  it('parses PT45M to 45', () => {
    expect(parseDurationToMinutes('PT45M')).toBe(45);
  });

  it('returns 0 for null/undefined', () => {
    expect(parseDurationToMinutes(null)).toBe(0);
    expect(parseDurationToMinutes(undefined)).toBe(0);
  });

  it('returns 0 for invalid format', () => {
    expect(parseDurationToMinutes('not-a-duration')).toBe(0);
  });

  it('handles hours-only duration', () => {
    expect(parseDurationToMinutes('PT11H')).toBe(660);
  });
});

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('DuffelAdapter constructor', () => {
  it('throws on empty API key', () => {
    const orig = process.env['DUFFEL_API_KEY'];
    delete process.env['DUFFEL_API_KEY'];
    expect(() => new DuffelAdapter('')).toThrow('valid API key');
    if (orig !== undefined) process.env['DUFFEL_API_KEY'] = orig;
  });

  it('throws on whitespace-only API key', () => {
    const orig = process.env['DUFFEL_API_KEY'];
    delete process.env['DUFFEL_API_KEY'];
    expect(() => new DuffelAdapter('   ')).toThrow('valid API key');
    if (orig !== undefined) process.env['DUFFEL_API_KEY'] = orig;
  });

  it('creates adapter with valid key', () => {
    const adapter = new DuffelAdapter({ apiKey: 'duffel_test_abc123', baseUrl: 'https://api.test.duffel.local', liveMode: false });
    expect(adapter.name).toBe('duffel');
  });
});

// ---------------------------------------------------------------------------
// search()
// ---------------------------------------------------------------------------

describe('DuffelAdapter search', () => {
  let adapter: DuffelAdapter;
  beforeEach(() => {
    adapter = new DuffelAdapter({ apiKey: 'duffel_test_key', baseUrl: 'https://api.test.duffel.local', liveMode: false });
  });

  it('returns mapped offers from API response', async () => {
    mockFetchResponse(200, {
      data: { id: 'orq_test_1', offers: [DUFFEL_OFFER] },
    });

    const result = await adapter.search(SEARCH_REQUEST);
    expect(result.offers).toHaveLength(1);

    const offer = result.offers[0]!;
    expect(offer.offer_id).toBe('off_test_123');
    expect(offer.source).toBe('duffel');
    expect(offer.itinerary.segments).toHaveLength(1);
    expect(offer.itinerary.segments[0]!.carrier).toBe('BA');
    expect(offer.itinerary.segments[0]!.flight_number).toBe('115');
    expect(offer.itinerary.segments[0]!.origin).toBe('LHR');
    expect(offer.itinerary.segments[0]!.destination).toBe('JFK');
    expect(offer.itinerary.segments[0]!.duration_minutes).toBe(450);
    expect(offer.itinerary.segments[0]!.aircraft).toBe('787-9');
    expect(offer.itinerary.segments[0]!.cabin_class).toBe('economy');
    expect(offer.itinerary.total_duration_minutes).toBe(450);
    expect(offer.itinerary.connection_count).toBe(0);
  });

  it('maps price correctly using decimal.js', async () => {
    mockFetchResponse(200, { data: { id: 'orq_1', offers: [DUFFEL_OFFER] } });

    const result = await adapter.search(SEARCH_REQUEST);
    const price = result.offers[0]!.price;
    expect(price.base_fare).toBe(450);
    expect(price.taxes).toBe(145.5);
    expect(price.total).toBe(595.5);
    expect(price.currency).toBe('GBP');
  });

  it('maps fare basis codes', async () => {
    mockFetchResponse(200, { data: { id: 'orq_1', offers: [DUFFEL_OFFER] } });

    const result = await adapter.search(SEARCH_REQUEST);
    expect(result.offers[0]!.fare_basis).toEqual(['Y26NR']);
  });

  it('maps instant_ticketing from payment_requirements', async () => {
    mockFetchResponse(200, { data: { id: 'orq_1', offers: [DUFFEL_OFFER] } });

    const result = await adapter.search(SEARCH_REQUEST);
    expect(result.offers[0]!.instant_ticketing).toBe(true);
  });

  it('returns empty offers for empty API response', async () => {
    mockFetchResponse(200, { data: { id: 'orq_1', offers: [] } });

    const result = await adapter.search(SEARCH_REQUEST);
    expect(result.offers).toHaveLength(0);
  });

  it('sends correct headers', async () => {
    mockFetchResponse(200, { data: { id: 'orq_1', offers: [] } });

    await adapter.search(SEARCH_REQUEST);
    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const headers = fetchCall[1]!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer duffel_test_key');
    expect(headers['Duffel-Version']).toBe('v2');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends cabin_class in request body', async () => {
    mockFetchResponse(200, { data: { id: 'orq_1', offers: [] } });

    await adapter.search({ ...SEARCH_REQUEST, cabin_class: 'business' });
    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(fetchCall[1]!.body as string);
    expect(body.data.cabin_class).toBe('business');
  });

  it('sets max_connections=0 when direct_only', async () => {
    mockFetchResponse(200, { data: { id: 'orq_1', offers: [] } });

    await adapter.search({ ...SEARCH_REQUEST, direct_only: true });
    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(fetchCall[1]!.body as string);
    expect(body.data.max_connections).toBe(0);
  });

  it('handles connecting itinerary with multiple segments', async () => {
    const connectingOffer = {
      ...DUFFEL_OFFER,
      id: 'off_connecting',
      slices: [
        {
          segments: [
            {
              ...DUFFEL_OFFER.slices[0]!.segments[0],
              destination: { iata_code: 'ORD' },
              duration: 'PT2H',
            },
            {
              ...DUFFEL_OFFER.slices[0]!.segments[0],
              origin: { iata_code: 'ORD' },
              destination: { iata_code: 'JFK' },
              duration: 'PT3H',
            },
          ],
        },
      ],
    };
    mockFetchResponse(200, { data: { id: 'orq_1', offers: [connectingOffer] } });

    const result = await adapter.search(SEARCH_REQUEST);
    expect(result.offers[0]!.itinerary.segments).toHaveLength(2);
    expect(result.offers[0]!.itinerary.connection_count).toBe(1);
    expect(result.offers[0]!.itinerary.total_duration_minutes).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// price()
// ---------------------------------------------------------------------------

describe('DuffelAdapter price', () => {
  let adapter: DuffelAdapter;
  beforeEach(() => {
    adapter = new DuffelAdapter({ apiKey: 'duffel_test_key', baseUrl: 'https://api.test.duffel.local', liveMode: false });
  });

  it('returns priced offer', async () => {
    mockFetchResponse(200, { data: DUFFEL_OFFER });

    const result = await adapter.price({
      offer_id: 'off_test_123',
      source: 'duffel',
      passengers: [{ type: 'ADT', count: 1 }],
    });
    expect(result.available).toBe(true);
    expect(result.price.total).toBe(595.5);
    expect(result.expires_at).toBe('2026-06-14T23:59:59Z');
  });

  it('returns unavailable when offer not found', async () => {
    mockFetchResponse(200, { data: null });

    const result = await adapter.price({
      offer_id: 'off_missing',
      source: 'duffel',
      passengers: [{ type: 'ADT', count: 1 }],
    });
    expect(result.available).toBe(false);
    expect(result.price.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isAvailable()
// ---------------------------------------------------------------------------

describe('DuffelAdapter isAvailable', () => {
  it('returns true when API responds 200', async () => {
    mockFetchResponse(200, { data: [] });
    const adapter = new DuffelAdapter({ apiKey: 'duffel_test_key', baseUrl: 'https://api.test.duffel.local', liveMode: false });
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('returns false on network failure', async () => {
    mockFetchNetworkError('ECONNREFUSED');
    const adapter = new DuffelAdapter({ apiKey: 'duffel_test_key', baseUrl: 'https://api.test.duffel.local', liveMode: false });
    expect(await adapter.isAvailable()).toBe(false);
  });

  it('returns false on 401', async () => {
    mockFetchResponse(401, { errors: [{ message: 'Invalid token' }] });
    const adapter = new DuffelAdapter({ apiKey: 'duffel_test_key', baseUrl: 'https://api.test.duffel.local', liveMode: false });
    expect(await adapter.isAvailable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('DuffelAdapter error handling', () => {
  let adapter: DuffelAdapter;
  beforeEach(() => {
    adapter = new DuffelAdapter({ apiKey: 'duffel_test_key', baseUrl: 'https://api.test.duffel.local', liveMode: false });
  });

  it('throws on network failure with clear message', async () => {
    mockFetchNetworkError('ECONNREFUSED');
    await expect(adapter.search(SEARCH_REQUEST)).rejects.toThrow(
      'Duffel API network error: ECONNREFUSED',
    );
  });

  it('throws on 429 rate limit', async () => {
    mockFetchResponse(429, { errors: [{ message: 'Rate limit exceeded' }] });
    await expect(adapter.search(SEARCH_REQUEST)).rejects.toThrow('rate limited (429)');
  });

  it('throws on 4xx API error with detail', async () => {
    mockFetchResponse(422, { errors: [{ message: 'Invalid origin' }] });
    await expect(adapter.search(SEARCH_REQUEST)).rejects.toThrow(
      'Duffel API error 422: Invalid origin',
    );
  });

  it('throws on 500 server error', async () => {
    mockFetchResponse(500, {});
    await expect(adapter.search(SEARCH_REQUEST)).rejects.toThrow('Duffel API error 500');
  });
});

// ---------------------------------------------------------------------------
// mapOrderToBookResponse()
// ---------------------------------------------------------------------------

const SAMPLE_ORDER: DuffelOrder = {
  id: 'ord_00009hthhsUZ8W4LxQgkjo',
  booking_reference: 'RZPNX8',
  total_amount: '90.80',
  total_currency: 'GBP',
  base_amount: '60.60',
  tax_amount: '30.20',
  created_at: '2020-04-11T15:48:11.642Z',
  owner: { iata_code: 'BA', name: 'British Airways' },
  passengers: [
    {
      id: 'pas_00009hj8USM7Ncg31cBCLL',
      given_name: 'Amelia',
      family_name: 'Earhart',
      born_on: '1987-07-24',
      type: 'adult',
      title: 'mrs',
      gender: 'f',
      email: 'amelia@duffel.com',
      phone_number: '+442080160509',
    },
  ],
  documents: [
    {
      type: 'electronic_ticket',
      unique_identifier: '1252106312810',
      passenger_ids: ['pas_00009hj8USM7Ncg31cBCLL'],
    },
  ],
  slices: [
    {
      segments: [
        {
          marketing_carrier: { iata_code: 'BA' },
          marketing_carrier_flight_number: '1234',
          origin: { iata_code: 'LHR' },
          destination: { iata_code: 'JFK' },
          departing_at: '2020-06-13T16:38:02',
          passengers: [
            {
              cabin_class: 'economy',
              fare_basis_code: 'Y26NR',
            },
          ],
        },
      ],
    },
  ],
  conditions: {
    refund_before_departure: {
      allowed: false,
      penalty_amount: null,
      penalty_currency: null,
    },
    change_before_departure: {
      allowed: true,
      penalty_amount: '100.00',
      penalty_currency: 'GBP',
    },
  },
};

describe('mapOrderToBookResponse', () => {
  it('maps existing BookResponse fields and enriched ticket/fare data', () => {
    const result = mapOrderToBookResponse(SAMPLE_ORDER);

    expect(result.booking_reference).toBe('RZPNX8');
    expect(result.order_id).toBe('ord_00009hthhsUZ8W4LxQgkjo');
    expect(result.total_amount).toBe('90.80');
    expect(result.total_currency).toBe('GBP');
    expect(result.passengers).toHaveLength(1);
    expect(result.passengers[0]!.given_name).toBe('Amelia');
    expect(result.passengers[0]!.family_name).toBe('Earhart');

    expect(result.ticketNumbers).toEqual([
      { number: '1252106312810', issuingCarrier: 'BA' },
    ]);
    expect(result.segments).toEqual([
      {
        carrier: 'BA',
        flightNumber: '1234',
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2020-06-13',
        bookingClass: '',
        fareBasis: 'Y26NR',
      },
    ]);
    expect(result.baseAmount).toBe('60.60');
    expect(result.taxAmount).toBe('30.20');
    expect(result.recordLocator).toBe('RZPNX8');
    expect(result.passengerNames).toEqual(['Amelia Earhart']);
    expect(result.issuedAt).toBe('2020-04-11T15:48:11.642Z');
    expect(result.bookingDate).toBe('2020-04-11T15:48:11.642Z');
    expect(result.refundable).toBe(false);
    expect(result.changeable).toBe(true);
  });

  it('omits optional fields when Duffel does not return them', () => {
    const result = mapOrderToBookResponse({
      id: 'ord_minimal',
      booking_reference: 'ABC123',
      total_amount: '10.00',
      total_currency: 'USD',
    });

    expect(result.order_id).toBe('ord_minimal');
    expect(result.ticketNumbers).toBeUndefined();
    expect(result.segments).toBeUndefined();
    expect(result.baseAmount).toBeUndefined();
    expect(result.taxAmount).toBeUndefined();
    expect(result.passengerNames).toBeUndefined();
    expect(result.issuedAt).toBeUndefined();
    expect(result.refundable).toBeUndefined();
    expect(result.changeable).toBeUndefined();
    expect(result.recordLocator).toBe('ABC123');
  });

  it('ignores non-ticket documents', () => {
    const result = mapOrderToBookResponse({
      ...SAMPLE_ORDER,
      documents: [
        {
          type: 'electronic_miscellaneous_document_associated',
          unique_identifier: 'EMD123',
        },
      ],
    });
    expect(result.ticketNumbers).toBeUndefined();
  });

  it('leaves fareBasis empty when order segment has no fare_basis_code', () => {
    const result = mapOrderToBookResponse({
      ...SAMPLE_ORDER,
      slices: [
        {
          segments: [
            {
              marketing_carrier: { iata_code: 'BA' },
              marketing_carrier_flight_number: '1',
              origin: { iata_code: 'LHR' },
              destination: { iata_code: 'JFK' },
              departing_at: '2020-06-13T16:38:02',
              passengers: [{ cabin_class: 'economy' }],
            },
          ],
        },
      ],
    });
    expect(result.segments?.[0]?.fareBasis).toBe('');
    expect(result.segments?.[0]?.bookingClass).toBe('');
  });
});

// ---------------------------------------------------------------------------
// getOrder()
// ---------------------------------------------------------------------------

describe('DuffelAdapter getOrder', () => {
  it('GETs /air/orders/{id} and returns enriched BookResponse', async () => {
    mockFetchResponse(200, { data: SAMPLE_ORDER });
    const adapter = new DuffelAdapter({ apiKey: 'duffel_test_key', baseUrl: 'https://api.test.duffel.local', liveMode: false });

    const result = await adapter.getOrder('ord_00009hthhsUZ8W4LxQgkjo');

    expect(result.ticketNumbers?.[0]?.number).toBe('1252106312810');
    expect(result.baseAmount).toBe('60.60');
    expect(result.recordLocator).toBe('RZPNX8');

    const fetchCall = vi.mocked(fetch).mock.calls[0]!;
    expect(fetchCall[0]).toBe(
      'https://api.test.duffel.local/air/orders/ord_00009hthhsUZ8W4LxQgkjo',
    );
    expect((fetchCall[1] as RequestInit).method).toBe('GET');
  });

  it('throws when order payload is missing', async () => {
    mockFetchResponse(200, { data: null });
    const adapter = new DuffelAdapter({ apiKey: 'duffel_test_key', baseUrl: 'https://api.test.duffel.local', liveMode: false });
    await expect(adapter.getOrder('ord_missing')).rejects.toThrow('not found');
  });
});

// ---------------------------------------------------------------------------
// book() enriched mapping
// ---------------------------------------------------------------------------

describe('DuffelAdapter book', () => {
  it('returns enriched fields from the created order', async () => {
    const offerWithPax = {
      ...DUFFEL_OFFER,
      passengers: [{ id: 'pas_offer_1', type: 'adult' }],
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ data: offerWithPax }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: () => Promise.resolve({ data: SAMPLE_ORDER }),
        }),
    );

    const adapter = new DuffelAdapter({ apiKey: 'duffel_test_key', baseUrl: 'https://api.test.duffel.local', liveMode: false });
    const result = await adapter.book({
      offer_id: 'off_test_123',
      passengers: [
        {
          title: 'mrs',
          given_name: 'Amelia',
          family_name: 'Earhart',
          born_on: '1987-07-24',
          email: 'amelia@duffel.com',
          phone_number: '+442080160509',
          gender: 'f',
          type: 'adult',
        },
      ],
    });

    expect(result.order_id).toBe('ord_00009hthhsUZ8W4LxQgkjo');
    expect(result.ticketNumbers?.[0]?.number).toBe('1252106312810');
    expect(result.segments?.[0]?.fareBasis).toBe('Y26NR');
    expect(result.baseAmount).toBe('60.60');
    expect(result.taxAmount).toBe('30.20');
  });
});
