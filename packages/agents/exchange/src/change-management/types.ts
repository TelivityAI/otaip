/**
 * Change Management — Types
 *
 * Agent 5.1: ATPCO Category 31 voluntary change assessment.
 *
 * Waiver typology: docs/knowledge-base/waiver-typology.md
 * - No Cat 31 data / no match → free change (ATPCO default; not fail-closed).
 * - Bare waiver_code without waiver_effect → fail closed (≠ skip penalty).
 */

export type ChangeAction = 'REISSUE' | 'REBOOK' | 'REJECT';

/**
 * Semantic effect of a Cat 31 (or IRROP) waiver.
 * See docs/knowledge-base/waiver-typology.md — code alone does not imply ELIMINATE_PENALTY.
 */
export type WaiverEffect =
  | 'ELIMINATE_PENALTY'
  | 'REDUCE_PENALTY'
  | 'CHANGE_REFUND_FORM'
  | 'CHANGE_REBOOKING_CLASS'
  | 'IRROP_INVOLUNTARY';

/** Remaining change fee after waiver, or percent of filed fee eliminated. */
export type WaiverPenaltyReduction =
  | { kind: 'FIXED'; amount: string; currency: string }
  | { kind: 'PERCENT_WAIVED'; percent: number };

/** Refund form companion (shared typology; primarily Cat 33). */
export type WaiverRefundForm = 'CASH' | 'MCO' | 'EMD' | 'CREDIT';

export const WAIVER_EFFECTS: readonly WaiverEffect[] = [
  'ELIMINATE_PENALTY',
  'REDUCE_PENALTY',
  'CHANGE_REFUND_FORM',
  'CHANGE_REBOOKING_CLASS',
  'IRROP_INVOLUNTARY',
] as const;
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
  /** Whether change fee was waived (eliminate / IRROP / free window / involuntary) */
  fee_waived: boolean;
  /** Waiver code (if provided) */
  waiver_code?: string;
  /** Typed waiver effect (required when waiver_code is set) */
  waiver_effect?: WaiverEffect;
  /** Permitted booking classes when waiver constrains rebooking class */
  permitted_booking_classes?: string[];
  /** Permitted fare-basis patterns when waiver constrains rebooking fare */
  permitted_fare_basis_patterns?: string[];
  /** Fare difference: new fare minus original (decimal string, negative = downgrade) */
  fare_difference: string;
  /** Additional collection required (decimal string, "0.00" if none) */
  additional_collection: string;
  /** Residual value: original fare minus penalty, available for reissue (decimal string) */
  residual_value: string;
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
  /**
   * Waiver code identity (OSI/SSR/endorsement/NDC). Presence alone does NOT
   * skip penalty — see docs/knowledge-base/waiver-typology.md.
   * When set, `waiver_effect` is required (fail closed).
   */
  waiver_code?: string;
  /**
   * Typed semantic effect of the waiver. Required when `waiver_code` is set.
   * // TODO: DOMAIN_QUESTION: DQ-W1 — per-carrier map from free-text codes → effect
   */
  waiver_effect?: WaiverEffect;
  /**
   * Required when `waiver_effect` is REDUCE_PENALTY.
   * FIXED = remaining change fee; PERCENT_WAIVED = % of filed fee eliminated.
   */
  waiver_penalty_reduction?: WaiverPenaltyReduction;
  /**
   * Companion for CHANGE_REFUND_FORM (shared typology; Cat 31 assessment
   * records it only — monetary form conversion is Agent 6.1 / settlement).
   */
  waiver_refund_form?: WaiverRefundForm;
  /**
   * Required when `waiver_effect` is CHANGE_REBOOKING_CLASS — at least one of
   * these lists must be non-empty. Does not eliminate the filed Cat 31 fee.
   * // TODO: DOMAIN_QUESTION: DQ-W4 — carrier class-substitution tables
   */
  permitted_booking_classes?: string[];
  permitted_fare_basis_patterns?: string[];
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
}

export interface ChangeManagementOutput {
  /** Change assessment */
  assessment: ChangeAssessment;
}
