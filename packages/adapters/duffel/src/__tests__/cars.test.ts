/**
 * Duffel Cars — unit tests with mocked fetch.
 *
 * No real network. Validates:
 *   - Three-step flow: search → quote → book.
 *   - Auth + Duffel-Version headers (same as flights).
 *   - Path routing under /cars/ (not /air/).
 *   - Body shapes match the brief (geo coordinates wrapped in `data`).
 *   - Mapper output matches the canonical Car* types (money normalised
 *     via decimal.js).
 *   - 429 retry-then-error.
 *   - AbortSignal pre-flight.
 *   - MockDuffelAdapter cars flow exercises the same surface.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DuffelAdapter } from '../duffel-adapter.js';
import { MockDuffelAdapter } from '../mock-duffel-adapter.js';
import type {
  DuffelCarsBookingResponse,
  DuffelCarsCancelResponse,
  DuffelCarsQuoteResponse,
  DuffelCarsSearchResponse,
} from '../cars-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SEARCH_RESPONSE: DuffelCarsSearchResponse = {
  data: {
    id: 'seh_test_001',
    rates: [
      {
        id: 'rae_test_alpha',
        car: {
          name: 'Toyota Corolla',
          category: 'compact',
          type: 'four_door',
          transmission: 'automatic',
          fuel: 'petrol',
          code: 'CDAR',
          max_passengers: 5,
          baggage: { small: 2, large: 1 },
          air_conditioning: true,
          images: ['https://example.invalid/img/corolla.jpg'],
        },
        supplier: { name: 'Test Drive', logo_url: 'https://example.invalid/logo.png' },
        pickup_location: {
          address: 'Barcelona Airport T1',
          geographic_coordinates: { latitude: 41.2974, longitude: 2.0833 },
          phone: '+34-900-100-100',
          opening_hours: '06:00–23:00',
        },
        dropoff_location: {
          address: 'Barcelona Airport T1',
          geographic_coordinates: { latitude: 41.2974, longitude: 2.0833 },
        },
        base_amount: '120.50',
        base_currency: 'EUR',
        total_amount: '142.40',
        total_currency: 'EUR',
        payment_type: 'prepaid',
      },
    ],
  },
};

const QUOTE_RESPONSE: DuffelCarsQuoteResponse = {
  data: {
    id: 'qut_test_001',
    rate_id: 'rae_test_alpha',
    search_id: 'seh_test_001',
    car: SEARCH_RESPONSE.data.rates![0]!.car!,
    supplier: SEARCH_RESPONSE.data.rates![0]!.supplier!,
    pickup_location: SEARCH_RESPONSE.data.rates![0]!.pickup_location!,
    dropoff_location: SEARCH_RESPONSE.data.rates![0]!.dropoff_location!,
    total_amount: '142.40',
    total_currency: 'EUR',
    conditions: [
      { title: 'Free cancellation', text: 'Until 48h before pickup.' },
      { title: 'Fuel policy', text: 'Full to full.' },
    ],
    charges: [
      { amount: '5.00', currency: 'EUR', description: 'Airport surcharge' },
      { amount: '12.50', currency: 'EUR', description: 'Insurance' },
    ],
    mileage: { unlimited: true },
    privacy_policies: ['Mock privacy policy text.'],
  },
};

const BOOKING_RESPONSE: DuffelCarsBookingResponse = {
  data: {
    id: 'boo_test_001',
    status: 'confirmed',
    reference: 'TST-CAR-12345',
    confirmed_at: '2026-06-01T10:00:00Z',
    car: SEARCH_RESPONSE.data.rates![0]!.car!,
    supplier: SEARCH_RESPONSE.data.rates![0]!.supplier!,
    pickup_location: SEARCH_RESPONSE.data.rates![0]!.pickup_location!,
    dropoff_location: SEARCH_RESPONSE.data.rates![0]!.dropoff_location!,
    total_amount: '142.40',
    total_currency: 'EUR',
  },
};

const CANCEL_RESPONSE: DuffelCarsCancelResponse = {
  data: {
    id: 'boo_test_001',
    status: 'cancelled',
    cancelled_at: '2026-06-01T11:30:00Z',
  },
};

const SEARCH_REQUEST = {
  pickupDate: '2026-06-15',
  pickupTime: '10:30',
  pickupLocation: { latitude: 41.3874, longitude: 2.1686, radius: 5 },
  dropoffDate: '2026-06-20',
  dropoffTime: '10:30',
  dropoffLocation: { latitude: 41.3874, longitude: 2.1686, radius: 5 },
  driver: { age: 30, residenceCountryCode: 'US' },
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// searchCars
// ---------------------------------------------------------------------------

describe('DuffelAdapter.searchCars', () => {
  let adapter: DuffelAdapter;
  beforeEach(() => {
    adapter = new DuffelAdapter('duffel_test_key');
  });

  it('hits POST /cars/search with the brief-shape body', async () => {
    const { calls } = captureFetch([{ status: 200, body: SEARCH_RESPONSE }]);

    await adapter.searchCars(SEARCH_REQUEST);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.duffel.com/cars/search');
    expect(calls[0]!.init.method).toBe('POST');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toEqual({
      data: {
        pickup_date: '2026-06-15',
        pickup_time: '10:30',
        pickup_location: {
          radius: 5,
          geographic_coordinates: { latitude: 41.3874, longitude: 2.1686 },
        },
        dropoff_date: '2026-06-20',
        dropoff_time: '10:30',
        dropoff_location: {
          radius: 5,
          geographic_coordinates: { latitude: 41.3874, longitude: 2.1686 },
        },
        driver: { age: 30, residence_country_code: 'US' },
      },
    });
  });

  it('attaches the same Bearer auth + Duffel-Version headers as flights', async () => {
    const { calls } = captureFetch([{ status: 200, body: SEARCH_RESPONSE }]);
    await adapter.searchCars(SEARCH_REQUEST);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer duffel_test_key');
    expect(headers['Duffel-Version']).toBe('v2');
    expect(headers['Accept']).toBe('application/json');
  });

  it('omits radius when caller does not supply it', async () => {
    const { calls } = captureFetch([{ status: 200, body: SEARCH_RESPONSE }]);
    await adapter.searchCars({
      ...SEARCH_REQUEST,
      pickupLocation: { latitude: 41.3874, longitude: 2.1686 },
      dropoffLocation: { latitude: 41.3874, longitude: 2.1686 },
    });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.data.pickup_location.radius).toBeUndefined();
    expect(body.data.dropoff_location.radius).toBeUndefined();
    expect(body.data.pickup_location.geographic_coordinates).toEqual({
      latitude: 41.3874,
      longitude: 2.1686,
    });
  });

  it('maps the response into canonical CarRate shape', async () => {
    captureFetch([{ status: 200, body: SEARCH_RESPONSE }]);
    const result = await adapter.searchCars(SEARCH_REQUEST);
    expect(result.searchId).toBe('seh_test_001');
    expect(result.rates).toHaveLength(1);
    const rate = result.rates[0]!;
    expect(rate.rateId).toBe('rae_test_alpha');
    expect(rate.searchId).toBe('seh_test_001');
    expect(rate.car.name).toBe('Toyota Corolla');
    expect(rate.car.category).toBe('compact');
    expect(rate.car.transmission).toBe('automatic');
    expect(rate.car.acrissCode).toBe('CDAR');
    expect(rate.car.maxPassengers).toBe(5);
    expect(rate.car.baggage).toEqual({ small: 2, large: 1 });
    expect(rate.car.airConditioning).toBe(true);
    expect(rate.car.images).toEqual(['https://example.invalid/img/corolla.jpg']);
    expect(rate.supplier).toEqual({
      name: 'Test Drive',
      logoUrl: 'https://example.invalid/logo.png',
    });
    expect(rate.pickupLocation.address).toBe('Barcelona Airport T1');
    expect(rate.pickupLocation.latitude).toBe(41.2974);
    expect(rate.pickupLocation.openingHours).toBe('06:00–23:00');
    expect(rate.baseAmount).toEqual({ amount: '120.50', currency: 'EUR' });
    expect(rate.totalAmount).toEqual({ amount: '142.40', currency: 'EUR' });
    expect(rate.paymentType).toBe('prepaid');
  });

  it('aborts pre-flight when an aborted signal is supplied', async () => {
    captureFetch([]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      adapter.searchCars({ ...SEARCH_REQUEST, signal: ac.signal }),
    ).rejects.toThrow(/aborted/);
  });

  it('returns empty rates when none are returned', async () => {
    captureFetch([{ status: 200, body: { data: { id: 'seh_empty', rates: [] } } }]);
    const result = await adapter.searchCars(SEARCH_REQUEST);
    expect(result.rates).toEqual([]);
  });

  it('defaults unknown payment_type to postpaid (safe assumption)', async () => {
    captureFetch([
      {
        status: 200,
        body: {
          data: {
            id: 'seh_x',
            rates: [
              {
                id: 'rae_x',
                car: { name: 'Mystery', code: 'XXXX', transmission: 'automatic' },
                payment_type: 'NEW_FUTURE_VALUE',
                total_amount: '10.00',
                total_currency: 'USD',
              },
            ],
          },
        },
      },
    ]);
    const result = await adapter.searchCars(SEARCH_REQUEST);
    expect(result.rates[0]!.paymentType).toBe('postpaid');
  });

  it('surfaces 429 as a rate-limit error after retries exhaust', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: () => Promise.resolve({ errors: [{ message: 'rate exceeded' }] }),
      }),
    );
    await expect(adapter.searchCars(SEARCH_REQUEST)).rejects.toThrow(/rate limited/i);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// quoteCar
// ---------------------------------------------------------------------------

describe('DuffelAdapter.quoteCar', () => {
  let adapter: DuffelAdapter;
  beforeEach(() => {
    adapter = new DuffelAdapter('duffel_test_key');
  });

  it('posts /cars/quotes with rate_id wrapped in data', async () => {
    const { calls } = captureFetch([{ status: 200, body: QUOTE_RESPONSE }]);
    await adapter.quoteCar('rae_test_alpha');
    expect(calls[0]!.url).toBe('https://api.duffel.com/cars/quotes');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      data: { rate_id: 'rae_test_alpha' },
    });
  });

  it('returns conditions, charges, mileage, and privacy_policies', async () => {
    captureFetch([{ status: 200, body: QUOTE_RESPONSE }]);
    const quote = await adapter.quoteCar('rae_test_alpha');
    expect(quote.quoteId).toBe('qut_test_001');
    expect(quote.rateId).toBe('rae_test_alpha');
    expect(quote.searchId).toBe('seh_test_001');
    expect(quote.totalAmount).toEqual({ amount: '142.40', currency: 'EUR' });
    expect(quote.conditions).toHaveLength(2);
    expect(quote.conditions[0]!.title).toBe('Free cancellation');
    expect(quote.charges).toHaveLength(2);
    expect(quote.charges[1]!.amount).toBe('12.50');
    expect(quote.mileage).toEqual({ unlimited: true });
    expect(quote.privacyPolicies).toEqual(['Mock privacy policy text.']);
  });

  it('aborts pre-flight when an aborted signal is supplied', async () => {
    captureFetch([]);
    const ac = new AbortController();
    ac.abort();
    await expect(adapter.quoteCar('rae_test_alpha', ac.signal)).rejects.toThrow(/aborted/);
  });
});

// ---------------------------------------------------------------------------
// bookCar
// ---------------------------------------------------------------------------

describe('DuffelAdapter.bookCar', () => {
  let adapter: DuffelAdapter;
  beforeEach(() => {
    adapter = new DuffelAdapter('duffel_test_key');
  });

  it('posts /cars/bookings with the brief-shape body', async () => {
    const { calls } = captureFetch([{ status: 200, body: BOOKING_RESPONSE }]);
    await adapter.bookCar({
      quoteId: 'qut_test_001',
      driver: {
        givenName: 'Ada',
        familyName: 'Lovelace',
        email: 'ada@example.com',
        phoneNumber: '+1234567890',
        dateOfBirth: '1985-12-10',
      },
      payment: { method: 'card', cardId: 'crd_abc' },
      metadata: { trip: 'business' },
      inboundFlightNumber: 'BA123',
    });
    expect(calls[0]!.url).toBe('https://api.duffel.com/cars/bookings');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toEqual({
      data: {
        quote_id: 'qut_test_001',
        driver: {
          given_name: 'Ada',
          family_name: 'Lovelace',
          email: 'ada@example.com',
          phone_number: '+1234567890',
          date_of_birth: '1985-12-10',
        },
        payment: { method: 'card', cardId: 'crd_abc' },
        metadata: { trip: 'business' },
        inbound_flight_number: 'BA123',
      },
    });
  });

  it('returns the canonical confirmed booking', async () => {
    captureFetch([{ status: 200, body: BOOKING_RESPONSE }]);
    const result = await adapter.bookCar({
      quoteId: 'qut_test_001',
      driver: {
        givenName: 'Ada',
        familyName: 'Lovelace',
        email: 'ada@example.com',
        phoneNumber: '+1234567890',
      },
    });
    expect(result.bookingId).toBe('boo_test_001');
    expect(result.status).toBe('confirmed');
    expect(result.reference).toBe('TST-CAR-12345');
    expect(result.totalAmount).toEqual({ amount: '142.40', currency: 'EUR' });
    expect(result.car.name).toBe('Toyota Corolla');
  });

  it('omits optional fields from the request body when not supplied', async () => {
    const { calls } = captureFetch([{ status: 200, body: BOOKING_RESPONSE }]);
    await adapter.bookCar({
      quoteId: 'qut_test_001',
      driver: {
        givenName: 'Ada',
        familyName: 'Lovelace',
        email: 'ada@example.com',
        phoneNumber: '+1234567890',
      },
    });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.data.driver.date_of_birth).toBeUndefined();
    expect(body.data.payment).toBeUndefined();
    expect(body.data.metadata).toBeUndefined();
    expect(body.data.inbound_flight_number).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getCarBooking + cancelCarBooking
// ---------------------------------------------------------------------------

describe('DuffelAdapter.getCarBooking', () => {
  it('GETs /cars/bookings/{id}', async () => {
    const adapter = new DuffelAdapter('duffel_test_key');
    const { calls } = captureFetch([{ status: 200, body: BOOKING_RESPONSE }]);
    const result = await adapter.getCarBooking('boo_test_001');
    expect(calls[0]!.url).toBe('https://api.duffel.com/cars/bookings/boo_test_001');
    expect(calls[0]!.init.method).toBe('GET');
    expect(result.bookingId).toBe('boo_test_001');
  });

  it('URL-encodes the booking id', async () => {
    const adapter = new DuffelAdapter('duffel_test_key');
    const { calls } = captureFetch([{ status: 200, body: BOOKING_RESPONSE }]);
    await adapter.getCarBooking('boo /weird');
    expect(calls[0]!.url).toContain('boo%20%2Fweird');
  });
});

describe('DuffelAdapter.cancelCarBooking', () => {
  it('POSTs /cars/bookings/{id}/actions/cancel', async () => {
    const adapter = new DuffelAdapter('duffel_test_key');
    const { calls } = captureFetch([{ status: 200, body: CANCEL_RESPONSE }]);
    const result = await adapter.cancelCarBooking('boo_test_001');
    expect(calls[0]!.url).toBe(
      'https://api.duffel.com/cars/bookings/boo_test_001/actions/cancel',
    );
    expect(calls[0]!.init.method).toBe('POST');
    expect(result.status).toBe('cancelled');
    expect(result.cancelledAt).toBe('2026-06-01T11:30:00Z');
  });
});

// ---------------------------------------------------------------------------
// MockDuffelAdapter
// ---------------------------------------------------------------------------

describe('MockDuffelAdapter — Cars three-step flow', () => {
  it('search → quote → book → get → cancel round-trips', async () => {
    const adapter = new MockDuffelAdapter();
    const search = await adapter.searchCars(SEARCH_REQUEST);
    expect(search.searchId).toMatch(/^seh_mock_\d{6}$/);
    expect(search.rates.length).toBeGreaterThan(0);
    const rate = search.rates[0]!;
    expect(rate.car.name).toBeTruthy();

    const quote = await adapter.quoteCar(rate.rateId);
    expect(quote.quoteId).toMatch(/^qut_mock_\d{6}$/);
    expect(quote.privacyPolicies.length).toBeGreaterThan(0);
    expect(quote.mileage?.unlimited).toBe(true);

    const booking = await adapter.bookCar({
      quoteId: quote.quoteId,
      driver: {
        givenName: 'Ada',
        familyName: 'Lovelace',
        email: 'ada@example.com',
        phoneNumber: '+1234567890',
      },
    });
    expect(booking.bookingId).toMatch(/^boo_mock_\d{6}$/);
    expect(booking.status).toBe('confirmed');
    expect(booking.totalAmount).toEqual(quote.totalAmount);

    const fetched = await adapter.getCarBooking(booking.bookingId);
    expect(fetched.bookingId).toBe(booking.bookingId);

    const cancelled = await adapter.cancelCarBooking(booking.bookingId);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledAt).toBeTruthy();
  });

  it('quoteCar with an unknown rateId throws', async () => {
    const adapter = new MockDuffelAdapter();
    await expect(adapter.quoteCar('rae_does_not_exist')).rejects.toThrow(/unknown/);
  });

  it('cancelling an already-cancelled booking throws', async () => {
    const adapter = new MockDuffelAdapter();
    const search = await adapter.searchCars(SEARCH_REQUEST);
    const quote = await adapter.quoteCar(search.rates[0]!.rateId);
    const booking = await adapter.bookCar({
      quoteId: quote.quoteId,
      driver: {
        givenName: 'A',
        familyName: 'B',
        email: 'a@b',
        phoneNumber: '+1',
      },
    });
    await adapter.cancelCarBooking(booking.bookingId);
    await expect(adapter.cancelCarBooking(booking.bookingId)).rejects.toThrow(
      /already cancelled/,
    );
  });

  it('rejects pre-aborted searchCars calls', async () => {
    const adapter = new MockDuffelAdapter();
    const ac = new AbortController();
    ac.abort();
    await expect(
      adapter.searchCars({ ...SEARCH_REQUEST, signal: ac.signal }),
    ).rejects.toThrow(/aborted/);
  });
});
