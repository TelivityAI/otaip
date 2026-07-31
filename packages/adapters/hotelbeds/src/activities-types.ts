/**
 * Hotelbeds Activities API — types.
 *
 * Two layers:
 *   - **Wire types** (`HotelbedsActivities*`) describe the JSON the API
 *     returns. Field names are best-effort based on Hotelbeds API
 *     conventions and the vendor brief; the adapter mapper tolerates
 *     missing fields. See `docs/knowledge-base/activities.md` for the
 *     authoritative source and outstanding DOMAIN_QUESTIONs.
 *   - **Canonical types** (`Activity*`) are the OTAIP-facing shape the
 *     adapter exports. These match the vendor brief verbatim.
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
 * Cancellation policy class.
 *
 * `'NOR'` = refundable, `'NRF'` = non-refundable. Behavioral semantics
 * (penalty schedule, free-cancel cutoff) are NOT documented in the vendor
 * brief — see DQ-A5 in the KB. Adapter exposes the class verbatim.
 */
export type ActivityCancellationPolicy = 'NOR' | 'NRF';

export interface ActivityModality {
  code: string;
  name: string;
  /** Per-adult price. */
  price: Money;
  /** Per-child price, when published separately. */
  childPrice?: Money;
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
  cancellationPolicy: ActivityCancellationPolicy;
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

export type ActivityBookingStatus = 'CONFIRMED' | 'ON_REQUEST';

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
//
// Best-effort. Field names mirror Hotelbeds API conventions but the
// authoritative shape is the live sandbox; the field-mapper tolerates
// missing fields. See KB file for outstanding DQs.
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

export interface HotelbedsActivity {
  code: string;
  name?: string;
  /** Long-form description, often with HTML. */
  description?: string;
  duration?: string;
  /** Cancellation class flag. Adapter narrows to ActivityCancellationPolicy. */
  cancellationPolicy?: string;
  /** Geo coordinates. Strings or numbers depending on supplier. */
  location?: { latitude?: number | string; longitude?: number | string };
  images?: Array<{ url?: string } | string>;
  modalities?: HotelbedsActivityModality[];
}

export interface HotelbedsActivityModality {
  code: string;
  name?: string;
  /** Per-adult net amount. String for decimal precision. */
  amount?: string;
  /** Per-child amount when published separately. */
  childAmount?: string;
  currency?: string;
  maxPax?: number;
  schedule?: string[];
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
  };
  auditData?: { timestamp?: string };
}

export interface HotelbedsActivitiesCancellationResponse {
  booking?: {
    reference: string;
    cancellationReference?: string;
    status?: string;
  };
  auditData?: { timestamp?: string };
}
