/**
 * ADM Prevention — Types
 *
 * Agent 6.2: Pre-ticketing audit to prevent Agency Debit Memos.
 * Checks cover fare integrity, segment validity (passive/UC/churn),
 * married integrity, TTL, and compliance.
 *
 * Domain source: docs/knowledge-base/adm-prevention.md
 */

import type { GdsHost } from './status-codes.js';

export type { GdsHost };

export type ADMCheckId =
  | 'DUPLICATE_BOOKING'
  | 'FARE_CLASS_MISMATCH'
  | 'PASSIVE_SEGMENT'
  | 'CHURNING'
  | 'MARRIED_SEGMENT'
  | 'TTL_EXPIRED'
  | 'COMMISSION_RATE'
  | 'ENDORSEMENT_BOX'
  | 'TOUR_CODE_FORMAT'
  | 'NET_REMIT';

export type ADMSeverity = 'blocking' | 'warning';

export interface ADMCheck {
  /** Check identifier */
  check_id: ADMCheckId;
  /** Human-readable check name */
  name: string;
  /** Severity level */
  severity: ADMSeverity;
  /** Whether the check passed */
  passed: boolean;
  /** Reason for failure (or pass confirmation) */
  reason: string;
}

export interface BookingSegment {
  /** Carrier */
  carrier: string;
  /** Flight number */
  flight_number: string;
  /** Origin */
  origin: string;
  /** Destination */
  destination: string;
  /** Departure date (ISO) */
  departure_date: string;
  /** Segment status (HK, KK, HX, UC, UN, NO, TK, HN, PK, …) */
  status: string;
  /** Booked class */
  booking_class: string;
  /** Married segment group (segments in same group must travel together) */
  married_group?: string;
}

/**
 * Historical segment event — required for churning detection.
 * Current status alone cannot prove or disprove churn.
 */
export type SegmentHistoryAction = 'BOOKED' | 'CANCELLED' | 'REBOOKED';

export interface SegmentHistoryEvent {
  /** ISO timestamp of the event */
  timestamp: string;
  /** What happened */
  action: SegmentHistoryAction;
  /** Carrier */
  carrier: string;
  /** Flight number */
  flight_number: string;
  /** Departure date (ISO date) */
  departure_date: string;
  /** Origin (optional — strengthens identity match) */
  origin?: string;
  /** Destination (optional) */
  destination?: string;
  /** Status after the event, if known */
  status?: string;
}

export interface DuplicateCheckPnr {
  /** Record locator */
  record_locator: string;
  /** Passenger name */
  passenger_name: string;
  /** Segments */
  segments: Array<{
    carrier: string;
    flight_number: string;
    departure_date: string;
  }>;
}

export interface BookingRecord {
  /** Record locator */
  record_locator: string;
  /** Passenger name (LAST/FIRST) */
  passenger_name: string;
  /** Segments */
  segments: BookingSegment[];
  /** Base fare (decimal string) */
  base_fare: string;
  /** Base fare currency */
  base_fare_currency: string;
}

/** Where the TTL value came from — affects messaging, not invented rules. */
export type TtlSource = 'BOOKING' | 'FARE_QUOTE' | 'CARRIER_RULE' | 'UNKNOWN';

export interface ADMPreventionInput {
  /** Booking record to audit */
  booking: BookingRecord;
  /** Fare basis code */
  fare_basis: string;
  /** Booked class (single letter) */
  booked_class: string;
  /**
   * Commission rate on this ticket (percentage, e.g. 7.0).
   * Compared only to caller-supplied contracted rate — no embedded carrier tables.
   */
  commission_rate?: number;
  /** Carrier's contracted commission rate (percentage) — supplied by caller */
  carrier_contracted_rate?: number;
  /** Endorsement text on ticket */
  endorsement?: string;
  /** Tour code on ticket */
  tour_code?: string;
  /** Whether this is a net remit ticket */
  is_net_remit?: boolean;
  /** Net contracted fare amount (decimal string) */
  net_contracted_amount?: string;
  /** TTL deadline (ISO timestamp) */
  ttl_deadline?: string;
  /** IANA timezone for deadline-day evaluation (e.g. America/New_York) */
  ttl_timezone?: string;
  /** How TTL was established */
  ttl_source?: TtlSource;
  /** Other PNRs to check for duplicates */
  duplicate_check_pnrs?: DuplicateCheckPnr[];
  /** Current date/time (ISO — for TTL check) */
  current_datetime?: string;
  /**
   * Ordered segment history for churning detection.
   * Without this, CHURNING is skipped (not assumed clear).
   */
  segment_history?: SegmentHistoryEvent[];
  /** Host GDS — used for marriage-break signals (e.g. Travelport DX) */
  gds?: GdsHost;
  /** Override default churn cycle threshold (default 3) */
  churn_cycle_threshold?: number;
  /** Override default churn window in hours (default 72) */
  churn_window_hours?: number;
}

export interface ADMPreventionResult {
  /** All check results */
  checks: ADMCheck[];
  /** Overall pass (true only if all blocking checks pass) */
  overall_pass: boolean;
  /** Number of blocking failures */
  blocking_count: number;
  /** Number of warnings */
  warning_count: number;
}

export interface ADMPreventionOutput {
  /** Audit result */
  result: ADMPreventionResult;
}
