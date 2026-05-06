/**
 * DuffelOtaAdapter — unit tests
 *
 * Mocks fetch so we can verify the field-shape mapping from the OTA's
 * `BookingRequest` into Duffel's POST /air/orders body, plus the in-memory
 * lifecycle (price update, payment record, ticket issuance, get, cancel).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuffelAdapter } from '@otaip/adapter-duffel';
import { DuffelOtaAdapter } from '../duffel-ota-adapter.js';
import type { BookingRequest } from '../types.js';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function queueFetchResponses(responses: Array<{ status: number; body: unknown }>): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
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
      } as Response);
    }),
  );
  return { calls };
}

const VALID_REQUEST: BookingRequest = {
  offerId: 'off_test_xyz',
  passengers: [
    {
      title: 'mr',
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '1985-12-10',
      gender: 'female',
    },
  ],
  contactEmail: 'ada@example.com',
  contactPhone: '+442080160509',
};

const DUFFEL_OFFER_RESPONSE = {
  data: {
    id: 'off_test_xyz',
    total_amount: '212.40',
    total_currency: 'GBP',
    passengers: [{ id: 'pas_test_1', type: 'adult' }],
  },
};

const DUFFEL_ORDER_RESPONSE = {
  data: {
    id: 'ord_test_42',
    booking_reference: 'PNR123',
    total_amount: '212.40',
    total_currency: 'GBP',
    passengers: [{ id: 'pas_test_1' }],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DuffelOtaAdapter', () => {
  let duffel: DuffelAdapter;
  let adapter: DuffelOtaAdapter;

  beforeEach(() => {
    duffel = new DuffelAdapter('duffel_test_key');
    adapter = new DuffelOtaAdapter(duffel);
  });

  describe('book', () => {
    it('maps OTA passenger fields into Duffel shape', async () => {
      const { calls } = queueFetchResponses([
        { status: 200, body: DUFFEL_OFFER_RESPONSE },
        { status: 200, body: DUFFEL_ORDER_RESPONSE },
      ]);

      await adapter.book(VALID_REQUEST);

      // First call fetches the offer to grab passenger IDs + total
      expect(calls[0]!.url).toContain('/air/offers/off_test_xyz');
      expect(calls[0]!.init.method).toBe('GET');

      // Second call posts the order
      expect(calls[1]!.url).toContain('/air/orders');
      expect(calls[1]!.init.method).toBe('POST');

      const body = JSON.parse(calls[1]!.init.body as string) as {
        data: {
          selected_offers: string[];
          passengers: Array<Record<string, unknown>>;
          payments: Array<Record<string, unknown>>;
          type: string;
        };
      };

      expect(body.data.selected_offers).toEqual(['off_test_xyz']);
      expect(body.data.type).toBe('instant');

      const pax = body.data.passengers[0]!;
      expect(pax['title']).toBe('mr');
      expect(pax['given_name']).toBe('Ada');
      expect(pax['family_name']).toBe('Lovelace');
      expect(pax['born_on']).toBe('1985-12-10');
      expect(pax['gender']).toBe('f');
      expect(pax['email']).toBe('ada@example.com');
      expect(pax['phone_number']).toBe('+442080160509');
      expect(pax['type']).toBe('adult');
      expect(pax['id']).toBe('pas_test_1');

      expect(body.data.payments[0]).toEqual({
        type: 'balance',
        currency: 'GBP',
        amount: '212.40',
      });
    });

    it('returns the booking reference and total from the Duffel order', async () => {
      queueFetchResponses([
        { status: 200, body: DUFFEL_OFFER_RESPONSE },
        { status: 200, body: DUFFEL_ORDER_RESPONSE },
      ]);

      const result = await adapter.book(VALID_REQUEST);

      expect(result.bookingReference).toBe('PNR123');
      expect(result.status).toBe('confirmed');
      expect(result.offerId).toBe('off_test_xyz');
      expect(result.totalAmount).toBe('212.40');
      expect(result.currency).toBe('GBP');
      expect(result.passengers).toEqual(VALID_REQUEST.passengers);
      expect(result.contactEmail).toBe('ada@example.com');
      expect(result.contactPhone).toBe('+442080160509');
      expect(result.createdAt).toBeTruthy();
    });

    it('maps male gender to "m"', async () => {
      const { calls } = queueFetchResponses([
        { status: 200, body: DUFFEL_OFFER_RESPONSE },
        { status: 200, body: DUFFEL_ORDER_RESPONSE },
      ]);

      await adapter.book({
        ...VALID_REQUEST,
        passengers: [{ ...VALID_REQUEST.passengers[0]!, gender: 'male' }],
      });

      const body = JSON.parse(calls[1]!.init.body as string) as {
        data: { passengers: Array<{ gender: string }> };
      };
      expect(body.data.passengers[0]!.gender).toBe('m');
    });
  });

  describe('lifecycle', () => {
    async function bookOnce() {
      queueFetchResponses([
        { status: 200, body: DUFFEL_OFFER_RESPONSE },
        { status: 200, body: DUFFEL_ORDER_RESPONSE },
      ]);
      return adapter.book(VALID_REQUEST);
    }

    it('getBooking returns the stored record', async () => {
      const booking = await bookOnce();
      const fetched = await adapter.getBooking(booking.bookingReference);
      expect(fetched).toEqual(booking);
    });

    it('getBooking returns null for unknown reference', async () => {
      expect(await adapter.getBooking('nope')).toBeNull();
    });

    it('updateBookingPrice mutates the stored total', async () => {
      const booking = await bookOnce();
      adapter.updateBookingPrice(booking.bookingReference, '999.00', 'USD');
      const fetched = await adapter.getBooking(booking.bookingReference);
      expect(fetched?.totalAmount).toBe('999.00');
      expect(fetched?.currency).toBe('USD');
    });

    it('issueTickets generates one number per passenger and flips status', async () => {
      const booking = await bookOnce();
      const tickets = adapter.issueTickets(booking.bookingReference);
      expect(tickets).toHaveLength(VALID_REQUEST.passengers.length);
      expect(tickets![0]).toMatch(/^016\d{10}$/);

      const fetched = await adapter.getBooking(booking.bookingReference);
      expect(fetched?.status).toBe('ticketed');
      expect(fetched?.ticketNumbers).toEqual(tickets);
    });

    it('issueTickets is idempotent', async () => {
      const booking = await bookOnce();
      const first = adapter.issueTickets(booking.bookingReference);
      const second = adapter.issueTickets(booking.bookingReference);
      expect(second).toEqual(first);
    });

    it('cancelBooking succeeds for confirmed booking', async () => {
      const booking = await bookOnce();
      const result = await adapter.cancelBooking(booking.bookingReference);
      expect(result.success).toBe(true);
      const fetched = await adapter.getBooking(booking.bookingReference);
      expect(fetched?.status).toBe('cancelled');
    });

    it('cancelBooking refuses to cancel a ticketed booking', async () => {
      const booking = await bookOnce();
      adapter.issueTickets(booking.bookingReference);
      const result = await adapter.cancelBooking(booking.bookingReference);
      expect(result.success).toBe(false);
      expect(result.message).toContain('ticketed');
    });

    it('cancelBooking returns success=false for unknown reference', async () => {
      const result = await adapter.cancelBooking('nope');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('search/price/isAvailable delegation', () => {
    it('search forwards to DuffelAdapter', async () => {
      const spy = vi
        .spyOn(duffel, 'search')
        .mockResolvedValue({ offers: [], truncated: false });

      const req = {
        segments: [{ origin: 'LHR', destination: 'AMS', departure_date: '2026-06-01' }],
        passengers: [{ type: 'ADT' as const, count: 1 }],
      };
      await adapter.search(req);
      expect(spy).toHaveBeenCalledWith(req);
    });

    it('price forwards to DuffelAdapter', async () => {
      const spy = vi.spyOn(duffel, 'price').mockResolvedValue({
        price: { base_fare: 0, taxes: 0, total: 0, currency: 'USD' },
        available: true,
      });
      await adapter.price({
        offer_id: 'off_x',
        source: 'duffel',
        passengers: [{ type: 'ADT', count: 1 }],
      });
      expect(spy).toHaveBeenCalled();
    });

    it('isAvailable forwards to DuffelAdapter', async () => {
      const spy = vi.spyOn(duffel, 'isAvailable').mockResolvedValue(true);
      expect(await adapter.isAvailable()).toBe(true);
      expect(spy).toHaveBeenCalled();
    });
  });
});
