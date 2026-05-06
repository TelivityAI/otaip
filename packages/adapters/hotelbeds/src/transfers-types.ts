/**
 * Hotelbeds Transfers API — types.
 *
 * Same two-layer split as the Activities module: wire types describe the
 * Hotelbeds JSON; canonical types are the OTAIP-facing shape from the
 * vendor brief. See `docs/knowledge-base/transfers.md` for outstanding
 * DOMAIN_QUESTIONs (location code formats, timezone semantics, etc.).
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
   *   - GPS — latitude/longitude payload — see DQ-T2 in KB.
   */
  code: string;
}

export interface TransferSearchRequest {
  from: TransferLocation;
  to: TransferLocation;
  /** ISO date for the outbound leg. */
  outboundDate: string;
  /** HH:mm 24-hour clock. Timezone — see DQ-T3 in KB. */
  outboundTime: string;
  adults: number;
  children?: number;
  signal?: AbortSignal;
}

/**
 * Documented transfer classes. Hotelbeds may publish other values; the
 * adapter mapper passes the raw string through and exposes it as
 * `TransferType | string` so callers can branch on the documented set
 * without losing fidelity.
 */
export type TransferType = 'PRIVATE' | 'SHARED' | 'LUXURY';

export interface TransferOffer {
  transferCode: string;
  /** Documented enum or raw supplier value when unknown. */
  transferType: TransferType | string;
  /** Free-form vehicle descriptor — e.g. "Sedan", "Minibus 8pax". */
  vehicleType: string;
  maxPassengers: number;
  /** Per-vehicle price — see DQ-T4 in KB. */
  price: Money;
  pickupInfo: { location: string; time: string };
  dropoffInfo: { location: string; estimatedTime: string };
  /** Free-text cancellation policy. Structured penalties are not modeled. */
  cancellationPolicy: string;
}

export interface TransferBookRequest {
  transferCode: string;
  holder: { name: string; surname: string };
  passengers: Array<{ type: 'ADULT' | 'CHILD'; name: string; surname: string }>;
  clientReference: string;
  signal?: AbortSignal;
}

export type TransferBookingStatus = 'CONFIRMED' | 'ON_REQUEST';

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
  transfers?: HotelbedsTransfer[];
  auditData?: { timestamp?: string };
}

export interface HotelbedsTransfer {
  /** Opaque booking key returned in availability and consumed by /bookings. */
  transferCode?: string;
  /** Documented set: PRIVATE | SHARED | LUXURY. */
  transferType?: string;
  vehicleType?: string;
  maxPassengers?: number;
  /** Per-vehicle net amount as decimal string. */
  amount?: string;
  currency?: string;
  pickupInformation?: {
    pickup?: { location?: string; time?: string };
    dropoff?: { location?: string; estimatedTime?: string };
  };
  cancellationPolicy?: string;
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
  auditData?: { timestamp?: string };
}
