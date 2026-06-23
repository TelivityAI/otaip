/**
 * runAvailabilitySearch — the one documented entry point that runs Agent 1.1
 * (AvailabilitySearch) against a live distribution adapter, through OTAIP's six
 * pipeline gates, and emits a durable, readable trace.
 *
 * It does NOT fork execution or validation: it constructs the real
 * `AvailabilitySearch` agent, registers it with the real `PipelineOrchestrator`
 * under the real `availabilitySearchContract`, and calls `orchestrator.runAgent`.
 * The gates (intent_lock, schema_in, semantic_in, cross_agent, schema_out,
 * confidence, action_class) all fire exactly as they do everywhere else.
 *
 * Tracing mirrors the existing `agentToTool` bridge: one `agent.executed` event
 * per run carrying the gate results + timing, plus an `adapter.health` event for
 * the adapter that served the search.
 *
 * Credentials: the Duffel key is read once, at adapter construction, from
 * `options.duffelApiKey` or `process.env.DUFFEL_API_KEY`. It is never written to
 * an event, a trace, a log line, or the returned payload.
 */

import type {
  AdapterHealthEvent,
  AgentExecutedEvent,
  DistributionAdapter,
  EventStore,
  ReferenceDataProvider,
  SemanticIssue,
} from '@otaip/core';
import {
  InMemoryEventStore,
  PipelineOrchestrator,
  type AgentContract,
  type Agent,
} from '@otaip/core';
import { DuffelAdapter } from '@otaip/adapter-duffel';
import {
  AvailabilitySearch,
  availabilitySearchContract,
  type AvailabilitySearchInput,
  type AvailabilitySearchOutput,
} from '@otaip/agents-search';
import { ReferenceAgentDataProvider } from '@otaip/agents-reference';
import { getRunTrace, type RunTrace } from './trace.js';

const AGENT_ID = '1.1';

export interface RunSearchOptions {
  /**
   * Duffel API key. If omitted, `DuffelAdapter` reads `process.env.DUFFEL_API_KEY`.
   * A `duffel_test_…` key targets the sandbox; `duffel_live_…` targets production.
   * Server-side only — never logged, traced, or returned.
   */
  readonly duffelApiKey?: string;
  /** Override the Duffel base URL (e.g. a recorded-fixture server in tests). */
  readonly duffelBaseUrl?: string;
  /**
   * Inject a pre-built adapter (tests / alternative suppliers). When set,
   * `duffelApiKey`/`duffelBaseUrl` are ignored.
   */
  readonly adapter?: DistributionAdapter;
  /**
   * Event store the trace is written to. Pass a {@link FileEventStore} for a
   * durable, re-readable trace. Defaults to a fresh in-memory store (returned
   * on the result so the caller can still read it back this process).
   */
  readonly eventStore?: EventStore;
  /**
   * Reference-data provider backing the semantic gate (airport resolution).
   * Defaults to the real `ReferenceAgentDataProvider` (OurAirports data).
   */
  readonly reference?: ReferenceDataProvider;
  /** Clock injection (tests). Defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

export interface RunSearchFailure {
  readonly reason: string;
  /** 'infra' | 'execution' | 'validation' — never conflate a setup bug with a real rejection. */
  readonly failureClass: string;
  readonly issues: readonly SemanticIssue[];
}

export interface RunSearchResult {
  /** The pipeline session id — use it to read the trace back via {@link getRunTrace}. */
  readonly sessionId: string;
  /** True when the run passed every gate. */
  readonly ok: boolean;
  /** Normalized, gate-validated search output. Present iff `ok`. */
  readonly output?: AvailabilitySearchOutput;
  /** Structured rejection detail. Present iff not `ok`. */
  readonly failure?: RunSearchFailure;
  /** The full, by-id trace for this run (also durably in `eventStore`). */
  readonly trace: RunTrace;
  /** The event store this run wrote to (the caller's, or the default in-memory one). */
  readonly eventStore: EventStore;
}

