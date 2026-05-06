/**
 * Live Duffel Adapter — connects to the Duffel NDC REST API.
 *
 * Implements DistributionAdapter for real Duffel API calls.
 * Uses global fetch (Node 24+). All monetary math via decimal.js.
 *
 * Endpoints used:
 *   POST /air/offer_requests   — search
 *   POST /air/offer_price_confirmations — price (currently not available in Duffel public API, uses offers endpoint)
 *   GET  /air/airlines          — health check
 */

import type {
  DistributionAdapter,
  SearchRequest,
  SearchResponse,
  SearchOffer,
  FlightSegment,
  PriceRequest,
  PriceResponse,
  PriceBreakdown,
} from '@otaip/core';
import { fetchWithRetry } from '@otaip/core';
import Decimal from 'decimal.js';

import type {
  CarBookRequest,
  CarBookResponse,
  CarCancelResponse,
  CarQuote,
  CarSearchRequest,
  CarSearchResult,
  DuffelCarsBookingRequest,
  DuffelCarsBookingResponse,
  DuffelCarsCancelResponse,
  DuffelCarsQuoteRequest,
  DuffelCarsQuoteResponse,
  DuffelCarsSearchRequest,
  DuffelCarsSearchResponse,
} from './cars-types.js';
import {
  mapBookingResponse as mapCarBookingResponse,
  mapCancelResponse as mapCarCancelResponse,
  mapQuoteResponse as mapCarQuoteResponse,
  mapSearchResponse as mapCarSearchResponse,
} from './cars-mapper.js';

const DUFFEL_BASE_URL = 'https://api.duffel.com';

/**
 * Parse ISO 8601 duration (e.g., "PT5H30M") to minutes.
 * Returns 0 for unparseable input.
 */
