/**
 * Mock Duffel Adapter — realistic test data for Stage 1 agent tests.
 *
 * Returns pre-built flight offers for known city pairs.
 * TODO: [FUTURE] Replace with real Duffel API integration.
 */

import type {
  DistributionAdapter,
  SearchRequest,
  SearchResponse,
  SearchOffer,
  FlightSegment,
  PriceRequest,
  PriceResponse,
} from '@otaip/core';

import type {
  CarBookRequest,
  CarBookResponse,
  CarCancelResponse,
  CarQuote,
  CarRate,
  CarSearchRequest,
  CarSearchResult,
} from './cars-types.js';

// ---------------------------------------------------------------------------
// Mock flight data
// ---------------------------------------------------------------------------

interface MockRoute {
  origin: string;
  destination: string;
  offers: SearchOffer[];
}

function makeSegment(
  partial: Partial<FlightSegment> & {
    carrier: string;
    flight_number: string;
    origin: string;
    destination: string;
    departure_time: string;
    arrival_time: string;
    duration_minutes: number;
  },
): FlightSegment {
  return {
    operating_carrier: undefined,
    aircraft: undefined,
    booking_class: undefined,
    cabin_class: undefined,
    stops: 0,
    ...partial,
  };
}

const JFK_LAX_DIRECT: SearchOffer = {
  offer_id: 'mock-duffel-jfk-lax-1',
  source: 'duffel',
  itinerary: {
    source_id: 'duffel-itin-1',
    source: 'duffel',
    segments: [
      makeSegment({
        carrier: 'UA',
        flight_number: '1234',
        origin: 'JFK',
        destination: 'LAX',
        departure_time: '2025-06-15T08:00:00-04:00',
        arrival_time: '2025-06-15T11:30:00-07:00',
        duration_minutes: 330,
        aircraft: '787-9',
        booking_class: 'Y',
        cabin_class: 'economy',
      }),
    ],
    total_duration_minutes: 330,
    connection_count: 0,
  },
  price: {
    base_fare: 250,
    taxes: 45,
    total: 295,
    currency: 'USD',
    per_passenger: [{ type: 'ADT', base_fare: 250, taxes: 45, total: 295 }],
  },
  fare_basis: ['Y26NR'],
  booking_classes: ['Y'],
  instant_ticketing: true,
  expires_at: '2025-06-14T23:59:59Z',
};

const JFK_LAX_CONNECTING: SearchOffer = {
  offer_id: 'mock-duffel-jfk-lax-2',
  source: 'duffel',
  itinerary: {
    source_id: 'duffel-itin-2',
    source: 'duffel',
    segments: [
      makeSegment({
        carrier: 'UA',
        flight_number: '456',
        origin: 'JFK',
        destination: 'ORD',
        departure_time: '2025-06-15T07:00:00-04:00',
        arrival_time: '2025-06-15T08:30:00-05:00',
        duration_minutes: 150,
        aircraft: 'A320',
        booking_class: 'B',
        cabin_class: 'economy',
      }),
      makeSegment({
        carrier: 'UA',
        flight_number: '789',
        origin: 'ORD',
        destination: 'LAX',
        departure_time: '2025-06-15T10:00:00-05:00',
        arrival_time: '2025-06-15T12:15:00-07:00',
        duration_minutes: 255,
        aircraft: '737-900',
        booking_class: 'B',
        cabin_class: 'economy',
      }),
    ],
    total_duration_minutes: 495,
    connection_count: 1,
  },
  price: {
    base_fare: 180,
    taxes: 38,
    total: 218,
    currency: 'USD',
    per_passenger: [{ type: 'ADT', base_fare: 180, taxes: 38, total: 218 }],
  },
  fare_basis: ['B14NR'],
  booking_classes: ['B', 'B'],
  instant_ticketing: true,
  expires_at: '2025-06-14T23:59:59Z',
};

