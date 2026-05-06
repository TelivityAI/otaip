/**
 * Mock Hotelbeds adapter — in-memory data, no network.
 *
 * Mirrors the public surface of `HotelbedsAdapter` so upstream tests can
 * swap it in by interface, but uses no real API. Returns Hotelbeds-shaped
 * fixtures so the field-mapper paths are exercised end-to-end.
 *
 * NOT a replacement for the existing
 * `packages/agents/lodging/src/hotel-search/adapters/hotelbeds.ts` mock,
 * which is narrower (search-only, returns pre-mapped RawHotelResult). This
 * mock simulates the wire shapes so the same `HotelbedsAdapter`
 * lifecycle (availability → checkrate → book → cancel) is testable.
 */

import { mapHotelToRawResult, summarizeBooking, type BookingSummary } from './field-mapper.js';
import type {
  HotelbedsAvailabilityRequest,
  HotelbedsAvailabilityResponse,
  HotelbedsBooking,
  HotelbedsBookingListResponse,
  HotelbedsBookingRequest,
  HotelbedsBookingResponse,
  HotelbedsCancellationFlag,
  HotelbedsCancellationResponse,
  HotelbedsCheckRateRequest,
  HotelbedsCheckRateResponse,
  HotelbedsHotel,
  HotelbedsRate,
} from './types.js';
import type {
  ActivityBookRequest,
  ActivityBookResponse,
  ActivityCancelResponse,
  ActivityOffer,
  ActivitySearchRequest,
} from './activities-types.js';
import type {
  TransferBookRequest,
  TransferBookResponse,
  TransferCancelResponse,
  TransferOffer,
  TransferSearchRequest,
} from './transfers-types.js';
import type { HotelSearchParams, HotelSourceAdapter } from './lodging-source-interface.js';
import type { RawHotelResult } from '@otaip/agents-lodging';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRate(overrides: Partial<HotelbedsRate> & { rateKey: string }): HotelbedsRate {
  return {
    rateType: 'BOOKABLE',
    rateClass: 'NOR',
    net: '610.00',
    boardCode: 'RO',
    boardName: 'ROOM ONLY',
    paymentType: 'AT_WEB',
    cancellationPolicies: [{ amount: '305.00', from: '2026-06-13T23:59:59+00:00' }],
    ...overrides,
  };
}

const HOTEL_MCO_BOOKABLE: HotelbedsHotel = {
  code: 12345,
  name: 'Mock Bedbank Resort Orlando',
  categoryCode: '4EST',
  destinationCode: 'MCO',
  destinationName: 'Orlando area',
  countryCode: 'US',
  stateCode: 'FL',
  postalCode: '32830',
  city: 'Orlando',
  address: { content: '1500 Mock Resort Blvd' },
  latitude: '28.3852',
  longitude: '-81.5639',
  currency: 'USD',
  chainCode: 'MOK',
  rooms: [
    {
      code: 'STD.ST',
      name: 'STANDARD ROOM',
      rates: [makeRate({ rateKey: 'mock-mco-bookable-1' })],
    },
  ],
};

const HOTEL_MCO_RECHECK: HotelbedsHotel = {
  ...HOTEL_MCO_BOOKABLE,
  code: 67890,
  name: 'Mock Bedbank Suites Orlando',
  rooms: [
    {
      code: 'SUITE.ST',
      name: 'JUNIOR SUITE',
      rates: [
        makeRate({
          rateKey: 'mock-mco-recheck-1',
          rateType: 'RECHECK',
          net: '780.00',
          rateClass: 'NRF',
          cancellationPolicies: [],
        }),
      ],
    },
  ],
};

const FIXTURES_BY_DESTINATION: Record<string, HotelbedsHotel[]> = {
  MCO: [HOTEL_MCO_BOOKABLE, HOTEL_MCO_RECHECK],
};

