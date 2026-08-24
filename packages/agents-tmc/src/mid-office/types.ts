/**
 * Mid-Office Automation — Types
 *
 * Agent 8.3: PNR quality checks, ticketing deadline monitoring.
 */

export type TriggerType =
  | 'scheduled_sweep'
  | 'pnr_created'
  | 'ticket_deadline_approaching'
  | 'queue_pending'
  | 'manual_review_request';

export type IssueSeverity = 'urgent' | 'high' | 'medium' | 'low';

export type IssueCode =
  | 'TTL_URGENT'
  | 'TTL_APPROACHING'
  | 'MISSING_SEGMENT_STATUS'
  | 'MISSING_APIS'
  | 'MISSING_CONTACT'
  | 'MISSING_FOP'
  | 'DUPLICATE_PNR'
  | 'PASSIVE_SEGMENT'
  | 'POLICY_VIOLATION'
  | 'MARRIED_SEGMENT_INCOMPLETE';

export interface PnrSegment {
  carrier: string;
  flight_number: string;
  origin: string;
  destination: string;
  origin_country: string;
  destination_country: string;
  departure_date: string;
  departure_time: string;
  status: string;
  booking_class: string;
  married_group?: string;
  cabin?: string;
}

export interface MockPnr {
  recloc: string;
  passenger_name: string;
  segments: PnrSegment[];
  /**
   * Ticketing deadline as ISO instant. For Travelport-originated TTLs
   * (T.TAU / T.TAW / ORB), treat as Zulu — see docs/knowledge-base/tmc-mid-office-ttl-queues.md.
   */
  ticket_deadline?: string;
  /**
   * When present, ticket already issued. Used for the issued-on-deadline-day
   * ADM pattern (Zulu calendar day match).
   */
  ticket_issued_at?: string;
  apis_complete: boolean;
  contact_present: boolean;
  fop_present: boolean;
  corporate_id?: string;
  fare_amount_usd?: string;
}

export interface PnrIssue {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
}

export interface PnrCheckResult {
  recloc: string;
  checks_passed: number;
  issues: PnrIssue[];
  action_required: boolean;
}

export interface MidOfficeInput {
  trigger_type: TriggerType;
  pnrs: MockPnr[];
  /** Other active PNRs for duplicate detection */
  active_pnrs?: MockPnr[];
  current_datetime?: string;
}

export interface MidOfficeOutput {
  results: PnrCheckResult[];
  total_pnrs: number;
  action_required_count: number;
  urgent_count: number;
}
