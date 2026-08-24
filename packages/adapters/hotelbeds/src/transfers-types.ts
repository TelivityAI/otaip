/**
 * Hotelbeds Transfers API — types.
 *
 * Same two-layer split as the Activities module: wire types describe the
 * Hotelbeds JSON; canonical types are the OTAIP-facing shape.
 * See `docs/knowledge-base/transfers.md` for CLOSED / open DOMAIN_QUESTIONs.
 */

import type { Money } from './shared-types.js';

// ---------------------------------------------------------------------------
// Canonical (OTAIP-facing) types
// ---------------------------------------------------------------------------

export type TransferLocationType = 'IATA' | 'ATLAS' | 'GPS';

export interface TransferLocation {
  type: TransferLocationType;
  /**
   * Location code. Format depends on `type`:
   *   - IATA — three-letter airport/station code.
   *   - ATLAS — Hotelbeds internal numeric identifier (string).
   *   - GPS — `"lat, lon"` with ≥3 decimal places (DQ-T2 CLOSED).
   */
  code: string;
}

export interface TransferSearchRequest {
  from: TransferLocation;
  to: TransferLocation;
  /** ISO date for the outbound leg. */
  outboundDate: string;
  /**
   * HH:mm 24-hour clock (brief). Official Simple path uses combined
   * `YYYY-MM-DDTHH:mm:ss`. Request-clock timezone still open — DQ-T3.
   */
  outboundTime: string;
  adults: number;
  children?: number;
  signal?: AbortSignal;
}

/**
 * Documented transfer classes. Official Availability Simple lists
 * SHARED | PRIVATE; brief also listed LUXURY. Mapper passes unknown
 * values through as `TransferType | string`.
 */
export type TransferType = 'PRIVATE' | 'SHARED' | 'LUXURY';

/**
 * Stepped cancellation penalty from Hotelbeds `cancellationPolicies[]`.
 * `from` is destination local time (DQ-T1/cancel docs + Availability Simple).
 */
export interface TransferCancellationPenalty {
  amount: string;
  from: string;
  currencyId?: string;
  utcOffset?: string;
}

export interface TransferOffer {
  transferCode: string;
  /** Documented enum or raw supplier value when unknown. */
  transferType: TransferType | string;
  /** Free-form vehicle descriptor — e.g. "Sedan", "Minibus 8pax". */
  vehicleType: string;
  maxPassengers: number;
  /**
   * Service/booking total (not per-pax). Prefer netAmount when present
   * (DQ-T4 / DQ-T7 CLOSED).
   */
  price: Money;
  /** Official totalAmount when distinct from net — not Hotels sellingRate. */
  totalPrice?: Money;
  pickupInfo: { location: string; time: string };
  dropoffInfo: { location: string; estimatedTime: string };
  /** Free-text cancellation policy when only a string is present on the wire. */
  cancellationPolicy: string;
  /** Structured penalties when Hotelbeds returns cancellationPolicies[]. */
  cancellationPolicies?: TransferCancellationPenalty[];
}

export interface TransferBookRequest {
  transferCode: string;
  holder: { name: string; surname: string };
  passengers: Array<{ type: 'ADULT' | 'CHILD'; name: string; surname: string }>;
  clientReference: string;
  /** Required in live mode for money-path idempotency. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * Documented Transfers response statuses include CONFIRMED | CANCELLED | MODIFIED.
 * Vendor brief also listed ON_REQUEST — DQ-T6 remains OPEN (do not infer from
 * Activities “no OnRequest” marketing). Adapter passes ON_REQUEST through.
 */
export type TransferBookingStatus = 'CONFIRMED' | 'CANCELLED' | 'MODIFIED' | 'ON_REQUEST';

export interface TransferBookResponse {
  bookingReference: string;
  status: TransferBookingStatus;
  clientReference: string;
  pickupDetails: { location: string; time: string; instructions?: string };
}

export interface TransferCancelResponse {
  status: 'CANCELLED';
  cancellationReference: string;
}

// ---------------------------------------------------------------------------
// Wire types — Hotelbeds Transfers API
// ---------------------------------------------------------------------------

export interface HotelbedsTransfersAvailabilityRequest {
  language?: string;
  from: { type: TransferLocationType; code: string };
  to: { type: TransferLocationType; code: string };
  outbound: { date: string; time: string };
  inbound?: { date: string; time: string };
  adults: number;
  children?: number;
}

export interface HotelbedsTransfersAvailabilityResponse {
  /** Brief-shape list used by existing fixtures. */
  transfers?: HotelbedsTransfer[];
  /**
   * Official Availability Simple uses `services[]`. Mapper accepts either
   * (recorded fixtures may use the official key).
   */
  services?: HotelbedsTransfer[];
  auditData?: { timestamp?: string };
}

export interface HotelbedsTransferCancellationPolicy {
  amount?: number | string;
  from?: string;
  currencyId?: string;
  utcOffset?: string;
}

export interface HotelbedsTransfer {
  /** Opaque booking key returned in availability and consumed by /bookings. */
  transferCode?: string;
  /** Official Simple uses rateKey for confirmation. */
  rateKey?: string;
  /** Documented set: PRIVATE | SHARED | LUXURY (brief). Official: SHARED | PRIVATE. */
  transferType?: string;
  vehicleType?: string;
  vehicle?: { code?: string; name?: string };
  maxPassengers?: number;
  maxPaxCapacity?: number;
  /** Brief-shape per-service net amount as decimal string. */
  amount?: string;
  currency?: string;
  /** Official price object (DQ-T7). */
  price?: {
    totalAmount?: number | string | null;
    netAmount?: number | string | null;
    currencyId?: string;
  };
  pickupInformation?: {
    from?: { code?: string; description?: string; type?: string };
    to?: { code?: string; description?: string; type?: string };
    date?: string;
    time?: string;
    pickup?: { location?: string; time?: string; description?: string };
    dropoff?: { location?: string; estimatedTime?: string };
  };
  /** Brief free-text. */
  cancellationPolicy?: string;
  /** Official stepped policies — destination local time. */
  cancellationPolicies?: HotelbedsTransferCancellationPolicy[];
}

export interface HotelbedsTransfersBookingRequest {
  transferCode: string;
  holder: { name: string; surname: string };
  passengers: Array<{ type: 'ADULT' | 'CHILD'; name: string; surname: string }>;
  clientReference: string;
}

export interface HotelbedsTransfersBookingResponse {
  booking?: {
    reference: string;
    clientReference?: string;
    status?: string;
    pickup?: { location?: string; time?: string; instructions?: string };
  };
  auditData?: { timestamp?: string };
}

export interface HotelbedsTransfersCancellationResponse {
  booking?: {
    reference: string;
    cancellationReference?: string;
    status?: string;
  };
  /** Official cancel response may wrap bookings[] — tolerate either. */
  bookings?: Array<{
    reference?: string;
    status?: string;
    totalAmount?: number | string;
  }>;
  auditData?: { timestamp?: string };
}
