/**
 * Exchange/Reissue — Types
 *
 * Agent 5.2: Ticket reissue with residual value, tax carryforward,
 * GDS exchange command stubs.
 *
 * Tax carryforward: see docs/knowledge-base/tax-carryforward-reissue.md
 * Same O&D alone is insufficient. Decisions are per tax code.
 */

export type ExchangeGdsSystem = 'AMADEUS' | 'SABRE' | 'TRAVELPORT';

export interface ExchangeSegment {
  /** Carrier */
  carrier: string;
  /** Flight number */
  flight_number: string;
  /** Origin (IATA 3-letter) */
  origin: string;
  /** Destination (IATA 3-letter) */
  destination: string;
  /** Departure date (ISO) */
  departure_date: string;
  /** Departure time (HH:MM) */
  departure_time?: string;
  /** Booking class */
  booking_class: string;
  /** Fare basis */
  fare_basis: string;
  /** Baggage allowance */
  baggage_allowance?: string;
}

export interface TaxItem {
  /** Tax code */
  code: string;
  /** Amount (decimal string) — from TTBS/ATPCO/SITA, never invented */
  amount: string;
  /** Currency */
  currency: string;
}

/** Per-tax carryforward action (KB: tax-carryforward-reissue.md) */
export type TaxCarryforwardAction = 'CARRY' | 'RECALCULATE' | 'FORFEIT';

/**
 * Decision for a single tax code on reissue.
 * Amounts are applied separately from TTBS/ATPCO/SITA — this is the action only.
 */
export interface TaxCarryforwardDecision {
  tax_code: string;
  action: TaxCarryforwardAction;
  reason: string;
}

/** Geography match for this reissue (airport vs city vs different). */
export type TaxGeographyMatch = 'SAME_AIRPORT' | 'SAME_CITY' | 'DIFFERENT';

/** Flown status of the original ticket relative to the exchange. */
export type TaxItineraryFlownStatus = 'UNFLOWN' | 'PARTIALLY_FLOWN' | 'FULLY_FLOWN';

/** TTFC nature — transport (journey) vs sales (POS/ticketing). */
export type TaxNature = 'TRANSPORT' | 'SALES';

/**
 * Context dimensions for carryforward evaluation.
 * Same O&D boolean alone is not a substitute for this context.
 */
export interface TaxCarryforwardContext {
  geography_match: TaxGeographyMatch;
  /**
   * Caller evaluates published validity windows from TTBS/ATPCO.
   * Engine does not invent window dates.
   */
  within_validity_window: boolean;
  flown_status: TaxItineraryFlownStatus;
  /** Point of sale / ticketing location unchanged (sales-tax dimension). */
  point_of_sale_unchanged: boolean;
}

/**
 * Per-tax-code rule from TTBS/ATPCO/SITA (or carrier policy for YQ/YR).
 * Contains no statutory rates — only carryforward policy dimensions.
 */
export interface TaxCarryforwardRule {
  tax_code: string;
  nature: TaxNature;
  /** Minimum geography required before CARRY may apply. */
  min_geography: 'SAME_AIRPORT' | 'SAME_CITY';
  /**
   * When true, never CARRY — always RECALCULATE.
   * YQ/YR profiles should set this unless explicit_carry_authorized.
   */
  carry_never?: boolean;
  /**
   * Required before YQ/YR (carrier-imposed) may CARRY.
   * Without this, YQ/YR always RECALCULATE.
   */
  explicit_carry_authorized?: boolean;
  /** When true, partially flown forces RECALCULATE. */
  recalculate_when_partially_flown?: boolean;
  /** Action when validity window does not cover new travel. */
  on_validity_expired: TaxCarryforwardAction;
  /** When true (typical for SALES), POS change forces RECALCULATE. */
  recalculate_when_pos_changed?: boolean;
}

export interface FormOfPayment {
  /** Payment type */
  type: 'CASH' | 'CREDIT_CARD' | 'INVOICE' | 'MISCELLANEOUS';
  /** Card code (VI, CA, AX) */
  card_code?: string;
  /** Last 4 digits */
  card_last_four?: string;
  /** Amount (decimal string) */
  amount: string;
  /** Currency */
  currency: string;
}

export interface ExchangeAuditTrail {
  /** Original ticket number */
  original_ticket_number: string;
  /** Original ticket numbers for conjunction sets */
  conjunction_originals?: string[];
  /** Original issue date */
  original_issue_date: string;
  /** Exchange indicator (E = exchange) */
  exchange_indicator: 'E';
  /** Change fee paid (decimal string) */
  change_fee_paid: string;
  /** Residual value applied (decimal string) */
  residual_applied: string;
  /** Additional collection (decimal string) */
  additional_collection: string;
  /** Taxes carried forward from original ticket */
  taxes_carried_forward: TaxItem[];
  /** New taxes collected */
  taxes_new: TaxItem[];
  /** Per-tax carryforward decisions (CARRY | RECALCULATE | FORFEIT) */
  tax_decisions: TaxCarryforwardDecision[];
  /** Waiver code (if applied) */
  waiver_code?: string;
}

