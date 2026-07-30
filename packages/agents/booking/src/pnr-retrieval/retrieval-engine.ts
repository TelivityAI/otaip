/**
 * PNR Retrieval Engine
 *
 * Delegates to ConnectAdapter.getBookingStatus() or a Duffel-like getOrder()
 * when a retrieval port is injected. Falls back to a structured stub only
 * when no port is configured (library/demo mode).
 */

import type {
  PnrRetrievalInput,
  PnrRetrievalOutput,
  RetrievalSource,
  BookingStatus,
  RetrievedPassenger,
  RetrievedSegment,
} from './types.js';

/** Minimal booking status shape from ConnectAdapter.getBookingStatus. */
export interface BookingStatusPortResult {
  bookingId: string;
  supplier: string;
  status: string;
  pnr?: string;
  airlinePnr?: string;
  ticketNumbers?: string[];
  segments: Array<
    Array<{
      departure: { iataCode: string; at?: string };
      arrival: { iataCode: string; at?: string };
      carrierCode: string;
      flightNumber: string;
      cabin?: string;
    }>
  >;
  passengers: Array<{
    firstName: string;
    lastName: string;
    dateOfBirth?: string;
    type?: string;
  }>;
  totalPrice?: { amount: string; currency: string };
}

export interface PnrRetrievalPort {
  getBookingStatus(bookingId: string): Promise<BookingStatusPortResult>;
}

/** Optional Duffel-style order fetch (documents → ticket numbers). */
export interface OrderRetrievalPort {
  getOrder(orderId: string): Promise<{
    id: string;
    booking_reference?: string;
    ticketNumbers?: Array<{ number: string }>;
    passengers?: Array<{ given_name?: string; family_name?: string; type?: string }>;
    slices?: Array<{
      segments?: Array<{
        origin?: { iata_code?: string };
        destination?: { iata_code?: string };
        marketing_carrier?: { iata_code?: string };
        marketing_carrier_flight_number?: string;
        departing_at?: string;
        cabin_class?: string;
      }>;
    }>;
  }>;
}

export interface RetrievePnrOptions {
  readonly bookingStatusPort?: PnrRetrievalPort;
  readonly orderPort?: OrderRetrievalPort;
}

function mapConnectStatus(status: string): BookingStatus {
  const s = status.toLowerCase();
  if (s.includes('ticket')) return 'TICKETED';
  if (s.includes('cancel')) return 'CANCELLED';
  if (s.includes('confirm') || s === 'hk') return 'CONFIRMED';
  if (s.includes('pending') || s.includes('hold')) return 'PENDING';
  if (s.includes('wait')) return 'WAITLISTED';
  return 'UNKNOWN';
}

function mapSource(input: PnrRetrievalInput, supplier?: string): RetrievalSource {
  if (input.source) return input.source;
  const s = (supplier ?? '').toUpperCase();
  if (s.includes('SABRE')) return 'SABRE';
  if (s.includes('AMADEUS')) return 'AMADEUS';
  if (s.includes('TRAVELPORT')) return 'TRAVELPORT';
  if (s.includes('DUFFEL') || s.includes('NDC')) return 'NDC';
  return 'AMADEUS';
}

function fromBookingStatus(
  input: PnrRetrievalInput,
  result: BookingStatusPortResult,
): PnrRetrievalOutput {
  const passengers: RetrievedPassenger[] = result.passengers.map((p, i) => ({
    pax_number: i + 1,
    last_name: p.lastName,
    first_name: p.firstName,
    passenger_type: (p.type as 'ADT' | 'CHD' | 'INF') ?? 'ADT',
    ...(p.dateOfBirth !== undefined ? { date_of_birth: p.dateOfBirth } : {}),
    ...(result.ticketNumbers && result.ticketNumbers.length > 0
      ? { ticket_numbers: result.ticketNumbers }
      : {}),
  }));

  const segments: RetrievedSegment[] = [];
  let segNum = 1;
  for (const group of result.segments) {
    for (const seg of group) {
      segments.push({
        segment_number: segNum++,
        carrier: seg.carrierCode,
        flight_number: seg.flightNumber,
        origin: seg.departure.iataCode,
        destination: seg.arrival.iataCode,
        departure_date: (seg.departure.at ?? '').slice(0, 10) || '1970-01-01',
        ...(seg.departure.at !== undefined
          ? { departure_time: seg.departure.at.slice(11, 16) }
          : {}),
        booking_class: seg.cabin ?? 'Y',
        status: 'HK',
      });
    }
  }

  const ticketed = (result.ticketNumbers?.length ?? 0) > 0;

  return {
    record_locator: result.pnr ?? input.record_locator,
    source: mapSource(input, result.supplier),
    booking_status: mapConnectStatus(result.status),
    passengers,
    segments,
    contacts: [],
    ticketing: { status: ticketed ? 'TICKETED' : 'NOT_TICKETED' },
    remarks: [`Retrieved via getBookingStatus from ${result.supplier}`],
  };
}

/**
 * Retrieve a PNR by record locator.
 */
export async function retrievePnr(
  input: PnrRetrievalInput,
  options?: RetrievePnrOptions,
): Promise<PnrRetrievalOutput> {
  if (options?.orderPort) {
    const order = await options.orderPort.getOrder(input.record_locator);
    const ticketNumbers = order.ticketNumbers?.map((t) => t.number) ?? [];
    const passengers: RetrievedPassenger[] = (order.passengers ?? []).map((p, i) => ({
      pax_number: i + 1,
      last_name: p.family_name ?? '',
      first_name: p.given_name ?? '',
      passenger_type: (p.type as 'ADT' | 'CHD' | 'INF') ?? 'ADT',
      ...(ticketNumbers.length > 0 ? { ticket_numbers: ticketNumbers } : {}),
    }));
    const segments: RetrievedSegment[] = [];
    let n = 1;
    for (const slice of order.slices ?? []) {
      for (const seg of slice.segments ?? []) {
        segments.push({
          segment_number: n++,
          carrier: seg.marketing_carrier?.iata_code ?? 'XX',
          flight_number: seg.marketing_carrier_flight_number ?? '0',
          origin: seg.origin?.iata_code ?? 'XXX',
          destination: seg.destination?.iata_code ?? 'XXX',
          departure_date: (seg.departing_at ?? '').slice(0, 10) || '1970-01-01',
          booking_class: seg.cabin_class ?? 'Y',
          status: 'HK',
        });
      }
    }
    return {
      record_locator: order.booking_reference ?? input.record_locator,
      source: 'NDC',
      booking_status: ticketNumbers.length > 0 ? 'TICKETED' : 'CONFIRMED',
      passengers,
      segments,
      contacts: [],
      ticketing: {
        status: ticketNumbers.length > 0 ? 'TICKETED' : 'NOT_TICKETED',
      },
      remarks: [`Retrieved via getOrder (${order.id})`],
    };
  }

  if (options?.bookingStatusPort) {
    const result = await options.bookingStatusPort.getBookingStatus(input.record_locator);
    return fromBookingStatus(input, result);
  }

  const source: RetrievalSource = input.source ?? 'AMADEUS';
  return {
    record_locator: input.record_locator,
    source,
    booking_status: 'CONFIRMED' as BookingStatus,
    passengers: [],
    segments: [],
    contacts: [],
    ticketing: { status: 'NOT_TICKETED' },
    remarks: [
      `Stub retrieval for ${input.record_locator} via ${source}. ` +
        'Inject bookingStatusPort (Connect getBookingStatus) or orderPort (getOrder) for real data.',
    ],
  };
}
