/**
 * DuffelConnectAdapter — bridges the low-level Duffel `DistributionAdapter`
 * (search/price/book) to OTAIP's high-level `ConnectAdapter` interface.
 *
 * This one object is the single source of truth for the demo: the OpenAPI spec
 * (for ChatGPT) and the HTTP routes both consume it, so the GPT's contract and
 * the backend can never drift.
 *
 * Sandbox only: backed by Duffel Test. Bookings are simulated, not real tickets.
 */

import { DuffelAdapter } from '@otaip/adapter-duffel';
import type { BookRequest } from '@otaip/adapter-duffel';
import type { SearchOffer } from '@otaip/core';
import type {
  BookingResult,
  BookingStatusResult,
  CabinClass,
  ConnectAdapter,
  CreateBookingInput,
  FareBreakdown,
  FlightOffer,
  FlightSegment,
  MoneyAmount,
  PassengerCount,
  PassengerDetail,
  PricedItinerary,
  SearchFlightsInput,
} from '@otaip/connect';

type DuffelTitle = 'mr' | 'ms' | 'mrs' | 'miss' | 'dr';
type DuffelPaxType = 'adult' | 'child' | 'infant_without_seat';

/** Max offers returned to the caller (ChatGPT Action payload cap + curation). */
const MAX_RESULTS = 10;

function money(amount: number, currency: string): MoneyAmount {
  return { amount: amount.toFixed(2), currency };
}

function minutesToDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `PT${h}H${m}M`;
}

function mapTitle(title: string | undefined, gender: 'M' | 'F'): DuffelTitle {
  const lowered = title?.toLowerCase();
  if (lowered === 'mr' || lowered === 'ms' || lowered === 'mrs' || lowered === 'miss' || lowered === 'dr') {
    return lowered;
  }
  return gender === 'M' ? 'mr' : 'ms';
}

function mapPaxType(type: PassengerDetail['type']): DuffelPaxType {
  if (type === 'child') return 'child';
  if (type === 'infant') return 'infant_without_seat';
  return 'adult';
}

/** Build the Duffel passenger-count array from the high-level passenger counts. */
function toDuffelPassengerCounts(
  passengers: PassengerCount,
): Array<{ type: 'ADT' | 'CHD' | 'INF'; count: number }> {
  const counts: Array<{ type: 'ADT' | 'CHD' | 'INF'; count: number }> = [
    { type: 'ADT', count: passengers.adults },
  ];
  if (passengers.children && passengers.children > 0) {
    counts.push({ type: 'CHD', count: passengers.children });
  }
  if (passengers.infants && passengers.infants > 0) {
    counts.push({ type: 'INF', count: passengers.infants });
  }
  return counts;
}

export class DuffelConnectAdapter implements ConnectAdapter {
  readonly supplierId = 'duffel';
  readonly supplierName = 'Duffel (Test)';

  /** Created lazily so the server can serve /openapi.json and the landing page
   * even before DUFFEL_API_KEY is set (the key is only needed for live calls). */
  private _duffel?: DuffelAdapter;

  /** In-memory record of bookings created this process, for getBookingStatus
   * (the Duffel adapter exposes no order-retrieval method). */
  private readonly bookings = new Map<string, BookingStatusResult>();

  private get duffel(): DuffelAdapter {
    if (!this._duffel) {
      this._duffel = new DuffelAdapter();
    }
    return this._duffel;
  }

  async searchFlights(input: SearchFlightsInput): Promise<FlightOffer[]> {
    const segments = [
      { origin: input.origin, destination: input.destination, departure_date: input.departureDate },
    ];
    if (input.returnDate) {
      segments.push({
        origin: input.destination,
        destination: input.origin,
        departure_date: input.returnDate,
      });
    }

    const result = await this.duffel.search({
      segments,
      passengers: toDuffelPassengerCounts(input.passengers),
      cabin_class: input.cabinClass ?? 'economy',
      direct_only: input.directOnly ?? false,
      currency: input.currency,
    });

    const cabin: CabinClass = input.cabinClass ?? 'economy';
    // Curate to the top results: keeps the response under ChatGPT's Action
    // payload limit and matches OTAIP's "few curated options" principle.
    return result.offers
      .slice(0, MAX_RESULTS)
      .map((offer) => this.toFlightOffer(offer, cabin, input.passengers.adults));
  }

