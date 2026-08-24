/**
 * Exchange/Reissue — Types
 *
 * Agent 5.2: Ticket reissue with residual value, tax carryforward,
 * GDS exchange command stubs.
 *
 * Residual is consumed from Agent 5.1 / caller — never recomputed as
 * original − change fee. See docs/knowledge-base/partial-refund-residual-value.md.
 */

import type { DomainInputRequired, PassengerResidualMethod } from '@otaip/core';

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
  /** Amount (decimal string) */
  amount: string;
  /** Currency */
  currency: string;
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
  /** Residual valuation method (from input) */
  residual_method: PassengerResidualMethod;
  /** Additional collection (decimal string) */
  additional_collection: string;
  /** Taxes carried forward from original ticket */
  taxes_carried_forward: TaxItem[];
  /** New taxes collected */
  taxes_new: TaxItem[];
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
  /**
   * Residual value (decimal string, from Agent 5.1).
   * Must be valued via residual_method — never invent original − change fee.
   */
  residual_value: string;
  /**
   * How residual_value was produced. Required.
   * PARTIALLY_USED tickets must use PUBLISHED_FARE or CARRIER_SPECIFIC.
   */
  residual_method: PassengerResidualMethod;
  /** Waiver code (if applied in Agent 5.1) */
  waiver_code?: string;
  /** New segments */
  new_segments: ExchangeSegment[];
  /** New fare (decimal string) */
  new_fare: string;
  /** New fare currency */
  new_fare_currency: string;
  /** New taxes */
  new_taxes: TaxItem[];
  /** Fare calculation line */
  fare_calculation: string;
  /** Form of payment for additional collection */
  form_of_payment: FormOfPayment;
  /** GDS system for command generation */
  gds?: ExchangeGdsSystem;
  /** Issue date override (ISO) */
  issue_date?: string;
  /** Whether origin/destination is unchanged (for tax carryforward) */
  same_origin_destination: boolean;
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
}

/** Successful reissue or fail-closed domain sentinel. */
export type ExchangeReissueResult = ExchangeReissueOutput | DomainInputRequired;
