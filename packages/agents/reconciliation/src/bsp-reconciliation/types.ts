/**
 * BSP Reconciliation — Types
 *
 * Agent 7.1: Matches agency records against BSP HOT files,
 * validates commission, identifies discrepancies.
 *
 * Domain: docs/knowledge-base/bsp-hot-reconciliation.md (DISH Rev 23).
 */

export type DiscrepancyType =
  | 'MISSING_IN_HOT'
  | 'MISSING_IN_AGENCY'
  | 'DUPLICATE_TRANSACTION'
  | 'COMMISSION_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'UNMATCHED_ADM'
  | 'UNMATCHED_ACM'
  | 'UNMATCHED_EXCHANGE'
  | 'CONJUNCTION_SET_MISMATCH';

export type DiscrepancySeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * HOT parse formats.
 * - DISH_REV23: synthetic DISH Rev 23–like tagged records (production HOT is fixed-width DISH).
 * - FIXED_WIDTH / EDI_X12: legacy lab fixtures — NOT a substitute for market DISH grids.
 *   Generic X12 parsers miss DISH fixed-width sections (see KB).
 */
export type HOTFileFormat = 'DISH_REV23' | 'EDI_X12' | 'FIXED_WIDTH';

/**
 * Logical reconciliation categories.
 * DISH TRNC values map into these; exchange-linked issues are separate from plain TKTT sales.
 * Conjunction / exchange / EMD / ADM are separate (KB §3).
 */
export type HOTTransactionType = 'SALE' | 'EXCHANGE' | 'REFUND' | 'ADM' | 'ACM' | 'EMD';

/** DISH TRNC codes we surface on parsed rows (non-exhaustive). */
export type DishTransactionCode =
  | 'TKTT'
  | 'EMDA'
  | 'EMDS'
  | 'RFND'
  | 'ADMA'
  | 'ACMA'
  | 'EXCH'
  | 'CANX'
  | 'TASF'
  | 'OTHER';

export interface RelatedDocumentRef {
  /** Related ticket/document number (DISH RTDN or ORIT) */
  ticket_number: string;
  /** Related coupons when present (DISH RCPN) */
  coupons?: string;
  /** Date of issue of related document (DISH DIRD / ORID) */
  issue_date?: string;
}

export interface HOTFileRecord {
  /** 13-digit ticket / document number (DISH TDNR, check-digit stripped when present) */
  ticket_number: string;
  /** Passenger name */
  passenger_name: string;
  /** Origin airport / city code */
  origin: string;
  /** Destination airport / city code */
  destination: string;
  /** 2-char airline code (derived from TACN when only numeric present) */
  airline_code: string;
  /** Issue date (ISO preferred) */
  issue_date: string;
  /** Ticket / document amount in transaction currency (decimal string) */
  ticket_amount: string;
  /** Commission amount in transaction currency (decimal string) */
  commission_amount: string;
  /** Commission rate percentage */
  commission_rate?: number;
  /** Tax amount in transaction currency (decimal string) */
  tax_amount: string;
  /** Refund amount if applicable (decimal string) */
  refund_amount?: string;
  /** Logical transaction category used by the matcher */
  transaction_type: HOTTransactionType;
  /**
   * DISH TRNC when known (TKTT / EMDA / EMDS / RFND / ADMA / ACMA / …).
   * Exchange-linked TKTT issues may still carry transaction_type EXCHANGE.
   */
  transaction_code?: DishTransactionCode;
  /** Issue sequence / SQNR */
  issue_sequence?: string;
  /** Payment type / FOP family (CA, CC, EX, …) */
  payment_type?: string;
  /**
   * Transaction currency (DISH record-level CUTP).
   * Do NOT assume this equals reporting_currency or a file-wide default.
   */
  currency: string;
  /**
   * Reporting / default currency context (DISH BOH03 CUTP) when known.
   * Used for remittance totals context only — never as a silent FX substitute.
   */
  reporting_currency?: string;
  /** BSP billing period (e.g., "2026-P03") */
  billing_period?: string;
  /** HOT transaction number (DISH TRNN) — shared across conjunction / envelope records */
  transaction_number?: string;
  /** True when this row is a conjunction document (CJCP=CNJ / BKS24-CNJ) */
  is_conjunction?: boolean;
  /** Primary ticket of the conjunction set when this row is a CNJ document */
  conjunction_primary?: string;
  /** All other tickets in the conjunction set (excluding this row’s TDNR) */
  conjunction_ticket_numbers?: string[];
  /**
   * Original issue ticket for exchange-linked issues (DISH BKS46 ORIT).
   * Present on the NEW document’s HOT envelope.
   */
  original_ticket_number?: string;
  /**
   * Related documents for RFND / ADM / ACM (DISH BKS45 RTDN list).
   */
  related_documents?: RelatedDocumentRef[];
}

