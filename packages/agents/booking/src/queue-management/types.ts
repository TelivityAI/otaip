/**
 * Queue Management — Types
 *
 * Agent 3.4: GDS queue monitoring and processing.
 */

export type QueueEntryType =
  | 'TTL_DEADLINE'
  | 'SCHEDULE_CHANGE'
  | 'WAITLIST_CLEAR'
  | 'INVOLUNTARY_REBOOK'
  | 'GENERAL'
  | 'TICKET_REMINDER';

export type QueuePriority = 'urgent' | 'high' | 'normal' | 'low';

export type QueueItemStatus = 'pending' | 'processing' | 'processed' | 'failed' | 'skipped';

export type QueueGdsSystem = 'AMADEUS' | 'SABRE' | 'TRAVELPORT';

/**
 * Travelport host family for queue command generation.
 * GALILEO ≡ Travelport+ column in the public format-compare table.
 * Source: docs/knowledge-base/tmc-mid-office-ttl-queues.md
 */
export type TravelportHost = 'APOLLO' | 'GALILEO' | 'WORLDSPAN';

export type QueueAction =
  | 'ROUTE_TO_TICKETING'
  | 'ROUTE_TO_REISSUE'
  | 'ROUTE_TO_SCHEDULE_CHANGE'
  | 'ROUTE_TO_WAITLIST'
  | 'ROUTE_TO_MANUAL_REVIEW'
  | 'AUTO_PROCESS';

export interface QueueEntry {
  /** Queue item ID */
  item_id: string;
  /** Record locator */
  record_locator: string;
  /** GDS system */
  gds: QueueGdsSystem;
  /** Queue number */
  queue_number: number;
  /** Queue category (sub-queue) */
  queue_category?: number;
  /** Entry type */
  entry_type: QueueEntryType;
  /** Timestamp when placed on queue (ISO) */
  placed_at: string;
  /** Associated deadline (ISO) — for TTL or schedule change response deadlines */
  deadline?: string;
  /** Free-text reason / remark from GDS */
  remark?: string;
  /** Number of passengers in the PNR */
  passenger_count?: number;
  /** Number of segments in the PNR */
  segment_count?: number;
}

export interface QueueProcessingResult {
  /** Queue item ID */
  item_id: string;
  /** Record locator */
  record_locator: string;
  /** Assigned priority */
  priority: QueuePriority;
  /** Processing status */
  status: QueueItemStatus;
  /** Recommended action */
  action: QueueAction;
  /** Reason for the action/priority */
  reason: string;
  /** Target agent ID to route to (if applicable) */
  target_agent?: string;
}

export interface QueueCommand {
  /** GDS system */
  gds: QueueGdsSystem;
  /** Command string */
  command: string;
  /** Description of what the command does */
  description: string;
}

export interface QueueManagementInput {
  /** Queue entries to process */
  entries: QueueEntry[];
  /** Current date/time for priority calculation (ISO — defaults to now; compare as Zulu for TTL) */
  current_time?: string;
  /** GDS system for queue commands */
  gds?: QueueGdsSystem;
  /** Queue number to generate read commands for */
  queue_number?: number;
  /**
   * Required for accurate Travelport place/list/remove commands.
   * GALILEO = Travelport+ host family.
   */
  travelport_host?: TravelportHost;
}

export interface QueueManagementOutput {
  /** Processed results */
  results: QueueProcessingResult[];
  /** Queue commands (if GDS and queue_number provided) */
  commands?: QueueCommand[];
  /** Summary counts */
  summary: {
    total: number;
    urgent: number;
    high: number;
    normal: number;
    low: number;
  };
}
