/**
 * OTAIP Reference OTA — Sprint F types.
 *
 * Extends the core DistributionAdapter with booking, payment, and
 * ticketing methods needed by the OTA application layer.
 */

import type { DistributionAdapter } from '@otaip/core';

// ---------------------------------------------------------------------------
// Passenger detail (for booking)
// ---------------------------------------------------------------------------

export interface PassengerDetail {
  title: 'mr' | 'ms' | 'mrs' | 'miss' | 'dr';
  firstName: string;
  lastName: string;
  /** Date of birth in YYYY-MM-DD format */
  dateOfBirth: string;
  gender: 'male' | 'female';
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export interface BookingRequest {
  offerId: string;
  passengers: PassengerDetail[];
  contactEmail: string;
  contactPhone: string;
  /** Required for live Duffel money path — one supplier order per key. */
  idempotencyKey?: string;
}

export type BookingStatus = 'confirmed' | 'pending' | 'ticketed' | 'cancelled';

export interface BookingResult {
  bookingReference: string;
  status: BookingStatus;
  offerId: string;
  passengers: PassengerDetail[];
  contactEmail: string;
  contactPhone: string;
  ticketNumbers?: string[];
  totalAmount: string;
  currency: string;
  createdAt: string;
  /** Stripe PaymentIntent ID, when a Stripe flow is active. */
  paymentIntentId?: string;
  /** Stripe PaymentIntent client_secret — returned from book so the frontend can collect card details. */
  clientSecret?: string;
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export interface PaymentRequest {
  bookingReference: string;
  /** Mock: ignored. Real: Stripe payment method ID */
  paymentMethodId?: string;
}

export interface PaymentResult {
  paymentId: string;
  bookingReference: string;
  status: 'succeeded' | 'failed';
  amount: string;
  currency: string;
  paidAt: string;
}

// ---------------------------------------------------------------------------
// Ticketing
// ---------------------------------------------------------------------------

export interface TicketResult {
  bookingReference: string;
  status: BookingStatus;
  ticketNumbers: string[];
  ticketedAt: string;
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export interface CancelResult {
  success: boolean;
  message: string;
  bookingReference: string;
}

// ---------------------------------------------------------------------------
// OTA Adapter — extends DistributionAdapter with booking methods
// ---------------------------------------------------------------------------

export interface OtaAdapter extends DistributionAdapter {
  book(request: BookingRequest): Promise<BookingResult>;
  getBooking(reference: string): Promise<BookingResult | null>;
  cancelBooking(reference: string): Promise<CancelResult>;
}

// ---------------------------------------------------------------------------
// Booking lifecycle — in-memory hooks that Payment/Ticketing/Manage services
// use to advance a booking through its post-book states. Both MockOtaAdapter
// and DuffelOtaAdapter implement this; services type against the union so
// the same code path serves mock and live Duffel.
// ---------------------------------------------------------------------------

export interface BookingLifecycle {
  updateBookingPrice(reference: string, totalAmount: string, currency: string): void;
  /**
   * Record a payment against a booking. The optional `paymentIntentId`
   * carries the Stripe PaymentIntent reference when payments run through
   * Stripe; mock-mode payments leave it undefined.
   */
  recordPayment(reference: string, paymentId: string, paymentIntentId?: string): void;
  issueTickets(reference: string): string[] | null;
}
