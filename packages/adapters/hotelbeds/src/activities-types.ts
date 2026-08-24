/**
 * Hotelbeds Activities API — types.
 *
 * Two layers:
 *   - **Wire types** (`HotelbedsActivities*`) describe the JSON the API
 *     returns. Field names follow official Hotelbeds docs where cited in
 *     `docs/knowledge-base/activities.md`, plus the brief-shape fixtures
 *     already in tests. The mapper tolerates missing fields.
 *   - **Canonical types** (`Activity*`) are the OTAIP-facing shape.
 */

import type { Money } from './shared-types.js';

// ---------------------------------------------------------------------------
// Canonical (OTAIP-facing) types
// ---------------------------------------------------------------------------

export interface ActivitySearchRequest {
  /** Hotelbeds destination code (BCN, PAR, LON, etc.). */
  destination: string;
  /** ISO date — first day of the activity window. */
  dateFrom: string;
  /** ISO date — last day of the activity window. */
  dateTo: string;
  /**
   * Pax breakdown. `children` is an array of *ages*, not a count.
   * `[8, 12]` means two children aged 8 and 12.
   */
  paxes: { adults: number; children?: number[] };
  /** Optional category filter — passed through to Hotelbeds. */
  category?: string;
  /** Abort signal threaded through to fetch. */
  signal?: AbortSignal;
}

/**
 * Cancellation policy class (`rateClass`).
 *
 * `'NOR'` = refundable (read `cancellationPolicies[]` for stepped penalties).
 * `'NRF'` = non-refundable.
 * Official: Activities Cancellation Policies KB + Availability docs (DQ-A5 CLOSED).
 */
export type ActivityCancellationPolicy = 'NOR' | 'NRF';

/**
 * Stepped cancellation penalty from Hotelbeds `cancellationPolicies[]`.
 * `dateFrom` is destination-local time (official docs).
 */
export interface ActivityCancellationPenalty {
  dateFrom: string;
  /** Penalty amount as decimal string. */
  amount: string;
  currency?: string;
}

export interface ActivityModality {
  code: string;
  name: string;
  /** Per-adult agency/net price (`amount` on the wire). */
  price: Money;
  /** Per-child price, when published separately. */
  childPrice?: Money;
  /**
   * Box-office / gate price when published.
   * Official: not the selling price — see DQ-A2 CLOSED in KB.
   */
  boxOfficePrice?: Money;
  maxPax: number;
  /** Available start times for the modality. Format passed through verbatim. */
  schedule?: string[];
}

export interface ActivityOffer {
  activityCode: string;
  name: string;
  description: string;
  modalities: ActivityModality[];
  duration: string;
  location: { latitude: number; longitude: number };
  images: string[];
  /** rateClass NOR | NRF. */
  cancellationPolicy: ActivityCancellationPolicy;
  /** Stepped penalties when Hotelbeds returns cancellationPolicies[]. */
  cancellationPolicies?: ActivityCancellationPenalty[];
}

export interface ActivityBookRequest {
  activityCode: string;
  modalityCode: string;
  /** ISO date of the chosen activity slot. */
  date: string;
  /** One entry per pax — age is required for every passenger. */
  paxes: Array<{ age: number }>;
  holder: { name: string; surname: string };
  clientReference: string;
  /** Required in live mode for money-path idempotency. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/**
 * Official confirm statuses are CONFIRMED | CANCELLED.
 * PRECONFIRMED is the optional preconfirm/reconfirm hold — not ON_REQUEST.
 * DQ-A3 CLOSED: Activities confirm has no OnRequest.
 */
export type ActivityBookingStatus = 'CONFIRMED' | 'PRECONFIRMED' | 'CANCELLED';

export interface ActivityBookResponse {
  bookingReference: string;
  status: ActivityBookingStatus;
  clientReference: string;
  /** Voucher URL when published by Hotelbeds. Access semantics — DQ-A4. */
  voucherUrl?: string;
}

export interface ActivityCancelResponse {
  status: 'CANCELLED';
  cancellationReference: string;
}

// ---------------------------------------------------------------------------
// Wire types — Hotelbeds Activities API responses
// ---------------------------------------------------------------------------

export interface HotelbedsActivitiesAvailabilityRequest {
  filters: {
    searchFilterItems: Array<{ type: string; value: string }>;
  };
  from: string;
  to: string;
  paxes: {
    adults: number;
    children?: number[];
  };
  /** Optional category filter — wire field name is best-effort. */
  category?: string;
  language?: string;
}

export interface HotelbedsActivitiesAvailabilityResponse {
  activities?: HotelbedsActivity[];
  auditData?: { timestamp?: string; processTime?: string };
}

export interface HotelbedsActivityCancellationPolicy {
  dateFrom?: string;
  amount?: number | string;
  currency?: string;
}

export interface HotelbedsActivityRate {
  rateClass?: string;
  freeCancellation?: boolean;
  rateDetails?: Array<{
    operationDates?: Array<{
      from?: string;
      to?: string;
      cancellationPolicies?: HotelbedsActivityCancellationPolicy[];
    }>;
  }>;
}

export interface HotelbedsActivity {
  code: string;
  name?: string;
  /** Long-form description, often with HTML. */
  description?: string;
  duration?: string;
  /**
   * Brief-shape cancellation class flag. Official wire uses
   * modalities[].rates[].rateClass — mapper accepts either (DQ-A5).
   */
  cancellationPolicy?: string;
  /** Top-level stepped policies when present on recorded fixtures. */
  cancellationPolicies?: HotelbedsActivityCancellationPolicy[];
  /** Geo coordinates. Strings or numbers depending on supplier. */
  location?: { latitude?: number | string; longitude?: number | string };
  images?: Array<{ url?: string } | string>;
  modalities?: HotelbedsActivityModality[];
}

export interface HotelbedsActivityModality {
  code: string;
  name?: string;
  /** Per-adult net/agency amount. String for decimal precision. */
  amount?: string;
  /** Per-child amount when published separately. */
  childAmount?: string;
  /** Box-office amount when published (not sellingRate — DQ-A2). */
  boxOfficeAmount?: string;
  currency?: string;
  maxPax?: number;
  schedule?: string[];
  rates?: HotelbedsActivityRate[];
}

export interface HotelbedsActivitiesBookingRequest {
  activities: Array<{
    activityCode: string;
    modalityCode: string;
    from: string;
    paxes: Array<{ age: number }>;
  }>;
  holder: { name: string; surname: string };
  clientReference: string;
}

export interface HotelbedsActivitiesBookingResponse {
  booking?: {
    reference: string;
    clientReference?: string;
    status?: string;
    voucherUrl?: string;
    activities?: Array<{
      vouchers?: Array<{ url?: string; dateFrom?: string; dateTo?: string }>;
      cancellationPolicies?: HotelbedsActivityCancellationPolicy[];
    }>;
  };
  auditData?: { timestamp?: string };
}

export interface HotelbedsActivitiesCancellationResponse {
  booking?: {
    reference: string;
    cancellationReference?: string;
    status?: string;
    /** Simulation may return charge amount — shape observed in cancel docs narrative. */
    totalNet?: number | string;
  };
  auditData?: { timestamp?: string };
}
