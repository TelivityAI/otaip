/**
 * Base OTAIP Agent interfaces.
 *
 * Every agent in OTAIP implements the Agent interface.
 * This ensures a uniform contract for initialization, execution, and health checks.
 */

/**
 * Wrapper for the input passed to {@link Agent.execute}.
 *
 * The agent-specific payload lives in {@link AgentInput.data}; `metadata`
 * carries out-of-band context (trace ids, caller info, pipeline gates) that is
 * not part of the domain input. This wrapper keeps the domain type (`T`) clean
 * while allowing the runtime to thread cross-cutting concerns.
 *
 * @typeParam T - The agent-specific input payload type.
 */
export interface AgentInput<T = unknown> {
  /** The agent-specific input payload. */
  data: T;
  /** Optional out-of-band context (e.g. trace ids, caller metadata). */
  metadata?: Record<string, unknown>;
}

/**
 * Wrapper for the result returned by {@link Agent.execute}.
 *
 * Mirrors {@link AgentInput}: the domain result is in {@link AgentOutput.data},
 * while `confidence`, `warnings`, and `metadata` describe the result without
 * polluting the domain type (`T`).
 *
 * @typeParam T - The agent-specific output payload type.
 */
export interface AgentOutput<T = unknown> {
  /** The agent-specific output payload. */
  data: T;
  /** Optional 0–1 confidence score for the result. */
  confidence?: number;
  /** Optional out-of-band context (e.g. dataset version, timing). */
  metadata?: Record<string, unknown>;
  /** Non-fatal notes about the result (e.g. stale data, fallbacks used). */
  warnings?: string[];
}

/**
 * Health snapshot returned by {@link Agent.health}.
 *
 * The three states are:
 * - `healthy` — fully operational; all required and optional data present.
 * - `degraded` — operational but impaired (e.g. stale or missing *optional*
 *   datasets); results may be incomplete.
 * - `unhealthy` — cannot serve requests (e.g. not initialized, required data
 *   missing).
 */
export interface AgentHealthStatus {
  /** Overall health state. */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Human-readable explanation, required in practice for non-healthy states. */
  details?: string;
}

/**
 * The base contract every OTAIP agent implements.
 *
 * Lifecycle: `initialize()` → `execute()` → `health()`.
 * - {@link Agent.initialize} must be called once before {@link Agent.execute};
 *   calling `execute` first throws `AgentNotInitializedError`.
 * - {@link Agent.execute} is stateless per call — agents hold no per-request
 *   state between invocations.
 * - {@link Agent.health} may be called at any time to probe readiness.
 *
 * @typeParam TInput - The agent-specific input payload type.
 * @typeParam TOutput - The agent-specific output payload type.
 */
export interface Agent<TInput = unknown, TOutput = unknown> {
  /** Stable agent identifier (e.g. `"0.1"`). */
  readonly id: string;
  /** Human-readable agent name. */
  readonly name: string;
  /** Agent implementation version (semver). */
  readonly version: string;

  /** Load data and prepare the agent. Call once before {@link Agent.execute}. */
  initialize(): Promise<void>;
  /** Run the agent against a single input. Must be called after {@link Agent.initialize}. */
  execute(input: AgentInput<TInput>): Promise<AgentOutput<TOutput>>;
  /** Report current health; see {@link AgentHealthStatus}. */
  health(): Promise<AgentHealthStatus>;
}