export function parseDurationToMinutes(iso: string | null | undefined): number {
  if (!iso) return 0;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const hours = parseInt(match[1] ?? '0', 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  return hours * 60 + minutes;
}

function mapCabinClass(duffelCabin: string): FlightSegment['cabin_class'] {
  switch (duffelCabin) {
    case 'economy':
      return 'economy';
    case 'premium_economy':
      return 'premium_economy';
    case 'business':
      return 'business';
    case 'first':
      return 'first';
    default:
      return 'economy';
  }
}

interface DuffelSlice {
  segments: DuffelSegment[];
  duration?: string;
}

interface DuffelSegment {
  marketing_carrier?: { iata_code?: string };
  operating_carrier?: { iata_code?: string };
  marketing_carrier_flight_number?: string;
  origin?: { iata_code?: string };
  destination?: { iata_code?: string };
  departing_at?: string;
  arriving_at?: string;
  duration?: string;
  aircraft?: { name?: string };
  passengers?: Array<{
    cabin_class?: string;
    cabin_class_marketing_name?: string;
    fare_basis_code?: string;
  }>;
}

interface DuffelOffer {
  id: string;
  slices?: DuffelSlice[];
  total_amount?: string;
  total_currency?: string;
  base_amount?: string;
  base_currency?: string;
  tax_amount?: string;
  tax_currency?: string;
  passengers?: Array<{
    type?: string;
    fare_basis_codes?: Array<{ fare_basis_code?: string }>;
  }>;
  live_mode?: boolean;
  expires_at?: string;
  payment_requirements?: {
    requires_instant_payment?: boolean;
  };
}

interface DuffelApiError {
  errors?: Array<{ message?: string; type?: string; code?: string }>;
}

/** Typed response wrappers for Duffel API endpoints */
interface DuffelOfferRequestResponse {
  data: {
    id?: string;
    offers?: DuffelOffer[];
  };
}

interface DuffelOfferResponse {
  data: DuffelOffer;
}

interface DuffelOrderResponse {
  data: {
    id?: string;
    booking_reference?: string;
    total_amount?: string;
    total_currency?: string;
    passengers?: Array<Record<string, unknown>>;
  };
}

interface DuffelOfferWithPassengers {
  data: DuffelOffer & {
    passengers?: Array<{ id?: string; type?: string }>;
    total_amount?: string;
    total_currency?: string;
  };
}

function mapDuffelOffer(offer: DuffelOffer): SearchOffer {
  const segments: FlightSegment[] = [];
  let totalDuration = 0;

  for (const slice of offer.slices ?? []) {
    for (const seg of slice.segments ?? []) {
      const duration = parseDurationToMinutes(seg.duration);
      totalDuration += duration;

      const pax0 = seg.passengers?.[0];

      segments.push({
        carrier: seg.marketing_carrier?.iata_code ?? '',
        flight_number: seg.marketing_carrier_flight_number ?? '',
        operating_carrier: seg.operating_carrier?.iata_code,
        origin: seg.origin?.iata_code ?? '',
        destination: seg.destination?.iata_code ?? '',
        departure_time: seg.departing_at ?? '',
        arrival_time: seg.arriving_at ?? '',
        duration_minutes: duration,
        aircraft: seg.aircraft?.name,
        cabin_class: mapCabinClass(pax0?.cabin_class ?? 'economy'),
        stops: 0,
      });
    }
  }

  const baseFare = offer.base_amount ? new Decimal(offer.base_amount).toNumber() : 0;
  const taxes = offer.tax_amount ? new Decimal(offer.tax_amount).toNumber() : 0;
  const total = offer.total_amount ? new Decimal(offer.total_amount).toNumber() : 0;
  const currency = offer.total_currency ?? 'USD';

  const price: PriceBreakdown = {
    base_fare: baseFare,
    taxes,
    total,
    currency,
  };

  const fareBasisCodes: string[] = [];
  for (const pax of offer.passengers ?? []) {
    for (const fbc of pax.fare_basis_codes ?? []) {
      if (fbc.fare_basis_code) fareBasisCodes.push(fbc.fare_basis_code);
    }
  }

  return {
    offer_id: offer.id,
    source: 'duffel',
    itinerary: {
      source_id: offer.id,
      source: 'duffel',
      segments,
      total_duration_minutes: totalDuration,
      connection_count: Math.max(0, segments.length - 1),
    },
    price,
    fare_basis: fareBasisCodes.length > 0 ? fareBasisCodes : undefined,
    instant_ticketing: offer.payment_requirements?.requires_instant_payment ?? false,
    expires_at: offer.expires_at,
  };
}

export interface BookRequest {
  offer_id: string;
  passengers: Array<{
    title: 'mr' | 'ms' | 'mrs' | 'miss' | 'dr';
    given_name: string;
    family_name: string;
    born_on: string;
    email: string;
    phone_number: string;
    gender: 'm' | 'f';
    type: 'adult' | 'child' | 'infant_without_seat';
  }>;
}

export interface BookResponse {
  booking_reference: string;
  order_id: string;
  total_amount: string;
  total_currency: string;
  passengers: unknown[];
}

export class DuffelAdapter implements DistributionAdapter {
  readonly name = 'duffel';
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    const resolvedKey = apiKey ?? process.env['DUFFEL_API_KEY'] ?? '';
    if (!resolvedKey || resolvedKey.trim().length === 0) {
      throw new Error(
        'DuffelAdapter requires a valid API key. Pass it to the constructor or set DUFFEL_API_KEY env var.',
      );
    }
    this.apiKey = resolvedKey;
    this.baseUrl = baseUrl ?? DUFFEL_BASE_URL;
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    const slices = request.segments.map((seg) => ({
      origin: seg.origin,
      destination: seg.destination,
      departure_date: seg.departure_date,
    }));

    const passengers = request.passengers.flatMap((p) =>
      Array.from({ length: p.count }, () => ({
        type: p.type === 'ADT' ? 'adult' : p.type === 'CHD' ? 'child' : 'infant_without_seat',
      })),
    );

    const body: Record<string, unknown> = {
      data: {
        slices,
        passengers,
        cabin_class: request.cabin_class ?? 'economy',
        return_offers: true,
        max_connections: request.direct_only ? 0 : (request.max_connections ?? undefined),
      },
    };

    if (request.currency) {
      (body['data'] as Record<string, unknown>)['currency'] = request.currency;
    }

    const response = (await this.request(
      'POST',
      '/air/offer_requests',
      body,
    )) as DuffelOfferRequestResponse;
    const offers: DuffelOffer[] = response.data?.offers ?? [];

    return {
      offers: offers.map(mapDuffelOffer),
      truncated: false,
      metadata: { source: 'duffel', offer_request_id: response.data?.id },
    };
  }

  async price(request: PriceRequest): Promise<PriceResponse> {
    const response = (await this.request(
      'GET',
      `/air/offers/${request.offer_id}`,
    )) as DuffelOfferResponse;
    const offer: DuffelOffer | undefined = response.data;

    if (!offer) {
      return {
        price: { base_fare: 0, taxes: 0, total: 0, currency: request.currency ?? 'USD' },
        available: false,
      };
    }

    const mapped = mapDuffelOffer(offer);
    return {
      price: mapped.price,
      available: true,
      expires_at: mapped.expires_at,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.request('GET', '/air/airlines?limit=1');
      return true;
    } catch {
      return false;
    }
  }

  async book(request: BookRequest): Promise<BookResponse> {
    // Fetch the offer to get Duffel passenger IDs and total for payment
    const offerResponse = (await this.request(
      'GET',
      `/air/offers/${request.offer_id}?return_available_services=false`,
    )) as DuffelOfferWithPassengers;
    const offer = offerResponse.data;
    if (!offer) {
      throw new Error('Could not fetch offer details for booking');
    }

    // Map Duffel passenger IDs to the provided passenger details
    const duffelPassengers: Array<{ id?: string; type?: string }> = offer.passengers ?? [];
    const passengers = request.passengers.map((pax, i) => ({
      ...pax,
      id: duffelPassengers[i]?.id ?? '',
    }));

    const body = {
      data: {
        selected_offers: [request.offer_id],
        passengers,
        type: 'instant' as const,
        payments: [
          {
            type: 'balance' as const,
            currency: offer.total_currency ?? 'GBP',
            amount: offer.total_amount ?? '0',
          },
        ],
      },
    };

    const response = (await this.request('POST', '/air/orders', body)) as DuffelOrderResponse;
    const order = response.data;

    if (!order) {
      throw new Error('Duffel order creation returned no data');
    }

    return {
      booking_reference: order.booking_reference ?? '',
      order_id: order.id ?? '',
      total_amount: order.total_amount ?? '0',
      total_currency: order.total_currency ?? 'GBP',
      passengers: order.passengers ?? [],
    };
  }

  // -------------------------------------------------------------------------
  // Cars API — search → quote → book
  //
  // Three-step flow (search → quote → book), unlike the two-step flight
  // flow (search → book). Geo-coordinate based, not IATA codes. See
  // `docs/knowledge-base/cars.md` for the authoritative domain input
  // and outstanding DOMAIN_QUESTIONs.
  // -------------------------------------------------------------------------

  async searchCars(request: CarSearchRequest): Promise<CarSearchResult> {
    const body: DuffelCarsSearchRequest = {
      data: {
        pickup_date: request.pickupDate,
        pickup_time: request.pickupTime,
        pickup_location: {
          ...(request.pickupLocation.radius !== undefined
            ? { radius: request.pickupLocation.radius }
            : {}),
          geographic_coordinates: {
            latitude: request.pickupLocation.latitude,
            longitude: request.pickupLocation.longitude,
          },
        },
        dropoff_date: request.dropoffDate,
        dropoff_time: request.dropoffTime,
        dropoff_location: {
          ...(request.dropoffLocation.radius !== undefined
            ? { radius: request.dropoffLocation.radius }
            : {}),
          geographic_coordinates: {
            latitude: request.dropoffLocation.latitude,
            longitude: request.dropoffLocation.longitude,
          },
        },
        driver: {
          age: request.driver.age,
          residence_country_code: request.driver.residenceCountryCode,
        },
      },
    };
    const response = (await this.request(
      'POST',
      '/cars/search',
      body as unknown as Record<string, unknown>,
      request.signal ? { signal: request.signal } : {},
    )) as DuffelCarsSearchResponse;
    return mapCarSearchResponse(response);
  }

  async quoteCar(rateId: string, signal?: AbortSignal): Promise<CarQuote> {
    const body: DuffelCarsQuoteRequest = { data: { rate_id: rateId } };
    const response = (await this.request(
      'POST',
      '/cars/quotes',
      body as unknown as Record<string, unknown>,
      signal ? { signal } : {},
    )) as DuffelCarsQuoteResponse;
    return mapCarQuoteResponse(response);
  }

  async bookCar(request: CarBookRequest): Promise<CarBookResponse> {
    const body: DuffelCarsBookingRequest = {
      data: {
        quote_id: request.quoteId,
        driver: {
          given_name: request.driver.givenName,
          family_name: request.driver.familyName,
          email: request.driver.email,
          phone_number: request.driver.phoneNumber,
          ...(request.driver.dateOfBirth ? { date_of_birth: request.driver.dateOfBirth } : {}),
        },
        ...(request.payment ? { payment: request.payment } : {}),
        ...(request.metadata ? { metadata: request.metadata } : {}),
        ...(request.inboundFlightNumber
          ? { inbound_flight_number: request.inboundFlightNumber }
          : {}),
      },
    };
    const response = (await this.request(
      'POST',
      '/cars/bookings',
      body as unknown as Record<string, unknown>,
      request.signal ? { signal: request.signal } : {},
    )) as DuffelCarsBookingResponse;
    return mapCarBookingResponse(response);
  }

  async getCarBooking(bookingId: string, signal?: AbortSignal): Promise<CarBookResponse> {
    const response = (await this.request(
      'GET',
      `/cars/bookings/${encodeURIComponent(bookingId)}`,
      undefined,
      signal ? { signal } : {},
    )) as DuffelCarsBookingResponse;
    return mapCarBookingResponse(response);
  }

  async cancelCarBooking(
    bookingId: string,
    signal?: AbortSignal,
  ): Promise<CarCancelResponse> {
    const response = (await this.request(
      'POST',
      `/cars/bookings/${encodeURIComponent(bookingId)}/actions/cancel`,
      undefined,
      signal ? { signal } : {},
    )) as DuffelCarsCancelResponse;
    return mapCarCancelResponse(response);
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    if (options.signal?.aborted) {
      throw new Error('Duffel API request aborted before dispatch');
    }
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Duffel-Version': 'v2',
      Accept: 'application/json',
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetchWithRetry(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown network error';
      throw new Error(`Duffel API network error: ${message}`);
    }

    if (!response.ok) {
      let errorDetail = '';
      try {
        const errorBody = (await response.json()) as DuffelApiError;
        errorDetail = errorBody.errors?.[0]?.message ?? '';
      } catch {
        // ignore parse errors
      }

      if (response.status === 429) {
        throw new Error(`Duffel API rate limited (429). ${errorDetail}`.trim());
      }

      throw new Error(
        `Duffel API error ${response.status}: ${errorDetail || response.statusText}`.trim(),
      );
    }

    return response.json();
  }
}
