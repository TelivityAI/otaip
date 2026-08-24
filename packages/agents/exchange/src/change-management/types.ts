/**
 * Change Management — Types
 *
 * Agent 5.1: ATPCO Category 31 voluntary change assessment +
 * US DOT 14 CFR §259.5(b)(4) 24-hour reservation assessment.
 *
 * DOT 24h (hold OR cancel) is NOT Cat 31 free change — see
 * docs/knowledge-base/us-dot-24-hour-reservation.md.
 *
 * Waiver typology: docs/knowledge-base/waiver-typology.md
 * - No Cat 31 data / no match → free change (ATPCO default; not fail-closed).
 * - Bare waiver_code without waiver_effect → fail closed (≠ skip penalty).
 */

export type ChangeAction = 'REISSUE' | 'REBOOK' | 'REJECT';

/**
 * Carrier election under 14 CFR §259.5(b)(4).
 * Carriers choose ONE compliance path — not both.
 * Use `unknown` when not verified from a public primary source.
 */
export type UsDot24HourRemedy = 'cancel' | 'hold' | 'unknown';

/**
 * How the reservation was made.
 * §259.5 binds the *airline*. Do not treat agency/NDC/GDS as legally
 * excluded — unverified channels stay unknown until that carrier's
 * disclosed policy lists them in `channels_covered`.
 */
export type UsDot24HourBookingChannel =
  | 'airline_direct'
  | 'agency'
  | 'ndc'
  | 'gds'
  | 'unknown';

export type UsDot24HourIneligibilityReason =
  | 'departure_within_7_days'
  | 'outside_24_hour_window'
  /**
   * Channel not verified as covered by the carrier's disclosed policy.
   * Not a statutory “third-party never qualifies” rule.
   */
  | 'channel_coverage_unknown'
  | 'geography_not_applicable'
  | 'carrier_remedy_unknown'
  | 'insufficient_inputs'
  /** Hold is unpaid pre-payment fare hold — not a post-purchase free change. */
  | 'hold_not_post_purchase_change';

/**
 * What DOT §259.5(b)(4) would grant when eligible.
 * Never map this to Cat 31 free reissue / is_free_change.
 */
export type UsDot24HourEntitlement =
  | 'penalty_free_cancel'
  | 'unpaid_fare_hold'
  | 'none'
  | 'unknown';

/** Machine row from us-dot-24h-carrier-remedy.json / KB matrix. */
export interface UsDot24HourCarrierRemedyRow {
  carrier_code: string;
  remedy: UsDot24HourRemedy;
  /**
   * Channels explicitly covered by the carrier's verified public disclosure.
   * Empty / missing → coverage unknown for all channels.
   */
  channels_covered: UsDot24HourBookingChannel[];
  last_verified: string | null;
  source_url: string | null;
  notes: string;
}

/** Caller-supplied context for DOT 24h assessment. */
export interface UsDot24HourContext {
  /**
   * Whether Part 259 applies to this ticket (caller-supplied).
   * Do not invent from airport codes — see §259.2.
   */
  part_259_applicable?: boolean;
  /**
   * Booking channel. Agency/NDC/GDS remain unknown for eligibility
   * until listed in the carrier matrix `channels_covered`.
   */
  booking_channel?: UsDot24HourBookingChannel;
}

export interface UsDot24HourAssessment {
  regulation: '14_CFR_259_5_b_4';
  /** Carrier election from KB matrix (cancel | hold | unknown). */
  carrier_remedy: UsDot24HourRemedy;
  /** ISO date from KB last-verified column; null if unknown carrier. */
  carrier_remedy_last_verified: string | null;
  /**
   * Whether DOT 24h entitlement appears available now.
   * Independent of Cat 31 `is_free_change`.
   */
  eligible: boolean;
  ineligibility_reasons: UsDot24HourIneligibilityReason[];
  /** Whole days from booking to original departure; null if inputs missing. */
  days_booking_to_departure: number | null;
  /** Hours since booking_date; null if booking_date missing. */
  hours_since_booking: number | null;
  entitlement: UsDot24HourEntitlement;
  notes: string;
}

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
  /**
   * Booking / reservation datetime (ISO).
   * Used for Cat 31 free-change window AND DOT 24h clock.
   */
  booking_date?: string;
  /**
   * First-segment scheduled departure at booking (ISO date or datetime).
   * Required for the DOT ≥7-day-before-departure check.
   */
  original_departure_date?: string;
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
  /**
   * Cat 31 filed free-change window only (`ChangeFeeRule.free_change_hours`).
   * NOT the US DOT 24h rule — see `ChangeManagementOutput.us_dot_24h`.
   */
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
  /**
   * Context for US DOT 14 CFR §259.5(b)(4) assessment.
   * See docs/knowledge-base/us-dot-24-hour-reservation.md.
   */
  us_dot_24h?: UsDot24HourContext;
}

export interface ChangeManagementOutput {
  /** Cat 31 change assessment */
  assessment: ChangeAssessment;
  /**
   * US DOT 24h hold-OR-cancel assessment (independent of Cat 31).
   * Never conflate with `assessment.is_free_change`.
   */
  us_dot_24h: UsDot24HourAssessment;
}
