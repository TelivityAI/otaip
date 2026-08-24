/**
 * Change Management — Types
 *
 * Agent 5.1: ATPCO Category 31 voluntary change assessment.
 *
 * Residual value follows `docs/knowledge-base/partial-refund-residual-value.md`:
 * never residual = original − change fee; partials require CAT33_THB or
 * CARRIER_SPECIFIC valuation (MPA-P is not passenger residual).
 */

import type { DomainInputRequired, PassengerPartialValuation } from '@otaip/core';

export type ChangeAction = 'REISSUE' | 'REBOOK' | 'REJECT';

/** Whether any coupon has been flown. */
export type TicketUsage = 'FULLY_UNUSED' | 'PARTIALLY_USED';

export interface OriginalTicketSummary {
  /** 13-digit ticket number */
  ticket_number: string;
  /** Conjunction ticket numbers (if applicable) */
  conjunction_tickets?: string[];
  /** Issuing carrier */
  issuing_carrier: string;
  /** Passenger name (LAST/FIRST) */
  passenger_name: string;
  /** Record locator */
  record_locator: string;
  /** Issue date (ISO) */
  issue_date: string;
  /** Base fare paid (decimal string) */
  base_fare: string;
  /** Base fare currency */
  base_fare_currency: string;
  /** Total tax paid (decimal string) */
  total_tax: string;
  /** Total amount paid (decimal string) */
  total_amount: string;
  /** Fare basis code */
  fare_basis: string;
  /** Whether the fare is refundable */
  is_refundable: boolean;
  /** Booking date (ISO — for 24h free change check) */
  booking_date?: string;
}

export interface RequestedItinerary {
  /** Segments in the new itinerary */
  segments: Array<{
    carrier: string;
    flight_number: string;
    origin: string;
    destination: string;
    departure_date: string;
    booking_class: string;
    fare_basis: string;
  }>;
  /** New fare amount (decimal string) */
  new_fare: string;
  /** New fare currency */
  new_fare_currency: string;
  /** New taxes (decimal string) */
  new_tax: string;
}

export interface ChangeFeeRule {
  /** Fare basis pattern (regex string or exact match) */
  fare_basis_pattern: string;
  /** Change fee amount (decimal string) */
  change_fee: string;
  /** Currency */
  currency: string;
  /** Free change within N hours of booking (0 = no free change) */
  free_change_hours: number;
  /** Whether fare difference is forfeited on non-refundable downgrade */
  forfeit_difference_on_downgrade: boolean;
  /** Notes */
  notes: string;
}

export interface ChangeAssessment {
  /** Original ticket number */
  original_ticket_number: string;
  /** Recommended next action */
  action: ChangeAction;
  /** Change fee amount (decimal string, "0.00" if waived) */
  change_fee: string;
  /** Change fee currency */
  change_fee_currency: string;
  /** Whether change fee was waived */
  fee_waived: boolean;
  /** Waiver code (if provided) */
  waiver_code?: string;
  /** Fare difference: new fare minus original (decimal string, negative = downgrade) */
  fare_difference: string;
  /** Additional collection required (decimal string, "0.00" if none) */
  additional_collection: string;
  /**
   * Residual value available for reissue (decimal string).
   * Fully unused: ticketed base fare (change fee is separate).
   * Partially used: unused base from CAT33_THB / CARRIER_SPECIFIC valuation.
   * Never original − change fee.
   */
  residual_value: string;
  /** Valuation method used for residual_value */
  residual_method: 'FULLY_UNUSED' | 'CAT33_THB' | 'CARRIER_SPECIFIC';
  /** Forfeited amount on non-refundable downgrade (decimal string, "0.00" if none) */
  forfeited_amount: string;
  /** Tax difference (decimal string) */
  tax_difference: string;
  /** Total due from passenger: change_fee + additional_collection + tax_difference (decimal string) */
  total_due: string;
  /** Currency for all amounts */
  currency: string;
  /** Human-readable summary */
  summary: string;
  /** Whether this is within the free change window */
  is_free_change: boolean;
}

/**
 * ATPCO Category 31 rule set, per carrier/market/fare-basis pattern.
 *
 * Real Cat31 data comes from authoritative ATPCO feeds. This engine no
 * longer hardcodes "common industry pattern" rules — the caller supplies
 * the rules to apply. When `cat31_rules` is omitted, the engine falls
 * back to the ATPCO default for voluntary changes (permitted at no
 * charge) per the user-supplied domain spec.
 */
export interface Cat31Rules {
  /** Filed change-fee rules. First match wins. */
  rules: ChangeFeeRule[];
  /**
   * Fare-basis patterns whose carrier filing rejects voluntary changes
   * outright (basic-economy, certain non-rebookable fares).
   */
  reject_patterns: string[];
}

export interface ChangeManagementInput {
  /** Original ticket summary */
  original_ticket: OriginalTicketSummary;
  /** Requested new itinerary */
  requested_itinerary: RequestedItinerary;
  /** Waiver code (if airline provided one) */
  waiver_code?: string;
  /** Current date/time (ISO — defaults to now) */
  current_datetime?: string;
  /**
   * Whether this change is carrier-initiated (involuntary). When true,
   * the change fee is waived to 0 and downstream callers should consult
   * Agent 5.3 (involuntary-rebook) for regulatory entitlements.
   */
  is_involuntary?: boolean;
  /**
   * ATPCO Category 31 rules. When present → engine applies as filed.
   * When absent → ATPCO default (voluntary: no charge; involuntary:
   * waived). The engine never invents a penalty amount.
   *
   * // DOMAIN_QUESTION: per-carrier ATPCO Cat31 ingestion pipeline.
   */
  cat31_rules?: Cat31Rules;
  /**
   * Ticket usage. Defaults to FULLY_UNUSED when omitted.
   * PARTIALLY_USED requires `residual_valuation` (Cat 33 THB or carrier).
   */
  ticket_usage?: TicketUsage;
  /**
   * Unused residual after Cat 33 THB / carrier valuation.
   * Required when ticket_usage is PARTIALLY_USED. See KB issue #150.
   */
  residual_valuation?: PassengerPartialValuation;
}

export interface ChangeManagementOutput {
  /** Change assessment */
  assessment: ChangeAssessment;
}

/** Successful assessment or fail-closed domain sentinel. */
export type ChangeManagementResult = ChangeManagementOutput | DomainInputRequired;