export interface ExchangeCommand {
  /** GDS system */
  gds: ExchangeGdsSystem;
  /** Command name */
  command_name: string;
  /** Command fields (key-value) */
  fields: Record<string, string>;
  /** Description */
  description: string;
}

export interface ReissuedCoupon {
  /** Coupon number */
  coupon_number: number;
  /** Carrier */
  carrier: string;
  /** Flight number */
  flight_number: string;
  /** Origin */
  origin: string;
  /** Destination */
  destination: string;
  /** Departure date */
  departure_date: string;
  /** Departure time */
  departure_time?: string;
  /** Booking class */
  booking_class: string;
  /** Fare basis */
  fare_basis: string;
  /** Baggage allowance */
  baggage_allowance?: string;
  /** Coupon status (always O for new issue) */
  status: 'O';
}

export interface ReissueRecord {
  /** New 13-digit ticket number */
  ticket_number: string;
  /** Record locator */
  record_locator: string;
  /** Issuing carrier */
  issuing_carrier: string;
  /** Issue date (ISO) */
  issue_date: string;
  /** Passenger name */
  passenger_name: string;
  /** Coupons */
  coupons: ReissuedCoupon[];
  /** New base fare (decimal string) */
  base_fare: string;
  /** Base fare currency */
  base_fare_currency: string;
  /** Total tax on new ticket (decimal string) */
  total_tax: string;
  /** Tax breakdown */
  taxes: TaxItem[];
  /** Total amount (decimal string) */
  total_amount: string;
  /** Fare calculation line */
  fare_calculation: string;
  /** Form of payment for additional collection */
  form_of_payment: FormOfPayment;
  /** Exchange audit trail */
  exchange_audit: ExchangeAuditTrail;
  /** GDS exchange commands */
  exchange_commands?: ExchangeCommand[];
}

export interface ExchangeReissueInput {
  /** Original ticket number */
  original_ticket_number: string;
  /** Conjunction ticket numbers (if applicable) */
  conjunction_originals?: string[];
  /** Original issue date */
  original_issue_date: string;
  /** Issuing carrier */
  issuing_carrier: string;
  /** Passenger name (LAST/FIRST) */
  passenger_name: string;
  /** Record locator */
  record_locator: string;
  /** Original base fare (decimal string) */
  original_base_fare: string;
  /** Original taxes */
  original_taxes: TaxItem[];
  /** Change fee (decimal string, from Agent 5.1) */
  change_fee: string;
  /** Residual value (decimal string, from Agent 5.1) */
  residual_value: string;
  /** Waiver code (if applied in Agent 5.1) */
  waiver_code?: string;
  /** New segments */
  new_segments: ExchangeSegment[];
  /** New fare (decimal string) */
  new_fare: string;
  /** New fare currency */
  new_fare_currency: string;
  /** New taxes — amounts from TTBS/ATPCO/SITA, never invented */
  new_taxes: TaxItem[];
  /** Fare calculation line */
  fare_calculation: string;
  /** Form of payment for additional collection */
  form_of_payment: FormOfPayment;
  /** GDS system for command generation */
  gds?: ExchangeGdsSystem;
  /** Issue date override (ISO) */
  issue_date?: string;
  /**
   * @deprecated Insufficient for tax carryforward. Same O&D ≠ keep all TFCs.
   * Ignored for carryforward decisions — use tax_carryforward_context + rules.
   * Retained only so callers can migrate; may be removed in a later major version.
   */
  same_origin_destination?: boolean;
  /**
   * Carryforward context dimensions (geography, validity, flown, POS).
   * Required. See docs/knowledge-base/tax-carryforward-reissue.md
   */
  tax_carryforward_context: TaxCarryforwardContext;
  /**
   * Per-tax-code rules covering every code in original_taxes ∪ new_taxes.
   * Missing rule → fail closed. No invented statutory rates.
   */
  tax_carryforward_rules: TaxCarryforwardRule[];
  /** Ticket number prefix (3-digit) */
  ticket_number_prefix?: string;
}

export interface ExchangeReissueOutput {
  /** Reissued ticket record */
  reissue: ReissueRecord;
  /** Additional collection amount (decimal string) */
  additional_collection: string;
  /** Credit note amount if refund due (decimal string) */
  credit_amount: string;
  /** Per-tax carryforward decisions (also on exchange_audit) */
  tax_decisions: TaxCarryforwardDecision[];
}