// After a successful checkrate, the recheck rate gets a new rateKey and a
// slightly higher price (Hotelbeds simulates this; we mimic it).
const RECHECK_REPRICED: Record<string, HotelbedsRate> = {
  'mock-mco-recheck-1': makeRate({
    rateKey: 'mock-mco-recheck-1-repriced',
    rateType: 'BOOKABLE',
    net: '795.00',
    rateClass: 'NRF',
    cancellationPolicies: [],
  }),
};

// ---------------------------------------------------------------------------
// Activities + Transfers fixtures
//
// Synthetic data only — exercises the canonical types the field-mappers
// produce. Real shape comes from the live sandbox; see KB files.
// ---------------------------------------------------------------------------

const ACTIVITIES_BY_DESTINATION: Record<string, ActivityOffer[]> = {
  BCN: [
    {
      activityCode: 'E-A10-000100301',
      name: 'Sagrada Família — Skip-the-Line Tour',
      description: 'Guided tour of Gaudí’s basilica with priority entry.',
      duration: 'PT1H30M',
      location: { latitude: 41.4036, longitude: 2.1744 },
      images: ['https://example.invalid/img/sagrada-1.jpg'],
      cancellationPolicy: 'NOR',
      modalities: [
        {
          code: 'TOUR_GUIDE|EN|1',
          name: 'English Group Tour',
          price: { amount: '45.00', currency: 'EUR' },
          childPrice: { amount: '20.00', currency: 'EUR' },
          maxPax: 25,
          schedule: ['09:00', '11:00', '14:00'],
        },
        {
          code: 'TOUR_PRIVATE|EN|1',
          name: 'English Private Tour',
          price: { amount: '180.00', currency: 'EUR' },
          maxPax: 6,
        },
      ],
    },
  ],
};

const TRANSFERS_BY_FROM: Record<string, TransferOffer[]> = {
  // Keyed by `${type}:${code}` for the `from` location.
  'IATA:BCN': [
    {
      transferCode: 'mock-trf-BCN-private-sedan',
      transferType: 'PRIVATE',
      vehicleType: 'Sedan',
      maxPassengers: 3,
      price: { amount: '54.00', currency: 'EUR' },
      pickupInfo: { location: 'BCN T1 Arrivals', time: '14:30' },
      dropoffInfo: { location: 'Hotel Avenida Palace', estimatedTime: '15:30' },
      cancellationPolicy: 'Free cancellation up to 48h before pickup.',
    },
    {
      transferCode: 'mock-trf-BCN-shared-shuttle',
      transferType: 'SHARED',
      vehicleType: 'Shuttle Van 8pax',
      maxPassengers: 8,
      price: { amount: '12.00', currency: 'EUR' },
      pickupInfo: { location: 'BCN T1 Arrivals (Shared)', time: '15:00' },
      dropoffInfo: { location: 'Hotel Avenida Palace', estimatedTime: '16:15' },
      cancellationPolicy: 'Non-refundable.',
    },
  ],
};

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

export class MockHotelbedsAdapter implements HotelSourceAdapter {
  readonly adapterId = 'hotelbeds';
  readonly adapterName = 'Hotelbeds (mock)';

  private available = true;
  private readonly bookings = new Map<string, HotelbedsBooking>();
  private readonly activityBookings = new Map<string, ActivityBookResponse>();
  private readonly transferBookings = new Map<string, TransferBookResponse>();
  private nextRef = 1;
  private nextActivityRef = 1;
  private nextTransferRef = 1;

  setAvailable(available: boolean): void {
    this.available = available;
  }

  // -------------------------------------------------------------------------
  // HotelSourceAdapter
  // -------------------------------------------------------------------------

