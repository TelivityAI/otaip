/**
 * HotelbedsAdapter — Activities API unit tests with mocked fetch.
 *
 * No real network. Validates:
 *   - Auth headers are attached (same SHA256 scheme as Hotels).
 *   - Path is rooted at /activity-api/3.0 (not /hotel-api/1.0).
 *   - Request body shape matches the KB spec (filters/searchFilterItems).
 *   - Mapper output matches the canonical ActivityOffer shape.
 *   - Error normalisation flows through the shared `request()` helper.
 *
 * Sandbox integration is in `activities-integration.test.ts` (env-gated).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HotelbedsAdapter } from '../hotelbeds-adapter.js';
import type {
  HotelbedsActivitiesAvailabilityResponse,
  HotelbedsActivitiesBookingResponse,
  HotelbedsActivitiesCancellationResponse,
} from '../activities-types.js';

// ---------------------------------------------------------------------------
// Helpers — mirror the existing hotelbeds-adapter.test.ts pattern
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

const AVAIL_RESPONSE: HotelbedsActivitiesAvailabilityResponse = {
  activities: [
    {
      code: 'E-A10-000100301',
      name: 'Sagrada Família — Skip-the-Line Tour',
      description: 'Guided tour of Gaudí’s basilica with priority entry.',
      duration: 'PT1H30M',
      location: { latitude: 41.4036, longitude: 2.1744 },
      images: [{ url: 'https://example.invalid/img/sagrada-1.jpg' }, 'https://example.invalid/img/sagrada-2.jpg'],
      cancellationPolicy: 'NOR',
      modalities: [
        {
          code: 'TOUR_GUIDE|EN|1',
          name: 'English Group Tour',
          amount: '45.00',
          childAmount: '20.00',
          currency: 'EUR',
          maxPax: 25,
          schedule: ['09:00', '11:00', '14:00'],
        },
      ],
    },
  ],
};

const BOOKING_RESPONSE: HotelbedsActivitiesBookingResponse = {
  booking: {
    reference: 'HB-ACT-9001',
    clientReference: 'AVR-ACT-001',
    status: 'CONFIRMED',
    voucherUrl: 'https://example.invalid/voucher/HB-ACT-9001.pdf',
  },
};

const PRECONFIRMED_BOOKING_RESPONSE: HotelbedsActivitiesBookingResponse = {
  booking: {
    reference: 'HB-ACT-9002',
    clientReference: 'AVR-ACT-002',
    status: 'PRECONFIRMED',
  },
};

const CANCELLATION_RESPONSE: HotelbedsActivitiesCancellationResponse = {
  booking: {
    reference: 'HB-ACT-9001',
    cancellationReference: 'CXL-HB-ACT-9001',
    status: 'CANCELLED',
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// searchActivities
// ---------------------------------------------------------------------------

describe('HotelbedsAdapter.searchActivities', () => {
  let adapter: HotelbedsAdapter;
  beforeEach(() => {
    adapter = new HotelbedsAdapter({ apiKey: 'test-key', secret: 'test-secret' });
  });

  it('hits /activity-api/3.0/activities/availability with correct body shape', async () => {
    const { calls } = captureFetch([{ status: 200, body: AVAIL_RESPONSE }]);

    await adapter.searchActivities({
      destination: 'BCN',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-03',
      paxes: { adults: 2, children: [8, 12] },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://api.test.hotelbeds.com/activity-api/3.0/activities/availability',
    );
    expect(calls[0]!.init.method).toBe('POST');

    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toEqual({
      filters: {
        searchFilterItems: [{ type: 'destination', value: 'BCN' }],
      },
      from: '2026-06-01',
      to: '2026-06-03',
      paxes: { adults: 2, children: [8, 12] },
    });
  });

  it('attaches the same SHA256 signature headers used by the Hotels API', async () => {
    const { calls } = captureFetch([{ status: 200, body: AVAIL_RESPONSE }]);
    await adapter.searchActivities({
      destination: 'BCN',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-03',
      paxes: { adults: 2 },
    });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Api-key']).toBe('test-key');
    expect(headers['X-Signature']).toMatch(/^[a-f0-9]{64}$/);
    expect(headers['Accept']).toBe('application/json');
  });

  it('maps the response to the canonical ActivityOffer shape', async () => {
    captureFetch([{ status: 200, body: AVAIL_RESPONSE }]);

    const offers = await adapter.searchActivities({
      destination: 'BCN',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-03',
      paxes: { adults: 2 },
    });

    expect(offers).toHaveLength(1);
    const offer = offers[0]!;
    expect(offer.activityCode).toBe('E-A10-000100301');
    expect(offer.name).toBe('Sagrada Família — Skip-the-Line Tour');
    expect(offer.duration).toBe('PT1H30M');
    expect(offer.cancellationPolicy).toBe('NOR');
    expect(offer.location).toEqual({ latitude: 41.4036, longitude: 2.1744 });
    // Both image shapes (object + string) get flattened
    expect(offer.images).toEqual([
      'https://example.invalid/img/sagrada-1.jpg',
      'https://example.invalid/img/sagrada-2.jpg',
    ]);
    expect(offer.modalities).toHaveLength(1);
    const m = offer.modalities[0]!;
    expect(m.code).toBe('TOUR_GUIDE|EN|1');
    expect(m.price).toEqual({ amount: '45.00', currency: 'EUR' });
    expect(m.childPrice).toEqual({ amount: '20.00', currency: 'EUR' });
    expect(m.maxPax).toBe(25);
    expect(m.schedule).toEqual(['09:00', '11:00', '14:00']);
  });

  it('omits children when paxes.children is undefined', async () => {
    const { calls } = captureFetch([{ status: 200, body: AVAIL_RESPONSE }]);
    await adapter.searchActivities({
      destination: 'BCN',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-03',
      paxes: { adults: 1 },
    });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.paxes).toEqual({ adults: 1 });
    expect(body.paxes.children).toBeUndefined();
  });

  it('uppercases destination codes', async () => {
    const { calls } = captureFetch([{ status: 200, body: AVAIL_RESPONSE }]);
    await adapter.searchActivities({
      destination: 'bcn',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-03',
      paxes: { adults: 1 },
    });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.filters.searchFilterItems[0]).toEqual({ type: 'destination', value: 'BCN' });
  });

  it('aborts pre-flight when an aborted signal is supplied', async () => {
    captureFetch([]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      adapter.searchActivities({
        destination: 'BCN',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-03',
        paxes: { adults: 1 },
        signal: ac.signal,
      }),
    ).rejects.toThrow(/aborted/);
  });

  it('returns empty array when the response has no activities', async () => {
    captureFetch([{ status: 200, body: { activities: [] } }]);
    const offers = await adapter.searchActivities({
      destination: 'XYZ',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-03',
      paxes: { adults: 1 },
    });
    expect(offers).toEqual([]);
  });

  it('surfaces 429 as a rate-limit error after retries exhaust', async () => {
    // fetchWithRetry retries 429 — every attempt must see the same response.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: () => Promise.resolve({ error: { message: 'Daily quota exceeded' } }),
      }),
    );
    await expect(
      adapter.searchActivities({
        destination: 'BCN',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-03',
        paxes: { adults: 1 },
      }),
    ).rejects.toThrow(/rate limited/i);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// bookActivity
// ---------------------------------------------------------------------------

describe('HotelbedsAdapter.bookActivity', () => {
  let adapter: HotelbedsAdapter;
  beforeEach(() => {
    adapter = new HotelbedsAdapter({ apiKey: 'test-key', secret: 'test-secret' });
  });

  it('posts /activities/booking with the brief-shape body', async () => {
    const { calls } = captureFetch([{ status: 200, body: BOOKING_RESPONSE }]);

    await adapter.bookActivity({
      activityCode: 'E-A10-000100301',
      modalityCode: 'TOUR_GUIDE|EN|1',
      date: '2026-06-01',
      paxes: [{ age: 30 }, { age: 28 }],
      holder: { name: 'John', surname: 'Smith' },
      clientReference: 'AVR-ACT-001',
    });

    expect(calls[0]!.url).toBe(
      'https://api.test.hotelbeds.com/activity-api/3.0/activities/booking',
    );
    expect(calls[0]!.init.method).toBe('POST');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toEqual({
      activities: [
        {
          activityCode: 'E-A10-000100301',
          modalityCode: 'TOUR_GUIDE|EN|1',
          from: '2026-06-01',
          paxes: [{ age: 30 }, { age: 28 }],
        },
      ],
      holder: { name: 'John', surname: 'Smith' },
      clientReference: 'AVR-ACT-001',
    });
  });

  it('returns the canonical CONFIRMED response with voucherUrl', async () => {
    captureFetch([{ status: 200, body: BOOKING_RESPONSE }]);
    const result = await adapter.bookActivity({
      activityCode: 'E-A10-000100301',
      modalityCode: 'TOUR_GUIDE|EN|1',
      date: '2026-06-01',
      paxes: [{ age: 30 }],
      holder: { name: 'John', surname: 'Smith' },
      clientReference: 'AVR-ACT-001',
    });
    expect(result).toEqual({
      bookingReference: 'HB-ACT-9001',
      status: 'CONFIRMED',
      clientReference: 'AVR-ACT-001',
      voucherUrl: 'https://example.invalid/voucher/HB-ACT-9001.pdf',
    });
  });

  it('preserves PRECONFIRMED (preconfirm hold — not ON_REQUEST; DQ-A3)', async () => {
    captureFetch([{ status: 200, body: PRECONFIRMED_BOOKING_RESPONSE }]);
    const result = await adapter.bookActivity({
      activityCode: 'E-A10-000100301',
      modalityCode: 'TOUR_GUIDE|EN|1',
      date: '2026-06-01',
      paxes: [{ age: 30 }],
      holder: { name: 'John', surname: 'Smith' },
      clientReference: 'AVR-ACT-002',
    });
    expect(result.status).toBe('PRECONFIRMED');
    expect(result.voucherUrl).toBeUndefined();
  });

  it('rejects unsupported ON_REQUEST confirm status (DQ-A3 CLOSED)', async () => {
    captureFetch([
      {
        status: 200,
        body: {
          booking: {
            reference: 'HB-ACT-BAD',
            clientReference: 'AVR-ACT-BAD',
            status: 'ON_REQUEST',
          },
        },
      },
    ]);
    await expect(
      adapter.bookActivity({
        activityCode: 'E-A10-000100301',
        modalityCode: 'TOUR_GUIDE|EN|1',
        date: '2026-06-01',
        paxes: [{ age: 30 }],
        holder: { name: 'John', surname: 'Smith' },
        clientReference: 'AVR-ACT-BAD',
      }),
    ).rejects.toThrow(/ON_REQUEST|unsupported status/i);
  });

  it('throws when the response has no booking object', async () => {
    captureFetch([{ status: 200, body: {} }]);
    await expect(
      adapter.bookActivity({
        activityCode: 'E-A10-000100301',
        modalityCode: 'TOUR_GUIDE|EN|1',
        date: '2026-06-01',
        paxes: [{ age: 30 }],
        holder: { name: 'John', surname: 'Smith' },
        clientReference: 'AVR-ACT-001',
      }),
    ).rejects.toThrow(/no booking object/);
  });
});

// ---------------------------------------------------------------------------
// cancelActivity
// ---------------------------------------------------------------------------

describe('HotelbedsAdapter.cancelActivity', () => {
  let adapter: HotelbedsAdapter;
  beforeEach(() => {
    adapter = new HotelbedsAdapter({ apiKey: 'test-key', secret: 'test-secret' });
  });

  it('SIMULATION hits documented DELETE path with cancellationFlag', async () => {
    const { calls } = captureFetch([{ status: 200, body: CANCELLATION_RESPONSE }]);
    const result = await adapter.cancelActivity('HB-ACT-9001', 'SIMULATION');
    expect(result).toEqual({
      status: 'CANCELLED',
      cancellationReference: 'CXL-HB-ACT-9001',
    });
    expect(calls[0]!.url).toContain(
      '/activity-api/3.0/bookings/en/HB-ACT-9001?cancellationFlag=SIMULATION',
    );
    expect(calls[0]!.init.method).toBe('DELETE');
  });

  it('CANCELLATION 503 → one wire; replay → zero', async () => {
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
      adapter.cancelActivity('HB-ACT-9001', 'CANCELLATION', {
        idempotencyKey: 'act-cxl-1',
      }),
    ).rejects.toThrow(/503|unknown|reconcil/i);
    await expect(
      adapter.cancelActivity('HB-ACT-9001', 'CANCELLATION', {
        idempotencyKey: 'act-cxl-1',
      }),
    ).rejects.toThrow(/503|unknown|reconcil/i);
    expect(deletes).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Cancellation policy normalisation (NRF default for unknown values)
// ---------------------------------------------------------------------------

describe('HotelbedsAdapter Activities — cancellation policy fallback', () => {
  it('defaults unknown policy strings to NRF (safe fallback; NOR/NRF documented — DQ-A5 CLOSED)', async () => {
    captureFetch([
      {
        status: 200,
        body: {
          activities: [
            {
              code: 'E-A10-000100302',
              name: 'Mystery Tour',
              cancellationPolicy: 'WEIRD-NEW-CODE',
              modalities: [{ code: 'M1', amount: '10.00', currency: 'EUR' }],
            },
          ],
        },
      },
    ]);
    const adapter = new HotelbedsAdapter({ apiKey: 'k', secret: 's' });
    const offers = await adapter.searchActivities({
      destination: 'BCN',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-02',
      paxes: { adults: 1 },
    });
    expect(offers[0]!.cancellationPolicy).toBe('NRF');
  });
});
