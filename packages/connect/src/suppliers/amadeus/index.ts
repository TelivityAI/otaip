/**
 * Amadeus Self-Service supplier adapter for @otaip/connect.
 *
 * Maps Amadeus Self-Service APIs to the ConnectAdapter interface:
 *   - Flight Offers Search v2 (flight search)
 *   - Flight Offers Price v1 (price verification)
 *   - Flight Orders v1 (booking lifecycle)
 *
 * Auth: OAuth2 client_credentials, managed by the Amadeus SDK.
 * Uses the official `amadeus` Node.js SDK (MIT licensed) as a dependency.
 */

import Amadeus from 'amadeus';
import { BaseAdapter, ConnectError } from '../../base-adapter.js';
import type {
  BookingResult,
  BookingStatusResult,
  ConnectAdapter,
  CreateBookingInput,
  FlightOffer,
  PassengerCount,
  PricedItinerary,
  SearchFlightsInput,
} from '../../types.js';
import type { AmadeusConfig } from './config.js';
import { validateAmadeusConfig } from './config.js';
import {
  mapCreateBookingRequest,
  mapCreateBookingResponse,
  mapGetBookingResponse,
  mapPriceResponse,
  mapSearchParams,
  mapSearchResponse,
} from './mapper.js';
import type {
  AmadeusFlightOffer,
  AmadeusFlightOrderResponse,
  AmadeusFlightPriceResponse,
  AmadeusFlightSearchResponse,
} from './types.js';

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** 5xx / network / timeout shaped errors — cancel outcome unknown. */
function isAmbiguousCancelError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  return (
    lower.includes('timeout') ||
    lower.includes('network') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('fetch failed') ||
    lower.includes('aborted') ||
    /\b5\d\d\b/.test(lower) ||
    lower.includes('429')
  );
}

export class AmadeusAdapter extends BaseAdapter implements ConnectAdapter {
  readonly supplierId = 'amadeus';
  readonly supplierName = 'Amadeus Self-Service';
  private readonly config: AmadeusConfig;
  private readonly client: Amadeus;

  /**
   * Cached search offers keyed by Amadeus offer ID, used to pass
   * the raw offer to the pricing endpoint. Entries expire after 15 minutes.
   */
  private readonly searchOfferCache = new Map<string, CacheEntry<AmadeusFlightOffer>>();

  /**
   * Cached priced offers keyed by offerId, used to pass the full
   * flight offer object to the booking request (required by Amadeus).
   * Entries expire after 15 minutes.
   */
  private readonly pricedOfferCache = new Map<string, CacheEntry<AmadeusFlightOffer>>();

  private evictExpired<T>(cache: Map<string, CacheEntry<T>>): void {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now - entry.cachedAt > CACHE_TTL_MS) {
        cache.delete(key);
      }
    }
  }

  constructor(config: unknown) {
    super();
    this.config = validateAmadeusConfig(config);
    this.client = new Amadeus({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      hostname: this.config.environment,
    });
  }

  async searchFlights(input: SearchFlightsInput): Promise<FlightOffer[]> {
    return this.withRetry('searchFlights', async () => {
      const params = mapSearchParams(input, this.config.defaultCurrency);

      const response = await this.client.shopping.flightOffersSearch.get(params);

      const raw = response.result as unknown as AmadeusFlightSearchResponse;

      this.evictExpired(this.searchOfferCache);
      const now = Date.now();
      for (const offer of raw.data) {
        this.searchOfferCache.set(offer.id, { data: offer, cachedAt: now });
      }

      return mapSearchResponse(raw.data, raw.dictionaries);
    });
  }

  async priceItinerary(offerId: string, _passengers: PassengerCount): Promise<PricedItinerary> {
    return this.withRetry('priceItinerary', async () => {
      const amadeusId = offerId.replace(/^amadeus-/, '');

      // Retrieve the raw offer from the search cache or return unavailable.
      // In a real integration, the caller would pass the raw offer through.
      // For now, we require the offer to have been previously returned by searchFlights.
      const cachedEntry = this.findCachedRawOffer(amadeusId);
      const rawOffer = cachedEntry?.data;

      if (!rawOffer) {
        return {
          offerId,
          supplier: 'amadeus',
          totalPrice: { amount: '0', currency: 'USD' },
          fares: [],
          fareRules: { refundable: false, changeable: false },
          priceChanged: false,
          available: false,
        };
      }

      const priceResponse = await this.client.shopping.flightOffers.pricing.post(
        JSON.stringify({
          data: {
            type: 'flight-offers-pricing',
            flightOffers: [rawOffer],
          },
        }),
      );

      const priceResult = priceResponse.result as unknown as AmadeusFlightPriceResponse;
      const pricedOffers = priceResult.data.flightOffers;

      this.evictExpired(this.pricedOfferCache);
      const priceNow = Date.now();
      for (const po of pricedOffers) {
        this.pricedOfferCache.set(`amadeus-${po.id}`, { data: po, cachedAt: priceNow });
      }

      const originalSearchPrice = cachedEntry?.data.price.grandTotal;
      return mapPriceResponse(pricedOffers, offerId, originalSearchPrice);
    });
  }

  async createBooking(input: CreateBookingInput): Promise<BookingResult> {
    return this.withRetry('createBooking', async () => {
      const pricedOffer = this.pricedOfferCache.get(input.offerId)?.data;

      if (!pricedOffer) {
        throw new ConnectError(
          'createBooking: Offer not found in price cache. Call priceItinerary first.',
          this.supplierId,
          'createBooking',
          false,
        );
      }

      const body = mapCreateBookingRequest(input, pricedOffer);

      const response = await this.client.booking.flightOrders.post(JSON.stringify(body));

      this.pricedOfferCache.delete(input.offerId);

      const orderResult = response.result as unknown as AmadeusFlightOrderResponse;
      return mapCreateBookingResponse(orderResult.data);
    });
  }

  async getBookingStatus(bookingId: string): Promise<BookingStatusResult> {
    return this.withRetry('getBookingStatus', async () => {
      const response = await this.client.booking.flightOrders(bookingId).get();

      const orderResult = response.result as unknown as AmadeusFlightOrderResponse;
      return mapGetBookingResponse(orderResult.data, bookingId);
    });
  }

  async cancelBooking(bookingId: string): Promise<{ success: boolean; message: string }> {
    return this.withRetry('cancelBooking', async () => {
      try {
        await this.client.booking.flightOrders(bookingId).delete();
        return { success: true, message: `Booking ${bookingId} cancelled` };
      } catch (error: unknown) {
        // Ambiguous / transport failures must propagate so MoneyPathExecutor
        // records OUTCOME_UNKNOWN — never swallow into { success: false }.
        if (isAmbiguousCancelError(error)) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, message };
      }
    });
  }

  private findCachedRawOffer(amadeusId: string): CacheEntry<AmadeusFlightOffer> | undefined {
    const entry = this.searchOfferCache.get(amadeusId);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      this.searchOfferCache.delete(amadeusId);
      return undefined;
    }
    return entry;
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await this.client.shopping.flightOffersSearch.get({
        originLocationCode: 'JFK',
        destinationLocationCode: 'LHR',
        departureDate: '2099-12-31',
        adults: '1',
        max: '1',
      });
      return { healthy: true, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }
}