const JFK_LAX_BUSINESS: SearchOffer = {
  offer_id: 'mock-duffel-jfk-lax-3',
  source: 'duffel',
  itinerary: {
    source_id: 'duffel-itin-3',
    source: 'duffel',
    segments: [
      makeSegment({
        carrier: 'DL',
        flight_number: '100',
        origin: 'JFK',
        destination: 'LAX',
        departure_time: '2025-06-15T09:00:00-04:00',
        arrival_time: '2025-06-15T12:20:00-07:00',
        duration_minutes: 320,
        aircraft: 'A330-900',
        booking_class: 'J',
        cabin_class: 'business',
      }),
    ],
    total_duration_minutes: 320,
    connection_count: 0,
  },
  price: {
    base_fare: 1200,
    taxes: 95,
    total: 1295,
    currency: 'USD',
    per_passenger: [{ type: 'ADT', base_fare: 1200, taxes: 95, total: 1295 }],
  },
  fare_basis: ['J'],
  booking_classes: ['J'],
  instant_ticketing: true,
  expires_at: '2025-06-14T23:59:59Z',
};

const LHR_CDG_DIRECT: SearchOffer = {
  offer_id: 'mock-duffel-lhr-cdg-1',
  source: 'duffel',
  itinerary: {
    source_id: 'duffel-itin-4',
    source: 'duffel',
    segments: [
      makeSegment({
        carrier: 'BA',
        flight_number: '304',
        origin: 'LHR',
        destination: 'CDG',
        departure_time: '2025-06-15T10:00:00+01:00',
        arrival_time: '2025-06-15T12:15:00+02:00',
        duration_minutes: 75,
        aircraft: 'A320',
        booking_class: 'Y',
        cabin_class: 'economy',
      }),
    ],
    total_duration_minutes: 75,
    connection_count: 0,
  },
  price: {
    base_fare: 120,
    taxes: 55,
    total: 175,
    currency: 'GBP',
    per_passenger: [{ type: 'ADT', base_fare: 120, taxes: 55, total: 175 }],
  },
  fare_basis: ['YOW'],
  booking_classes: ['Y'],
  instant_ticketing: true,
};

const SFO_NRT_DIRECT: SearchOffer = {
  offer_id: 'mock-duffel-sfo-nrt-1',
  source: 'duffel',
  itinerary: {
    source_id: 'duffel-itin-5',
    source: 'duffel',
    segments: [
      makeSegment({
        carrier: 'NH',
        flight_number: '7',
        origin: 'SFO',
        destination: 'NRT',
        departure_time: '2025-06-15T11:00:00-07:00',
        arrival_time: '2025-06-16T14:00:00+09:00',
        duration_minutes: 660,
        aircraft: '787-10',
        booking_class: 'Y',
        cabin_class: 'economy',
      }),
    ],
    total_duration_minutes: 660,
    connection_count: 0,
  },
  price: {
    base_fare: 850,
    taxes: 120,
    total: 970,
    currency: 'USD',
    per_passenger: [{ type: 'ADT', base_fare: 850, taxes: 120, total: 970 }],
  },
  fare_basis: ['V14NR'],
  booking_classes: ['V'],
  instant_ticketing: true,
};

const MOCK_ROUTES: MockRoute[] = [
  {
    origin: 'JFK',
    destination: 'LAX',
    offers: [JFK_LAX_DIRECT, JFK_LAX_CONNECTING, JFK_LAX_BUSINESS],
  },
  { origin: 'LHR', destination: 'CDG', offers: [LHR_CDG_DIRECT] },
  { origin: 'SFO', destination: 'NRT', offers: [SFO_NRT_DIRECT] },
];

// ---------------------------------------------------------------------------
// MockDuffelAdapter
// ---------------------------------------------------------------------------

export class MockDuffelAdapter implements DistributionAdapter {
  readonly name = 'duffel';

  private available = true;

  /** Set adapter availability for testing error scenarios */
  setAvailable(available: boolean): void {
    this.available = available;
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    if (!this.available) {
      throw new Error('Duffel adapter is not available');
    }

    const firstSegment = request.segments[0];
    if (!firstSegment) {
      return { offers: [], truncated: false };
    }

    const route = MOCK_ROUTES.find(
      (r) => r.origin === firstSegment.origin && r.destination === firstSegment.destination,
    );

    if (!route) {
      return { offers: [], truncated: false };
    }

    let offers = [...route.offers];

    // Filter by cabin class if specified
    if (request.cabin_class) {
      offers = offers.filter((o) =>
        o.itinerary.segments.some((s) => s.cabin_class === request.cabin_class),
      );
    }

    // Filter direct only
    if (request.direct_only) {
      offers = offers.filter((o) => o.itinerary.connection_count === 0);
    }

    // Filter max connections
    if (request.max_connections !== undefined) {
      offers = offers.filter((o) => o.itinerary.connection_count <= request.max_connections!);
    }

    return {
      offers,
      truncated: false,
      metadata: { source: 'mock-duffel', route_count: MOCK_ROUTES.length },
    };
  }

