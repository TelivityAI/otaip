/**
 * OTAIP Event Store — types.
 *
 * Persistent event and outcome logging for every agent execution, every
 * routing decision, every booking outcome. Foundation for governance
 * agents (Sprint C) and for routing intelligence (historical data).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Event types
// ─────────────────────────────────────────────────────────────────────────────

export type OtaipEventType =
  | 'agent.executed'
  | 'routing.decided'
  | 'routing.outcome'
  | 'booking.completed'
  | 'booking.failed'
  | 'adapter.health'
  | 'mutation.unknown'
  | 'mutation.irreversible';

interface BaseEvent {
  readonly eventId: string;
  readonly type: OtaipEventType;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
  /** Pipeline session ID (when the event originates from a pipeline run). */
  readonly sessionId?: string;
}

export interface AgentExecutedEvent extends BaseEvent {
  readonly type: 'agent.executed';
  readonly agentId: string;
  /** SHA-256 hex of JSON-stringified input (for dedup / replay detection). */
  readonly inputHash: string;
  readonly confidence: number;
  readonly durationMs: number;
  readonly success: boolean;
  readonly gateResults: readonly { gate: string; passed: boolean }[];
}

export interface RoutingDecidedEvent extends BaseEvent {
  readonly type: 'routing.decided';
  readonly carrier: string;
  readonly channel: string;
  readonly reasoning: string;
  readonly confidence: number;
  readonly fallbackChain?: readonly string[];
}

export interface RoutingOutcomeEvent extends BaseEvent {
  readonly type: 'routing.outcome';
  readonly channel: string;
  readonly success: boolean;
  readonly latencyMs: number;
  readonly errorCode?: string;
}

export interface BookingCompletedEvent extends BaseEvent {
  readonly type: 'booking.completed';
  readonly bookingRef: string;
  readonly channel: string;
  readonly totalAmount: string;
  readonly currency: string;
  readonly totalFlowDurationMs: number;
}

export interface BookingFailedEvent extends BaseEvent {
  readonly type: 'booking.failed';
  readonly channel: string;
  readonly failurePoint: string;
  readonly errorCode: string;
  readonly errorMessage: string;
}

export interface AdapterHealthEvent extends BaseEvent {
  readonly type: 'adapter.health';
  readonly adapterId: string;
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly latencyMs?: number;
  readonly errorRate?: number;
}

/** Ambiguous mutation outcome awaiting reconcile (DoD 1 / 8). */
export interface MutationUnknownEvent extends BaseEvent {
  readonly type: 'mutation.unknown';
  readonly effectType: string;
  readonly idempotencyKey: string;
  readonly supplierId?: string;
  readonly failurePoint: string;
}

/** Irreversible action audit (no PII) — DoD 8. */
export interface MutationIrreversibleEvent extends BaseEvent {
  readonly type: 'mutation.irreversible';
  readonly actionId: string;
  readonly effectType: string;
  readonly payloadHash: string;
  readonly agentId?: string;
  readonly externalRef?: string;
}

export type OtaipEvent =
  | AgentExecutedEvent
  | RoutingDecidedEvent
  | RoutingOutcomeEvent
  | BookingCompletedEvent
  | BookingFailedEvent
  | AdapterHealthEvent
  | MutationUnknownEvent
  | MutationIrreversibleEvent;

// ─────────────────────────────────────────────────────────────────────────────
// Query / aggregation
// ─────────────────────────────────────────────────────────────────────────────

export interface TimeWindow {
  /** ISO 8601 start (inclusive). */
  readonly from: string;
  /** ISO 8601 end (exclusive). */
  readonly to: string;
}

export interface EventFilter {
  readonly type?: OtaipEventType | readonly OtaipEventType[];
  readonly sessionId?: string;
  readonly agentId?: string;
  readonly adapterId?: string;
  readonly window?: TimeWindow;
  readonly limit?: number;
}

export interface AggregateResult {
  readonly metric: string;
  readonly window: TimeWindow;
  readonly count: number;
  readonly sum?: number;
  readonly avg?: number;
  readonly min?: number;
  readonly max?: number;
  readonly p50?: number;
  readonly p95?: number;
  readonly p99?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// EventStore interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pluggable event store. `InMemoryEventStore` ships with core for zero-
 * config operation. External store adapters (Postgres, Supabase, Redis)
 * are separate packages, built later.
 */
export interface EventStore {
  /** Append a single event. Implementations must be idempotent on `eventId`. */
  append(event: OtaipEvent): Promise<void>;
  /** Query events matching the filter. Results are ordered by timestamp ascending. */
  query(filter: EventFilter): Promise<OtaipEvent[]>;
  /**
   * Aggregate a numeric field (e.g. 'durationMs', 'latencyMs') over
   * matching events within the time window. Returns percentiles + basic stats.
   */
  aggregate(metric: string, window: TimeWindow, filter?: Omit<EventFilter, 'window'>): Promise<AggregateResult>;
}