  private toFlightOffer(offer: SearchOffer, cabin: CabinClass, adultCount: number): FlightOffer {
    const segments: FlightSegment[] = offer.itinerary.segments.map((seg) => ({
      origin: seg.origin,
      destination: seg.destination,
      marketingCarrier: seg.carrier,
      operatingCarrier: seg.operating_carrier,
      flightNumber: seg.flight_number,
      departure: seg.departure_time,
      arrival: seg.arrival_time,
      duration: minutesToDuration(seg.duration_minutes),
      cabinClass: seg.cabin_class ?? cabin,
      bookingClass: seg.booking_class ?? '',
      equipment: seg.aircraft,
      stops: seg.stops ?? 0,
    }));

    const fares: FareBreakdown[] = [
      {
        passengerType: 'adult',
        baseFare: money(offer.price.base_fare, offer.price.currency),
        taxes: money(offer.price.taxes, offer.price.currency),
        total: money(offer.price.total, offer.price.currency),
        count: adultCount,
      },
    ];

    return {
      offerId: offer.offer_id,
      supplier: this.supplierId,
      validatingCarrier: segments[0]?.marketingCarrier ?? '',
      // Duffel flattens slices into one segment list; we present a single leg.
      segments: [segments],
      fares,
      totalPrice: money(offer.price.total, offer.price.currency),
      fareType: 'published',
      cabinClass: cabin,
      refundable: false,
      changeable: false,
      expiresAt: offer.expires_at,
    };
  }

  async priceItinerary(offerId: string, passengers: PassengerCount): Promise<PricedItinerary> {
    const result = await this.duffel.price({
      offer_id: offerId,
      source: this.supplierId,
      passengers: toDuffelPassengerCounts(passengers),
    });
    const { base_fare, taxes, total, currency } = result.price;
    return {
      offerId,
      supplier: this.supplierId,
      totalPrice: money(total, currency),
      fares: [
        {
          passengerType: 'adult',
          baseFare: money(base_fare, currency),
          taxes: money(taxes, currency),
          total: money(total, currency),
          count: passengers.adults,
        },
      ],
      fareRules: { refundable: false, changeable: false },
      priceChanged: false,
      available: result.available,
    };
  }

  async createBooking(input: CreateBookingInput): Promise<BookingResult> {
    const passengers: BookRequest['passengers'] = input.passengers.map((p) => ({
      title: mapTitle(p.title, p.gender),
      given_name: p.firstName,
      family_name: p.lastName,
      born_on: p.dateOfBirth,
      email: input.contact.email,
      phone_number: input.contact.phone,
      gender: p.gender === 'M' ? 'm' : 'f',
      type: mapPaxType(p.type),
    }));

    const booked = await this.duffel.book({ offer_id: input.offerId, passengers });
    const totalPrice: MoneyAmount = {
      amount: booked.total_amount,
      currency: booked.total_currency,
    };

    const status: BookingStatusResult = {
      bookingId: booked.order_id,
      supplier: this.supplierId,
      status: 'confirmed',
      pnr: booked.booking_reference,
      // Duffel's order response does not echo segments; omitted for the demo.
      segments: [],
      passengers: input.passengers,
      totalPrice,
    };
    this.bookings.set(booked.order_id, status);

    return {
      bookingId: booked.order_id,
      supplier: this.supplierId,
      status: 'confirmed',
      pnr: booked.booking_reference,
      segments: [],
      passengers: input.passengers,
      totalPrice,
    };
  }

  async getBookingStatus(bookingId: string): Promise<BookingStatusResult> {
    const cached = this.bookings.get(bookingId);
    if (cached) return cached;
    return {
      bookingId,
      supplier: this.supplierId,
      status: 'confirmed',
      segments: [],
      passengers: [],
      totalPrice: { amount: '0.00', currency: 'USD' },
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const healthy = await this.duffel.isAvailable();
      return { healthy, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }
}
