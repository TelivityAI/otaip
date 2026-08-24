/**
 * Refund Processing — Types
 *
 * Agent 6.1: ATPCO Category 33 refund processing with penalty application,
 * commission recall, BSP/ARC reporting, conjunction ticket handling.
 *
 * Waiver typology: docs/knowledge-base/waiver-typology.md
 * - No Cat 33 data / no match → free refund (ATPCO default; not fail-closed).
 * - Bare waiver_code without waiver_effect → fail closed (≠ skip penalty).
 */

export type RefundType = 'FULL' | 'PARTIAL' | 'TAX_ONLY';

export type SettlementSystem = 'BSP' | 'ARC';

export type CommissionType = 'PERCENTAGE' | 'FLAT';

/**
 * Semantic effect of a Cat 33 (or IRROP) waiver.
 * See docs/knowledge-base/waiver-typology.md — code alone does not imply ELIMINATE_PENALTY.
 */
export type WaiverEffect =
  | 'ELIMINATE_PENALTY'
  | 'REDUCE_PENALTY'
  | 'CHANGE_REFUND_FORM'
  | 'CHANGE_REBOOKING_CLASS'
  | 'IRROP_INVOLUNTARY';

/** Remaining penalty after waiver, or percent of filed penalty eliminated. */
export type WaiverPenaltyReduction =
  | { kind: 'FIXED'; amount: string; currency: string }
  | { kind: 'PERCENT_WAIVED'; percent: number };

/** Refund fulfillment form when waiver changes form without eliminating penalty. */
export type WaiverRefundForm = 'CASH' | 'MCO' | 'EMD' | 'CREDIT';

export const WAIVER_EFFECTS: readonly WaiverEffect[] = [
  'ELIMINATE_PENALTY',
  'REDUCE_PENALTY',
  'CHANGE_REFUND_FORM',
  'CHANGE_REBOOKING_CLASS',
  'IRROP_INVOLUNTARY',
] as const;
export interface TaxItem {
  /** Tax code (e.g., GB, US, YQ) */
  code: string;
  /** Tax amount (decimal string) */
  amount: string;
  /** Currency */
  currency: string;
}

export interface CommissionData {
  /** Commission amount originally paid (decimal string) */
  amount: string;
  /** Commission type */
  type: CommissionType;
  /** Percentage rate (if PERCENTAGE type) */
  rate?: number;
}

export interface CouponRefundItem {
  /** Coupon number (1-4) */
  coupon_number: number;
  /** Current coupon status */
  status: string;
  /** Whether this coupon is refundable (O = open, unused) */
  refundable: boolean;
}

export interface RefundPenaltyRule {
  /** Fare basis pattern (regex) */
  fare_basis_pattern: string;
  /** Penalty amount (decimal string) */
  penalty_amount: string;
  /** Currency */
  currency: string;
  /** Whether base fare is fully forfeited */
  forfeit_base_fare: boolean;
  /** Notes */
  notes: string;
}

/**
 * ATPCO Category 33 rule set for refunds.
 *
 * Real Cat33 data comes from authoritative ATPCO feeds. This engine no
 * longer hardcodes fallback "industry pattern" rules — when no rule
 * matches and no rules are supplied, the engine uses the ATPCO default
 * (permitted at no charge for voluntary refunds; full refund for
 * involuntary).
 *
 * // DOMAIN_QUESTION: per-carrier ATPCO Cat33 ingestion pipeline.
 */
export interface Cat33Rules {
  rules: RefundPenaltyRule[];
}

export interface BspRefundFields {
  /** Original ticket number */
  original_ticket_number: string;
  /** Refund amount (decimal string) */
  refund_amount: string;
  /** Tax breakdown */
  tax_breakdown: TaxItem[];
  /** Penalty applied (decimal string) */
  penalty_applied: string;
  /** Refund indicator */
  refund_indicator: 'R';
  /** Settlement code */
  settlement_code: string;
  /** Remittance currency */
  remittance_currency: string;
}

export interface ArcRefundFields {
  /** Original document number */
  original_document_number: string;
  /** Total refund (decimal string) */
  total_refund: string;
  /** Tax refund breakdown */
  tax_refund_breakdown: TaxItem[];
  /** Penalty deducted (decimal string) */
  penalty_deducted: string;
  /** Refund type indicator */
  refund_type_indicator: 'R';
  /** Settlement week reference */
  settlement_week: string;
}

