/**
 * Run trace — a readable, by-id view over the events a run emitted.
 *
 * `getRunTrace(store, sessionId)` reads back everything OTAIP recorded for one
 * pipeline session: which agents ran, every gate result, adapter health, timing
 * and the final outcome. It is a pure projection over the {@link EventStore} —
 * no new state, no re-execution. Pair it with {@link FileEventStore} to read a
 * trace from a different process than the one that produced it.
 *
 * Events carry no secrets or PII, so a `RunTrace` is safe to log or return.
 */

import type { AdapterHealthEvent, AgentExecutedEvent, EventStore, OtaipEvent } from '@otaip/core';

export interface AgentExecutionTrace {
  readonly agentId: string;
  readonly success: boolean;
  readonly confidence: number;
  readonly durationMs: number;
  readonly timestamp: string;
  readonly gateResults: readonly { readonly gate: string; readonly passed: boolean }[];
}

export interface AdapterHealthTrace {
  readonly adapterId: string;
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly latencyMs?: number;
  readonly timestamp: string;
}

export interface RunTrace {
  readonly sessionId: string;
  /** Overall outcome derived from the agent executions in this session. */
  readonly outcome: 'ok' | 'rejected' | 'empty';
  readonly agentExecutions: readonly AgentExecutionTrace[];
  readonly adapterHealth: readonly AdapterHealthTrace[];
  /** Every raw event for the session, chronological — the durable source of truth. */
  readonly events: readonly OtaipEvent[];
}

function toAgentTrace(e: AgentExecutedEvent): AgentExecutionTrace {
  return {
    agentId: e.agentId,
    success: e.success,
    confidence: e.confidence,
    durationMs: e.durationMs,
    timestamp: e.timestamp,
    gateResults: e.gateResults,
  };
}

function toHealthTrace(e: AdapterHealthEvent): AdapterHealthTrace {
  return {
    adapterId: e.adapterId,
    status: e.status,
    ...(e.latencyMs !== undefined ? { latencyMs: e.latencyMs } : {}),
    timestamp: e.timestamp,
  };
}

/**
 * Read back the full trace for one run, by session id.
 *
 * @param store      the event store the run wrote to (in-memory or file-backed)
 * @param sessionId  the id returned by {@link runAvailabilitySearch}
 */
export async function getRunTrace(store: EventStore, sessionId: string): Promise<RunTrace> {
  const events = await store.query({ sessionId });

  const agentExecutions = events
    .filter((e): e is AgentExecutedEvent => e.type === 'agent.executed')
    .map(toAgentTrace);
  const adapterHealth = events
    .filter((e): e is AdapterHealthEvent => e.type === 'adapter.health')
    .map(toHealthTrace);

  let outcome: RunTrace['outcome'];
  if (agentExecutions.length === 0) {
    outcome = 'empty';
  } else if (agentExecutions.every((a) => a.success)) {
    outcome = 'ok';
  } else {
    outcome = 'rejected';
  }

  return { sessionId, outcome, agentExecutions, adapterHealth, events };
}