let eventSeq = 0;
function nextEventId(prefix: string): string {
  eventSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${eventSeq.toString(36)}`;
}

function totalPassengers(input: AvailabilitySearchInput): number {
  return input.passengers.reduce((sum, p) => sum + p.count, 0);
}

/**
 * Run Agent 1.1 against a live adapter through the gates, emitting a trace.
 *
 * @example
 *   const res = await runAvailabilitySearch(
 *     { origin: 'JFK', destination: 'LHR', departure_date: '2026-07-23',
 *       passengers: [{ type: 'ADT', count: 1 }], cabin_class: 'economy' },
 *     { eventStore: await FileEventStore.open('./traces/run.jsonl') },
 *   );
 *   if (res.ok) console.log(res.output.offers.length, 'offers');
 *   const trace = await getRunTrace(res.eventStore, res.sessionId);
 */
export async function runAvailabilitySearch(
  input: AvailabilitySearchInput,
  options: RunSearchOptions = {},
): Promise<RunSearchResult> {
  const now = options.now ?? ((): Date => new Date());
  const eventStore = options.eventStore ?? new InMemoryEventStore();

  const adapter: DistributionAdapter =
    options.adapter ?? new DuffelAdapter(options.duffelApiKey, options.duffelBaseUrl);

  const reference: ReferenceDataProvider = options.reference ?? new ReferenceAgentDataProvider();
  if (reference.ready) await reference.ready();

  // --- Build the real agent + orchestrator (no parallel path) ---------------
  const agent = new AvailabilitySearch([adapter]);
  await agent.initialize();

  const orchestrator = new PipelineOrchestrator({
    reference,
    contracts: new Map<string, AgentContract>([[AGENT_ID, availabilitySearchContract]]),
    agents: new Map<string, Agent>([[AGENT_ID, agent as Agent]]),
    now,
  });

  const session = orchestrator.createSession({
    type: input.return_date ? 'round_trip_search' : 'one_way_search',
    origin: input.origin,
    destination: input.destination,
    outboundDate: input.departure_date,
    ...(input.return_date ? { returnDate: input.return_date } : {}),
    passengerCount: totalPassengers(input),
    ...(input.cabin_class ? { cabinClass: input.cabin_class } : {}),
    lockedBy: 'integration.runAvailabilitySearch',
  });

  // --- Run through the gates ------------------------------------------------
  const result = await orchestrator.runAgent<AvailabilitySearchOutput>(session, AGENT_ID, input);

  const inv = result.invocation;
  const finishedAt = inv.finishedAt ?? inv.startedAt;
  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(inv.startedAt));

  // --- Emit agent.executed (mirrors the agentToTool bridge) -----------------
  const agentEvent: AgentExecutedEvent = {
    eventId: nextEventId('evt'),
    type: 'agent.executed',
    timestamp: now().toISOString(),
    sessionId: session.sessionId,
    agentId: AGENT_ID,
    inputHash: hashInput(input),
    confidence: result.ok ? (result.output.confidence ?? 0) : 0,
    durationMs,
    success: result.ok,
    gateResults: inv.gateResults.map((g) => ({ gate: g.gate, passed: g.passed })),
  };
  await eventStore.append(agentEvent);

  // --- Emit adapter.health from the real search's per-source status ---------
  // The search output carries the actual outcome + latency of each adapter call;
  // we derive health from it rather than issuing a second network probe.
  const sourceStatuses = result.ok ? result.output.data.source_status : [];
  if (sourceStatuses.length === 0) {
    // Run was rejected before producing output — record the adapter we wired.
    const healthEvent: AdapterHealthEvent = {
      eventId: nextEventId('evt'),
      type: 'adapter.health',
      timestamp: now().toISOString(),
      sessionId: session.sessionId,
      adapterId: adapter.name,
      status: 'unhealthy',
    };
    await eventStore.append(healthEvent);
  } else {
    for (const s of sourceStatuses) {
      const healthEvent: AdapterHealthEvent = {
        eventId: nextEventId('evt'),
        type: 'adapter.health',
        timestamp: now().toISOString(),
        sessionId: session.sessionId,
        adapterId: s.source,
        status: s.success ? 'healthy' : 'unhealthy',
        latencyMs: s.response_time_ms,
      };
      await eventStore.append(healthEvent);
    }
  }

  const trace = await getRunTrace(eventStore, session.sessionId);

  if (result.ok) {
    return {
      sessionId: session.sessionId,
      ok: true,
      output: result.output.data,
      trace,
      eventStore,
    };
  }

  return {
    sessionId: session.sessionId,
    ok: false,
    failure: {
      reason: result.reason,
      failureClass: result.failureClass,
      issues: result.issues,
    },
    trace,
    eventStore,
  };
}

/** Lightweight, non-crypto input fingerprint — matches the bridge's dedup hash. */
function hashInput(input: unknown): string {
  const str = JSON.stringify(input);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
