/**
 * OTAIP Pipeline Contract — types.
 *
 * Every agent that participates in an LLM-orchestrated or pipeline-composed
 * flow must declare an `AgentContract`. The runtime `PipelineValidator`
 * enforces the contract through six gates: schema, semantic, intent lock,
 * cross-agent consistency, confidence, action classification.
 *
 * Note: `SemanticValidationResult` is intentionally distinct from the existing
 * `ValidationResult<T>` in `tool-interface/types.ts` (which is the schema-parse
 * result). Do not unify them.
 */

import type { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Action classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Action consequences for an agent. Drives confidence floors and the
 * action-classifier gate (mutation_irreversible requires approval).
 */
export type ActionType = 'query' | 'mutation_reversible' | 'mutation_irreversible';

/** Confidence floors per action type. Contracts may declare higher, never lower. */
export const CONFIDENCE_FLOORS: Readonly<Record<ActionType, number>> = Object.freeze({
  query: 0.7,
  mutation_reversible: 0.9,
  mutation_irreversible: 0.95,
});

/**
 * Reference data agents have an additional floor (0.9) — applied when an
 * agent's `outputContract` includes `match_confidence` or the agent is
 * registered as a reference data source.
 */
export const REFERENCE_CONFIDENCE_FLOOR = 0.9;

// ─────────────────────────────────────────────────────────────────────────────
// Semantic validation
// ─────────────────────────────────────────────────────────────────────────────

export interface SemanticIssue {
  /** Stable machine code, e.g. 'DATE_IN_PAST', 'AIRPORT_NOT_FOUND'. */
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
  /** Optional human-readable suggestion the LLM can use to self-correct. */
  readonly suggestion?: string;
  readonly severity: 'error' | 'warning';
}

/**
 * Semantic validation result. `ok: true` may still carry warnings (logged,
 * not blocking). `ok: false` carries one or more error-severity issues.
 */
export type SemanticValidationResult =
  | { readonly ok: true; readonly warnings: readonly SemanticIssue[] }
  | { readonly ok: false; readonly issues: readonly SemanticIssue[] };

// ─────────────────────────────────────────────────────────────────────────────
// Reference data provider (DI shape)
// ─────────────────────────────────────────────────────────────────────────────

export interface AirportRef {
  readonly iataCode: string;
  readonly icaoCode?: string;
  readonly name: string;
  readonly city?: string;
  readonly country?: string;
  readonly matchConfidence: number;
}

export interface AirlineRef {
  readonly iataCode: string;
  readonly icaoCode?: string;
  readonly name: string;
  readonly matchConfidence: number;
}

export interface FareBasisRef {
  readonly fareBasis: string;
  readonly carrier?: string;
  readonly matchConfidence: number;
}

/**
 * Pluggable reference-data provider. The default implementation in
 * `@otaip/agents-reference` wraps `AirportCodeResolver`,
 * `AirlineCodeMapper`, and `FareBasisDecoder`. Tests can inject a
 * deterministic in-memory implementation.
 */
export interface ReferenceDataProvider {
  resolveAirport(code: string): Promise<AirportRef | null>;
  resolveAirline(code: string): Promise<AirlineRef | null>;
  decodeFareBasis(code: string, carrier?: string): Promise<FareBasisRef | null>;
  /** Optional warmup hook (e.g. initialize underlying agents). */
  ready?(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline intent + session
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The locked goal of a pipeline session. Set once at `createSession`,
 * cannot be mutated by any agent or LLM tool call. Developers may explicitly
 * unlock+relock via `IntentLock.unlock()` (e.g. IRROPS rebooking).
 */
export interface PipelineIntent {
  readonly type: string; // e.g. 'one_way_economy_booking', 'round_trip_business_booking'
  readonly origin: string;
  readonly destination: string;
  readonly outboundDate: string; // ISO date
  readonly returnDate?: string; // ISO date
  readonly passengerCount: number;
  readonly cabinClass?: 'economy' | 'premium_economy' | 'business' | 'first';
  readonly lockedAt: string; // ISO timestamp
  readonly lockedBy: string; // identifier of the caller that opened the session
}

/** Result of a single agent invocation through the pipeline orchestrator. */
export interface AgentInvocation {
  readonly invocationId: string;
  readonly agentId: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly input: unknown;
  readonly output?: unknown;
  readonly gateResults: readonly GateResult[];
  readonly status: 'ok' | 'blocked' | 'error';
}

export type GateName =
  | 'intent_lock'
  | 'schema_in'
  | 'semantic_in'
  | 'cross_agent'
  | 'execute'
  | 'schema_out'
  | 'confidence'
  | 'action_class';

export interface GateResult {
  readonly gate: GateName;
  readonly passed: boolean;
  readonly issues?: readonly SemanticIssue[];
  readonly note?: string;
}

/** A pipeline session — a single user goal carried across multiple agent calls. */
export interface PipelineSession {
  readonly sessionId: string;
  readonly intent: PipelineIntent;
  readonly history: AgentInvocation[];
  /** Cumulative running state of `outputContract` fields keyed by agentId. */
  readonly contractState: Map<string, Record<string, unknown>>;
  /** Retry budget tracking — keyed by `${agentId}:${gate}`. */
  readonly retriesUsed: Map<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentContract — the platform-citizen interface
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationContext {
  readonly reference: ReferenceDataProvider;
  readonly now: Date;
  readonly intent: PipelineIntent;
  /** Read-only snapshot of `outputContract` fields produced earlier in the session. */
  readonly priorOutputs: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
}

export interface AgentContract<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> {
  /** Must match the agent's `id`. */
  readonly agentId: string;

  /**
   * Human-readable, one-line statement of what the agent does. Surfaced in
   * the generated tool catalog / `describe_agent` output and the agent
   * manifest, so a caller (or an LLM router) can tell agents apart. When
   * omitted, the catalog falls back to `OTAIP agent <id> (<actionType>)`.
   * Keep it concrete and free of invented domain behavior.
   */
  readonly description?: string;

  /** Zod schema for the agent's input data (the `data` field of `AgentInput`). */
  readonly inputSchema: TInput;

  /** Zod schema for the agent's output data (the `data` field of `AgentOutput`). */
  readonly outputSchema: TOutput;

  /** Action classification — drives confidence floor and approval requirement. */
  readonly actionType: ActionType;

  /**
   * Minimum confidence on the agent's `AgentOutput.confidence` field for the
   * output to be accepted. Must be at or above the floor for `actionType`.
   */
  readonly confidenceThreshold: number;

  /**
   * Field names that downstream agents may depend on. After successful
   * execution, these fields are read from `output.data` and stored in
   * `PipelineSession.contractState[agentId]` for cross-agent checks.
   */
  readonly outputContract: readonly string[];

  /**
   * Intent types this agent can serve. If declared and the session intent
   * type is not in this list, the intent_lock gate blocks the call.
   * If undefined/empty, the agent is intent-agnostic and always allowed.
   */
  readonly intentRelevance?: readonly string[];

  /**
   * Domain-specific input checks beyond Zod structural validation. Async
   * because reference lookups (airport, carrier, fare basis) are async.
   */
  validate(input: z.output<TInput>, ctx: ValidationContext): Promise<SemanticValidationResult>;

  /**
   * Optional cross-field output checks beyond Zod structural validation.
   * Runs after `agent.execute()` succeeds and before the confidence gate.
   */
  validateOutput?(
    output: z.output<TOutput>,
    ctx: ValidationContext,
  ): Promise<SemanticValidationResult>;
}
