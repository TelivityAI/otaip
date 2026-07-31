/**
 * Duffel OTA Adapter — bridges the live DuffelAdapter into the reference OTA.
 *
 * Search / price / book go through Duffel's money-path executor (idempotent,
 * no blind retry). Ticket numbers come from Duffel order documents — live
 * mode refuses synthetic serials (DoD 5).
 */

import type {
  PriceRequest,
  PriceResponse,
  SearchRequest,
  SearchResponse,
} from '@otaip/core';
import { isLiveModeFromEnv, MoneyPathError } from '@otaip/core';
import { DuffelAdapter } from '@otaip/adapter-duffel';
import type {
  BookingLifecycle,
  BookingRequest,
  BookingResult,
  BookingStatus,
  CancelResult,
  OtaAdapter,
  PassengerDetail,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal booking record
// ---------------------------------------------------------------------------

interface BookingRecord {
  bookingReference: string;
  offerId: string;
  passengers: PassengerDetail[];
  contactEmail: string;
  contactPhone: string;
  status: BookingStatus;
  ticketNumbers?: string[];
  totalAmount: string;
  currency: string;
  createdAt: string;
  paymentId?: string;
  paymentIntentId?: string;
  ticketedAt?: string;
  /** Duffel order ID — useful for support / future operations. */
  duffelOrderId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapGender(gender: PassengerDetail['gender']): 'm' | 'f' {
  return gender === 'male' ? 'm' : 'f';
}

// ---------------------------------------------------------------------------
// DuffelOtaAdapter
// ---------------------------------------------------------------------------

export class DuffelOtaAdapter implements OtaAdapter, BookingLifecycle {
  readonly name = 'duffel-ota';
  private readonly duffel: DuffelAdapter;
  private readonly bookings = new Map<string, BookingRecord>();

  constructor(duffel?: DuffelAdapter) {
    this.duffel = duffel ?? new DuffelAdapter();
  }

  search(request: SearchRequest): Promise<SearchResponse> {
    return this.duffel.search(request);
  }

  price(request: PriceRequest): Promise<PriceResponse> {
    return this.duffel.price(request);
  }

  isAvailable(): Promise<boolean> {
    return this.duffel.isAvailable();
  }

  async book(request: BookingRequest): Promise<BookingResult> {
    const duffelPassengers = request.passengers.map((p) => ({
      title: p.title,
      given_name: p.firstName,
      family_name: p.lastName,
      born_on: p.dateOfBirth,
      email: request.contactEmail,
      phone_number: request.contactPhone,
      gender: mapGender(p.gender),
      type: 'adult' as const,
    }));

    const response = await this.duffel.book({
      offer_id: request.offerId,
      passengers: duffelPassengers,
      idempotencyKey:
        request.idempotencyKey ?? `ota-book:${request.offerId}:${request.contactEmail}`,
    });

    const reference = response.booking_reference;
    const now = new Date().toISOString();
    const supplierTickets = response.ticketNumbers?.map((t) => t.number);

    const record: BookingRecord = {
      bookingReference: reference,
      offerId: request.offerId,
      passengers: request.passengers,
      contactEmail: request.contactEmail,
      contactPhone: request.contactPhone,
      status: supplierTickets && supplierTickets.length > 0 ? 'ticketed' : 'confirmed',
      totalAmount: response.total_amount,
      currency: response.total_currency,
      createdAt: now,
      duffelOrderId: response.order_id,
      ...(supplierTickets && supplierTickets.length > 0
        ? { ticketNumbers: supplierTickets, ticketedAt: now }
        : {}),
    };

    this.bookings.set(reference, record);

    return this.toResult(record);
  }

  updateBookingPrice(reference: string, totalAmount: string, currency: string): void {
    const record = this.bookings.get(reference);
    if (record) {
      record.totalAmount = totalAmount;
      record.currency = currency;
    }
  }

  recordPayment(reference: string, paymentId: string, paymentIntentId?: string): void {
    const record = this.bookings.get(reference);
    if (!record) return;
    record.paymentId = paymentId;
    if (paymentIntentId !== undefined) record.paymentIntentId = paymentIntentId;
  }

  issueTickets(reference: string): string[] | null {
    const record = this.bookings.get(reference);
    if (!record) return null;

    if (record.ticketNumbers && record.ticketNumbers.length > 0) {
      record.status = 'ticketed';
      record.ticketedAt = record.ticketedAt ?? new Date().toISOString();
      return record.ticketNumbers;
    }

    // Try refresh from Duffel getOrder (documents may populate after instant issue).
    // Sync API — refresh is async; callers should use getOrder path. Fail closed in live.
    if (isLiveModeFromEnv()) {
      throw new MoneyPathError(
        'Live mode refuses synthetic ticket numbers — wait for Duffel order documents / getOrder',
      );
    }

    // Demo / non-live only: no supplier documents yet.
    return null;
  }

  async getBooking(reference: string): Promise<BookingResult | null> {
    const record = this.bookings.get(reference);
    if (!record) return null;
    return this.toResult(record);
  }

  async cancelBooking(reference: string): Promise<CancelResult> {
    const record = this.bookings.get(reference);

    if (!record) {
      return {
        success: false,
        message: `Booking not found: ${reference}`,
        bookingReference: reference,
      };
    }

    if (record.status === 'ticketed') {
      return {
        success: false,
        message: 'Cannot cancel a ticketed booking. Contact support for refunds.',
        bookingReference: reference,
      };
    }

    if (record.status === 'cancelled') {
      return {
        success: false,
        message: 'Booking is already cancelled.',
        bookingReference: reference,
      };
    }

    // TODO: live Duffel order cancellation goes here (POST /air/order_cancellations).
    // The reference OTA cancels locally only — sandbox orders remain on Duffel
    // until they expire. Wiring real cancellation is a follow-up.
    record.status = 'cancelled';

    return {
      success: true,
      message: 'Booking cancelled successfully.',
      bookingReference: reference,
    };
  }

  private toResult(record: BookingRecord): BookingResult {
    return {
      bookingReference: record.bookingReference,
      status: record.status,
      offerId: record.offerId,
      passengers: record.passengers,
      contactEmail: record.contactEmail,
      contactPhone: record.contactPhone,
      ticketNumbers: record.ticketNumbers,
      totalAmount: record.totalAmount,
      currency: record.currency,
      createdAt: record.createdAt,
      ...(record.paymentIntentId ? { paymentIntentId: record.paymentIntentId } : {}),
    };
  }
}

// Re-export so consumers don't need to dig into the package layout
export type { DistributionAdapter };