  async price(request: PriceRequest): Promise<PriceResponse> {
    if (!this.available) {
      throw new Error('Duffel adapter is not available');
    }

    // Find the offer across all routes
    for (const route of MOCK_ROUTES) {
      const offer = route.offers.find((o) => o.offer_id === request.offer_id);
      if (offer) {
        return {
          price: offer.price,
          available: true,
          expires_at: offer.expires_at,
        };
      }
    }

    return {
      price: { base_fare: 0, taxes: 0, total: 0, currency: request.currency ?? 'USD' },
      available: false,
    };
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  // -------------------------------------------------------------------------
  // Cars — synthetic three-step (search → quote → book) flow
  //
  // Same interface as the live `DuffelAdapter`. State is in-memory and
  // shared across calls so the search/quote/book chain works without
  // hitting the network.
  // -------------------------------------------------------------------------

  private nextSearchSeq = 1;
  private nextQuoteSeq = 1;
  private nextBookingSeq = 1;
  private readonly carQuotes = new Map<string, CarQuote>();
  private readonly carBookings = new Map<string, CarBookResponse>();
  /** Maps a synthetic rate ID back to the underlying mock car so we can quote it. */
  private readonly carRatesById = new Map<string, CarRate>();

  async searchCars(request: CarSearchRequest): Promise<CarSearchResult> {
    if (request.signal?.aborted) {
      throw new Error('Mock Duffel Cars searchCars aborted before dispatch');
    }
    const searchId = `seh_mock_${String(this.nextSearchSeq++).padStart(6, '0')}`;
    const rates: CarRate[] = MOCK_CAR_FIXTURES.map((fixture, i) => ({
      ...fixture,
      rateId: `rae_mock_${searchId}_${i}`,
      searchId,
      pickupLocation: {
        ...fixture.pickupLocation,
        latitude: request.pickupLocation.latitude,
        longitude: request.pickupLocation.longitude,
      },
      dropoffLocation: {
        ...fixture.dropoffLocation,
        latitude: request.dropoffLocation.latitude,
        longitude: request.dropoffLocation.longitude,
      },
    }));
    for (const rate of rates) this.carRatesById.set(rate.rateId, rate);
    return { searchId, rates };
  }

  async quoteCar(rateId: string, signal?: AbortSignal): Promise<CarQuote> {
    if (signal?.aborted) {
      throw new Error('Mock Duffel Cars quoteCar aborted before dispatch');
    }
    const rate = this.carRatesById.get(rateId);
    if (!rate) throw new Error(`Mock Duffel Cars: unknown rateId ${rateId}`);
    const quoteId = `qut_mock_${String(this.nextQuoteSeq++).padStart(6, '0')}`;
    const quote: CarQuote = {
      quoteId,
      rateId: rate.rateId,
      searchId: rate.searchId,
      car: rate.car,
      supplier: rate.supplier,
      pickupLocation: rate.pickupLocation,
      dropoffLocation: rate.dropoffLocation,
      totalAmount: rate.totalAmount,
      conditions: [
        {
          title: 'Free cancellation',
          text: 'Cancel up to 48 hours before pickup for a full refund.',
        },
        { title: 'Fuel policy', text: 'Full-to-full. Return with a full tank.' },
      ],
      charges: [
        {
          amount: '5.00',
          currency: rate.totalAmount.currency,
          description: 'Mock airport surcharge',
        },
      ],
      mileage: { unlimited: true },
      privacyPolicies: [
        'Mock supplier privacy policy: data is shared with the rental agency.',
      ],
    };
    this.carQuotes.set(quoteId, quote);
    return quote;
  }

  async bookCar(request: CarBookRequest): Promise<CarBookResponse> {
    if (request.signal?.aborted) {
      throw new Error('Mock Duffel Cars bookCar aborted before dispatch');
    }
    const quote = this.carQuotes.get(request.quoteId);
    if (!quote) throw new Error(`Mock Duffel Cars: unknown quoteId ${request.quoteId}`);
    const bookingId = `boo_mock_${String(this.nextBookingSeq++).padStart(6, '0')}`;
    const booking: CarBookResponse = {
      bookingId,
      status: 'confirmed',
      reference: `MOCK-CAR-${bookingId.slice(-6).toUpperCase()}`,
      confirmedAt: new Date().toISOString(),
      car: quote.car,
      supplier: quote.supplier,
      pickupLocation: quote.pickupLocation,
      dropoffLocation: quote.dropoffLocation,
      totalAmount: quote.totalAmount,
    };
    this.carBookings.set(bookingId, booking);
    return booking;
  }

  async getCarBooking(bookingId: string, signal?: AbortSignal): Promise<CarBookResponse> {
    if (signal?.aborted) {
      throw new Error('Mock Duffel Cars getCarBooking aborted before dispatch');
    }
    const booking = this.carBookings.get(bookingId);
    if (!booking) {
      throw new Error(`Mock Duffel Cars: unknown bookingId ${bookingId}`);
    }
    return booking;
  }

  async cancelCarBooking(
    bookingId: string,
    signal?: AbortSignal,
  ): Promise<CarCancelResponse> {
    if (signal?.aborted) {
      throw new Error('Mock Duffel Cars cancelCarBooking aborted before dispatch');
    }
    const booking = this.carBookings.get(bookingId);
    if (!booking) {
      throw new Error(`Mock Duffel Cars: unknown bookingId ${bookingId}`);
    }
    if (booking.status === 'cancelled') {
      throw new Error(`Mock Duffel Cars: booking ${bookingId} already cancelled`);
    }
    this.carBookings.set(bookingId, { ...booking, status: 'cancelled' });
    return { status: 'cancelled', cancelledAt: new Date().toISOString() };
  }
}

// ---------------------------------------------------------------------------
// Mock car fixtures
//
// Each fixture is location-agnostic — coordinates are filled in from the
// search request so the response matches what the caller asked for.
// ---------------------------------------------------------------------------

const MOCK_CAR_FIXTURES: ReadonlyArray<Omit<CarRate, 'rateId' | 'searchId'>> = [
  {
    car: {
      name: 'Toyota Corolla',
      category: 'compact',
      type: 'four_door',
      transmission: 'automatic',
      fuel: 'petrol',
      acrissCode: 'CDAR',
      maxPassengers: 5,
      baggage: { small: 2, large: 1 },
      airConditioning: true,
      images: ['https://example.invalid/img/corolla.jpg'],
    },
    supplier: { name: 'Mock Rentals', logoUrl: 'https://example.invalid/logo/mock.png' },
    pickupLocation: {
      address: 'Mock Airport Pickup Counter',
      latitude: 0,
      longitude: 0,
      phone: '+1-555-0100',
      openingHours: '06:00–22:00',
    },
    dropoffLocation: {
      address: 'Mock Airport Dropoff Counter',
      latitude: 0,
      longitude: 0,
      phone: '+1-555-0100',
      openingHours: '06:00–22:00',
    },
    baseAmount: { amount: '180.00', currency: 'USD' },
    totalAmount: { amount: '212.40', currency: 'USD' },
    paymentType: 'prepaid',
  },
  {
    car: {
      name: 'Volkswagen Tiguan',
      category: 'suv',
      type: 'suv',
      transmission: 'automatic',
      fuel: 'diesel',
      acrissCode: 'IFAD',
      maxPassengers: 5,
      baggage: { small: 3, large: 2 },
      airConditioning: true,
      images: ['https://example.invalid/img/tiguan.jpg'],
    },
    supplier: { name: 'Mock Rentals', logoUrl: 'https://example.invalid/logo/mock.png' },
    pickupLocation: {
      address: 'Mock Airport Pickup Counter',
      latitude: 0,
      longitude: 0,
      phone: '+1-555-0100',
      openingHours: '06:00–22:00',
    },
    dropoffLocation: {
      address: 'Mock Airport Dropoff Counter',
      latitude: 0,
      longitude: 0,
      phone: '+1-555-0100',
      openingHours: '06:00–22:00',
    },
    baseAmount: { amount: '320.00', currency: 'USD' },
    totalAmount: { amount: '378.00', currency: 'USD' },
    paymentType: 'guarantee',
  },
];
