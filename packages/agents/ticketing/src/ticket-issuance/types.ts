/**
 * Ticket Issuance — Types
 *
 * Agent 4.1: Electronic Ticket Record (ETR) issuance.
 */

/** Coupon status lifecycle */
export type CouponStatus =
  | 'O' // Open for use
  | 'A' // Airport control
  | 'E' // Exchanged
  | 'R' // Refunded
  | 'V' // Voided
  | 'C' // Checked in
  | 'L' // Lifted / boarded
  | 'S'; // Suspended

export type FormOfPaymentType = 'CASH' | 'CREDIT_CARD' | 'INVOICE' | 'MISCELLANEOUS';

export interface FormOfPayment {
  /** Payment type */
  type: FormOfPaymentType;
  /** Credit card code (e.g. VI, CA, AX) — required for CREDIT_CARD */
  card_code?: string;
  /** Last 4 digits of card — required for CREDIT_CARD */
  card_last_four?: string;
  /** Approval code from payment processor */
  approval_code?: string;
  /** Payment amount (decimal string) */
  amount: string;
  /** Currency code (ISO 4217) */
  currency: string;
}

export interface TicketSegment {
  /** Coupon number (1-4 per ticket) */
  coupon_number: number;
  /** Carrier code */
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
  /** Fare basis code */
  fare_basis: string;
  /** Not valid before (ISO date) */
  not_valid_before?: string;
  /** Not valid after (ISO date) */
  not_valid_after?: string;
  /** Baggage allowance (e.g. "2PC", "23K") */
  baggage_allowance?: string;
  /** Coupon status */
  status: CouponStatus;
}

export interface TaxBreakdownItem {
  /** Tax code (e.g. YQ, GB, US) */
  code: string;
  /** Tax amount (decimal string) */
  amount: string;
  /** Currency */
  currency: string;
}

export interface CommissionData {
  /** Commission type */
  type: 'PERCENTAGE' | 'FLAT';
  /** Rate (percentage as "5.00" or flat amount as "25.00") */
  rate: string;
  /** Calculated amount (decimal string) */
  amount: string;
  /** Currency */
  currency: string;
}

export interface BspReportingFields {
  /** Settlement authorization code */
  settlement_code?: string;
  /** Remittance currency (ISO 4217) */
  remittance_currency: string;
  /** Billing period reference (e.g. "2026/03/P2") */
  billing_period?: string;
  /** Reporting office ID (IATA numeric code) */
  reporting_office_id?: string;
}

export interface TicketRecord {
  /** 13-digit ticket number */
  ticket_number: string;
  /** Conjunction suffix (e.g. "/1", "/2") — null for single ticket */
  conjunction_suffix?: string;
  /** Record locator */
  record_locator: string;
  /** Issuing carrier (validating carrier) */
  issuing_carrier: string;
  /** Issue date (ISO) */
  issue_date: string;
  /** Passenger name (LAST/FIRST format) */
  passenger_name: string;
  /** Coupons / segments */
  coupons: TicketSegment[];
  /** Base fare (decimal string) */
  base_fare: string;
  /** Base fare currency */
  base_fare_currency: string;
  /** Equivalent fare (if currency differs from selling) */
  equivalent_fare?: string;
  /** Equivalent fare currency */
  equivalent_fare_currency?: string;
  /** Total tax amount */
  total_tax: string;
  /** Tax breakdown */
  taxes: TaxBreakdownItem[];
  /** Total amount (base + tax) */
  total_amount: string;
  /** Fare calculation line */
  fare_calculation: string;
  /** Form of payment */
  form_of_payment: FormOfPayment;
  /** Endorsements / restrictions */
  endorsements?: string;
  /** Commission */
  commission?: CommissionData;
  /** BSP reporting */
  bsp_reporting?: BspReportingFields;
  /** Original issue reference (for reissues) */
  original_issue?: string;
}

export interface TicketIssuanceInput {
  /** Record locator */
  record_locator: string;
  /** Issuing carrier (2-letter IATA) */
  issuing_carrier: string;
  /** Passenger name (LAST/FIRST) */
  passenger_name: string;
  /** Segments to ticket */
  segments: Array<{
    carrier: string;
    flight_number: string;
    origin: string;
    destination: string;
    departure_date: string;
    departure_time?: string;
    booking_class: string;
    fare_basis: string;
    not_valid_before?: string;
    not_valid_after?: string;
    baggage_allowance?: string;
  }>;
  /** Base fare (decimal string) */
  base_fare: string;
  /** Base fare currency */
  base_fare_currency: string;
  /** Equivalent fare (optional, for currency conversion) */
  equivalent_fare?: string;
  /** Equivalent fare currency */
  equivalent_fare_currency?: string;
  /** Tax breakdown */
  taxes: TaxBreakdownItem[];
  /** Fare calculation line (free text) */
  fare_calculation: string;
  /** Form of payment */
  form_of_payment: FormOfPayment;
  /** Endorsements / restrictions */
  endorsements?: string;
  /** Commission */
  commission?: CommissionData;
  /** BSP reporting */
  bsp_reporting?: BspReportingFields;
  /** Issue date override (ISO — defaults to now) */
  issue_date?: string;
  /** Ticket number prefix (3-digit airline code — defaults from issuing_carrier) */
  ticket_number_prefix?: string;
  /** Original issue for reissue */
  original_issue?: string;
  /**
   * Supplier-allocated ticket numbers (from adapter documents / ticketing response).
   * Required in live mode — synthetic hash serials are refused.
   */
  supplier_ticket_numbers?: string[];
}

export interface TicketIssuanceOutput {
  /** Issued ticket records (1+ for conjunction tickets) */
  tickets: TicketRecord[];
  /** Total number of coupons across all tickets */
  total_coupons: number;
  /** Whether conjunction tickets were generated */
  is_conjunction: boolean;
}
