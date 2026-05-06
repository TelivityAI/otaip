/**
 * Booking Service — creates bookings via the OTA adapter.
 *
 * Validates the offer exists in the search cache before booking.
 *
 * Sprint H multi-adapter: when the offer came from multi-adapter search,
 * the booking routes to the same adapter that produced it. An offer from
 * a search-only adapter (no `book()` method) is rejected explicitly rather
 * than silently routed elsewhere.
 */

import type { SearchService } from './search-service.js';
import type {
  BookingLifecycle,
  BookingResult,
  OtaAdapter,
  PassengerDetail,
} from '../types.js';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class BookingService {
  private readonly defaultAdapter: OtaAdapter & BookingLifecycle;
  private readonly searchService: SearchService;
  /**
   * Per-source booking adapters, keyed by the same `adapterSource` names
   * used by MultiSearchService. Only adapters that implement `book()` should
   * appear here; search-only adapters are intentionally omitted so bookings
   * against their offers fail loudly.
   */
  private readonly bookingAdapters: Map<string, OtaAdapter>;

  constructor(
    defaultAdapter: OtaAdapter & BookingLifecycle,
    searchService: SearchService,
    bookingAdapters?: Map<string, OtaAdapter>,
  ) {
    this.defaultAdapter = defaultAdapter;
    this.searchService = searchService;
    this.bookingAdapters = bookingAdapters ?? new Map();
  }

  /**
   * Create a booking for a previously searched offer.
   *
   * @throws OfferNotFoundError if the offer is not in the search cache.
   * @throws AdapterNotBookableError if the offer came from a multi-adapter
   *   source that does not implement booking.
   */
  async createBooking(
    offerId: string,
    passengers: PassengerDetail[],
    contactEmail: string,
    contactPhone: string,
  ): Promise<BookingResult> {
    const offer = this.searchService.getOffer(offerId);
    if (!offer) {
      throw new OfferNotFoundError(offerId);
    }

    // Route to the adapter that produced this offer. Single-adapter search
    // leaves `adapterSource` unset — fall through to the default adapter.
    const adapterSource = this.searchService.getOfferAdapterSource(offerId);
    const adapter = this.resolveAdapter(adapterSource);

    const result = await adapter.book({
      offerId,
      passengers,
      contactEmail,
      contactPhone,
    });

    // Update the booking with the actual price from the offer. Adapters that
    // implement BookingLifecycle (mock + DuffelOtaAdapter) participate;
    // search-only multi-adapter sources are filtered out before this point.
    if (hasBookingLifecycle(adapter)) {
      adapter.updateBookingPrice(
        result.bookingReference,
        offer.price.total.toFixed(2),
        offer.price.currency,
      );
    }

    return {
      ...result,
      totalAmount: offer.price.total.toFixed(2),
      currency: offer.price.currency,
    };
  }

  private resolveAdapter(adapterSource: string | undefined): OtaAdapter {
    if (adapterSource === undefined) {
      return this.defaultAdapter;
    }
    const booking = this.bookingAdapters.get(adapterSource);
    if (!booking) {
      throw new AdapterNotBookableError(adapterSource);
    }
    return booking;
  }
}

function hasBookingLifecycle(adapter: OtaAdapter): adapter is OtaAdapter & BookingLifecycle {
  return typeof (adapter as Partial<BookingLifecycle>).updateBookingPrice === 'function';
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OfferNotFoundError extends Error {
  constructor(offerId: string) {
    super(`Offer not found: ${offerId}. Search for flights first.`);
    this.name = 'OfferNotFoundError';
  }
}

export class AdapterNotBookableError extends Error {
  readonly adapterSource: string;
  constructor(adapterSource: string) {
    super(
      `Adapter '${adapterSource}' does not support booking. The offer was produced by a search-only source; booking must go through an adapter that implements book().`,
    );
    this.name = 'AdapterNotBookableError';
    this.adapterSource = adapterSource;
  }
}