export interface AgencyRecord {
  /** 13-digit ticket number */
  ticket_number: string;
  /** Passenger name */
  passenger_name: string;
  /** Origin airport code */
  origin: string;
  /** Destination airport code */
  destination: string;
  /** 2-char airline code */
  airline_code: string;
  /** Issue date (ISO) */
  issue_date: string;
  /** Ticket face value amount (decimal string) */
  ticket_amount: string;
  /** Commission amount (decimal string) */
  commission_amount: string;
  /** Commission rate percentage */
  commission_rate?: number;
  /** Tax amount (decimal string) */
  tax_amount: string;
  /** Refund amount if applicable (decimal string) */
  refund_amount?: string;
  /** Transaction type */
  transaction_type: HOTTransactionType;
  /**
   * Transaction currency — must match HOT CUTP for amount compares.
   * Do not assume agency reporting currency equals transaction currency.
   */
  currency: string;
  /** Reporting currency if mid-office stores a separate book currency */
  reporting_currency?: string;
  /** Original ticket when this agency row is an exchange reissue */
  original_ticket_number?: string;
  /** Conjunction companions for this ticket */
  conjunction_ticket_numbers?: string[];
  /** Related ticket for refund / ADM / ACM agency rows */
  related_ticket_number?: string;
}

export interface Discrepancy {
  /** Discrepancy type */
  type: DiscrepancyType;
  /** Severity */
  severity: DiscrepancySeverity;
  /** Ticket number (if applicable) */
  ticket_number?: string;
  /** Related / original ticket when cross-ref matching applies */
  related_ticket_number?: string;
  /** Airline code */
  airline_code?: string;
  /** Agency amount (decimal string) */
  agency_amount?: string;
  /** BSP/HOT amount (decimal string) */
  bsp_amount?: string;
  /** Difference (decimal string) */
  difference?: string;
  /** Transaction currency of the compared amounts */
  currency?: string;
  /** Human-readable description */
  description: string;
}

export interface PatternDetection {
  /** Pattern name */
  pattern: string;
  /** Number of occurrences */
  count: number;
  /** Total amount affected (decimal string) */
  total_amount: string;
  /** Currency */
  currency: string;
  /** Description */
  description: string;
}

export interface ReconciliationSummary {
  /** Total agency records */
  total_agency_records: number;
  /** Total HOT records */
  total_hot_records: number;
  /** Matched records */
  matched_count: number;
  /** Total discrepancies */
  discrepancy_count: number;
  /** Critical discrepancies */
  critical_count: number;
  /** Total discrepancy amount (decimal string) — same-currency rows only */
  total_discrepancy_amount: string;
  /** Threshold / reporting currency for summary (not an FX claim) */
  currency: string;
  /** Distinct transaction currencies observed in the HOT set */
  currencies_present: string[];
  /** Patterns detected */
  patterns: PatternDetection[];
}

export interface BSPReconciliationInput {
  /** Agency booking records */
  agency_records: AgencyRecord[];
  /** Parsed HOT file records */
  hot_records: HOTFileRecord[];
  /** Billing period (e.g., "2026-P03") */
  billing_period: string;
  /** Remittance deadline (ISO date) */
  remittance_deadline?: string;
  /** Minimum discrepancy threshold (decimal string, default "10.00") */
  min_threshold?: string;
  /**
   * Threshold currency (default "USD").
   * Threshold applies only when the transaction currency equals this code —
   * no IROE/ICER conversion (KB §2).
   */
  threshold_currency?: string;
  /** Current date/time (ISO) */
  current_datetime?: string;
}

export interface BSPReconciliationOutput {
  /** All discrepancies found */
  discrepancies: Discrepancy[];
  /** Reconciliation summary */
  summary: ReconciliationSummary;
  /** Whether reconciliation passed (no critical discrepancies) */
  passed: boolean;
}