  async searchHotels(params: HotelSearchParams): Promise<RawHotelResult[]> {
    if (!this.available) {
      throw new Error('Hotelbeds (mock) is not available');
    }
    const hotels = FIXTURES_BY_DESTINATION[params.destination.toUpperCase()] ?? [];
    return hotels.map((h) =>
      mapHotelToRawResult(h, {
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        responseLatencyMs: 1,
      }),
    );
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  // -------------------------------------------------------------------------
  // Hotels API surface
  // -------------------------------------------------------------------------

  async availability(request: HotelbedsAvailabilityRequest): Promise<HotelbedsAvailabilityResponse> {
    this.assertAvailable();
    const code = request.destination?.code?.toUpperCase();
    const hotels = code ? (FIXTURES_BY_DESTINATION[code] ?? []) : [];
    return {
      hotels: {
        hotels,
        checkIn: request.stay.checkIn,
        checkOut: request.stay.checkOut,
        total: hotels.length,
      },
    };
  }

  async checkRate(request: HotelbedsCheckRateRequest): Promise<HotelbedsCheckRateResponse> {
    this.assertAvailable();
    const room = request.rooms[0];
    if (!room) {
      throw new Error('Hotelbeds (mock) checkrate requires at least one room');
    }
    const repriced = RECHECK_REPRICED[room.rateKey];
    if (repriced) {
      return {
        hotel: {
          ...HOTEL_MCO_RECHECK,
          rooms: [{ code: 'SUITE.ST', name: 'JUNIOR SUITE', rates: [repriced] }],
        },
      };
    }
    // BOOKABLE rate echoed back unchanged.
    const sourceHotel = HOTEL_MCO_BOOKABLE.rooms?.[0]?.rates?.find((r) => r.rateKey === room.rateKey);
    if (!sourceHotel) {
      throw new Error(`Hotelbeds (mock) checkrate: unknown rateKey ${room.rateKey}`);
    }
    return {
      hotel: {
        ...HOTEL_MCO_BOOKABLE,
        rooms: [{ code: 'STD.ST', name: 'STANDARD ROOM', rates: [sourceHotel] }],
      },
    };
  }

  async book(request: HotelbedsBookingRequest): Promise<HotelbedsBookingResponse> {
    this.assertAvailable();
    const reference = `MOCK-HB-${String(this.nextRef++).padStart(6, '0')}`;
    const booking: HotelbedsBooking = {
      reference,
      clientReference: request.clientReference,
      creationDate: new Date().toISOString(),
      status: 'CONFIRMED',
      holder: request.holder,
      totalNet: '610.00',
      currency: 'USD',
      hotel: HOTEL_MCO_BOOKABLE,
    };
    this.bookings.set(reference, booking);
    return { booking };
  }

  async getBooking(reference: string): Promise<HotelbedsBookingResponse> {
    this.assertAvailable();
    const booking = this.bookings.get(reference);
    if (!booking) {
      throw new Error(`Hotelbeds (mock) getBooking: unknown reference ${reference}`);
    }
    return { booking };
  }

  async listBookings(): Promise<HotelbedsBookingListResponse> {
    this.assertAvailable();
    return { bookings: Array.from(this.bookings.values()) };
  }

  async cancelBooking(
    reference: string,
    flag: HotelbedsCancellationFlag = 'SIMULATION',
  ): Promise<HotelbedsCancellationResponse> {
    this.assertAvailable();
    const booking = this.bookings.get(reference);
    if (!booking) {
      throw new Error(`Hotelbeds (mock) cancelBooking: unknown reference ${reference}`);
    }
    if (flag === 'SIMULATION') {
      return {
        booking: { ...booking, cancellationReference: `SIM-${reference}` },
      };
    }
    const cancelled: HotelbedsBooking = {
      ...booking,
      status: 'CANCELLED',
      cancellationReference: `CXL-${reference}`,
    };
    this.bookings.set(reference, cancelled);
    return { booking: cancelled };
  }

  // -------------------------------------------------------------------------
  // Activities API
  // -------------------------------------------------------------------------

  async searchActivities(request: ActivitySearchRequest): Promise<ActivityOffer[]> {
    this.assertAvailable();
    if (request.signal?.aborted) {
      throw new Error('Hotelbeds (mock) searchActivities aborted before dispatch');
    }
    return ACTIVITIES_BY_DESTINATION[request.destination.toUpperCase()] ?? [];
  }

  async bookActivity(request: ActivityBookRequest): Promise<ActivityBookResponse> {
    this.assertAvailable();
    if (request.signal?.aborted) {
      throw new Error('Hotelbeds (mock) bookActivity aborted before dispatch');
    }
    const reference = `MOCK-ACT-${String(this.nextActivityRef++).padStart(6, '0')}`;
    const result: ActivityBookResponse = {
      bookingReference: reference,
      status: 'CONFIRMED',
      clientReference: request.clientReference,
      voucherUrl: `https://example.invalid/voucher/${reference}.pdf`,
    };
    this.activityBookings.set(reference, result);
    return result;
  }

  async cancelActivity(bookingReference: string): Promise<ActivityCancelResponse> {
    this.assertAvailable();
    const booking = this.activityBookings.get(bookingReference);
    if (!booking) {
      throw new Error(`Hotelbeds (mock) cancelActivity: unknown reference ${bookingReference}`);
    }
    this.activityBookings.delete(bookingReference);
    return {
      status: 'CANCELLED',
      cancellationReference: `CXL-${bookingReference}`,
    };
  }

  // -------------------------------------------------------------------------
  // Transfers API
  // -------------------------------------------------------------------------

  async searchTransfers(request: TransferSearchRequest): Promise<TransferOffer[]> {
    this.assertAvailable();
    if (request.signal?.aborted) {
      throw new Error('Hotelbeds (mock) searchTransfers aborted before dispatch');
    }
    const key = `${request.from.type}:${request.from.code.toUpperCase()}`;
    return TRANSFERS_BY_FROM[key] ?? [];
  }

  async bookTransfer(request: TransferBookRequest): Promise<TransferBookResponse> {
    this.assertAvailable();
    if (request.signal?.aborted) {
      throw new Error('Hotelbeds (mock) bookTransfer aborted before dispatch');
    }
    const reference = `MOCK-TRF-${String(this.nextTransferRef++).padStart(6, '0')}`;
    const result: TransferBookResponse = {
      bookingReference: reference,
      status: 'CONFIRMED',
      clientReference: request.clientReference,
      pickupDetails: {
        location: 'BCN T1 Arrivals',
        time: '14:30',
        instructions: 'Driver will meet you at the meeting point with a sign.',
      },
    };
    this.transferBookings.set(reference, result);
    return result;
  }

  async cancelTransfer(bookingReference: string): Promise<TransferCancelResponse> {
    this.assertAvailable();
    const booking = this.transferBookings.get(bookingReference);
    if (!booking) {
      throw new Error(`Hotelbeds (mock) cancelTransfer: unknown reference ${bookingReference}`);
    }
    this.transferBookings.delete(bookingReference);
    return {
      status: 'CANCELLED',
      cancellationReference: `CXL-${bookingReference}`,
    };
  }

  // -------------------------------------------------------------------------

  async availabilityRawResults(
    request: HotelbedsAvailabilityRequest,
  ): Promise<RawHotelResult[]> {
    const response = await this.availability(request);
    const hotels = response.hotels?.hotels ?? [];
    return hotels.map((h) =>
      mapHotelToRawResult(h, {
        checkIn: request.stay.checkIn,
        checkOut: request.stay.checkOut,
        responseLatencyMs: 1,
      }),
    );
  }

  async bookSummary(request: HotelbedsBookingRequest): Promise<BookingSummary | null> {
    const response = await this.book(request);
    if (!response.booking) return null;
    return summarizeBooking(response.booking);
  }

  // -------------------------------------------------------------------------

  private assertAvailable(): void {
    if (!this.available) {
      throw new Error('Hotelbeds (mock) is not available');
    }
  }
}