export interface RefundAuditTrail {
  /** Original ticket number */
  original_ticket_number: string;
  /** Conjunction tickets (if applicable) */
  conjunction_tickets?: string[];
  /** Refund type */
  refund_type: RefundType;
  /** Original base fare (decimal string) */
  original_base_fare: string;
  /** Original total tax (decimal string) */
  original_total_tax: string;
  /** Penalty applied (decimal string) */
  penalty_applied: string;
  /** Waiver code (if applied) */
  waiver_code?: string;
  /** Typed waiver effect (required when waiver_code is set) */
  waiver_effect?: WaiverEffect;
  /** Refund form when waiver changes form */
  waiver_refund_form?: WaiverRefundForm;
  /** Base fare refunded (decimal string) */
  base_fare_refunded: string;
  /** Tax refunded (decimal string) */
  tax_refunded: string;
  /** Commission recalled (decimal string) */
  commission_recalled: string;
  /** Coupons refunded */
  coupons_refunded: number[];
}

export interface RefundRecord {
  /** Original ticket number */
  ticket_number: string;
  /** Refund type */
  refund_type: RefundType;
  /** Penalty applied (decimal string) */
  penalty_applied: string;
  /** Base fare refund amount (decimal string) */
  base_fare_refund: string;
  /** Tax refund amount (decimal string) */
  tax_refund: string;
  /** Tax breakdown of refund */
  tax_breakdown: TaxItem[];
  /** Total refund before commission recall (decimal string) */
  total_refund: string;
  /** Commission recalled (decimal string) */
  commission_recalled: string;
  /** Net refund to passenger (decimal string) */
  net_refund: string;
  /** Waiver code (if applied) */
  waiver_code?: string;
  /** Typed waiver effect (required when waiver_code is set) */
  waiver_effect?: WaiverEffect;
  /** Refund form when waiver changes form */
  waiver_refund_form?: WaiverRefundForm;
  /** BSP reporting fields */
  bsp_fields?: BspRefundFields;
  /** ARC reporting fields */
  arc_fields?: ArcRefundFields;
  /** Audit trail */
  audit: RefundAuditTrail;
}

export interface RefundProcessingInput {
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
  /** Original base fare (decimal string) */
  base_fare: string;
  /** Base fare currency */
  base_fare_currency: string;
  /** Original taxes */
  taxes: TaxItem[];
  /** Commission data (if any) */
  commission?: CommissionData;
  /** Refund type */
  refund_type: RefundType;
  /** Specific coupons to refund (for PARTIAL refund) */
  coupons_to_refund?: CouponRefundItem[];
  /** Total coupon count on ticket */
  total_coupons: number;
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
   * FIXED = remaining penalty amount; PERCENT_WAIVED = % of filed penalty eliminated.
   */
  waiver_penalty_reduction?: WaiverPenaltyReduction;
  /**
   * Required when `waiver_effect` is CHANGE_REFUND_FORM.
   * Does not eliminate the filed Cat 33 charge.
   */
  waiver_refund_form?: WaiverRefundForm;
  /**
   * Optional companions for CHANGE_REBOOKING_CLASS (primarily Cat 31;
   * accepted here for shared typology — Cat 33 engines ignore class constraints).
   */
  permitted_booking_classes?: string[];
  permitted_fare_basis_patterns?: string[];
  /** Fare basis code */
  fare_basis: string;
  /** Whether the fare is refundable */
  is_refundable: boolean;
  /** Settlement system */
  settlement_system: SettlementSystem;
  /** Current date (ISO — for reporting) */
  current_date?: string;
  /**
   * Whether this refund is carrier-initiated (involuntary). When true,
   * no penalty is deducted regardless of the filed Cat33 rules.
   */
  is_involuntary?: boolean;
  /**
   * ATPCO Category 33 rules. When present → engine applies as filed.
   * When absent → ATPCO default (voluntary: no penalty; involuntary:
   * full refund). The engine never invents a penalty amount.
   */
  cat33_rules?: Cat33Rules;
}

export interface RefundProcessingOutput {
  /** Refund record */
  refund: RefundRecord;
  /** Net refund amount (decimal string) */
  net_refund_amount: string;
  /** Commission recalled (decimal string) */
  commission_recalled: string;
}
