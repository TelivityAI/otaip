/**
 * Playground Service — backs the developer Playground page.
 *
 * Three modes:
 *   - **search**: thin wrapper over `SearchService` (calls the configured
 *     OTA adapter). Same canonical `SearchOffer[]` shape the OTA returns.
 *   - **agent**: dispatches to a curated whitelist of agents that don't
 *     need the pipeline orchestrator. v1 ships one agent — `0.1`
 *     `AirportCodeResolver`. Non-whitelisted IDs return a `not_executable`
 *     error so the UI can render a clear "not yet wired" state instead of
 *     pretending to run.
 *   - **adapter**: wraps a configured adapter and runs `search` / `price`
 *     against it directly. Booking through this surface is intentionally
 *     not exposed.
 *
 * Catalog endpoint surfaces *every* agent for the picker, plus the
 * whitelist of executable IDs and any input schemas we have on hand. The
 * front end uses this to gate the form / show source paths.
 */

import { discoverAgents, type DiscoveredAgent } from '@otaip/core';
import type { OtaAdapter, BookingLifecycle } from '../types.js';
import type { SearchService } from './search-service.js';

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface PlaygroundCatalog {
  agents: DiscoveredAgent[];
  /** IDs that this build of the playground can actually execute. */
  executable_ids: string[];
  /**
   * Best-effort input descriptors keyed by agent ID. Free-form so the UI
   * can render a hint / sample payload. Real Zod-derived JSON Schemas
   * would land here as the curated whitelist grows.
   */
  schemas: Record<string, AgentSchemaHint>;
}

export interface AgentSchemaHint {
  /** A short human description for the picker. */
  description: string;
  /**
   * A minimal input the user can hit "execute" on without filling fields.
   * The UI seeds the JSON editor with this value.
   */
  example_input: unknown;
}

// ---------------------------------------------------------------------------
// Search mode
// ---------------------------------------------------------------------------

export interface PlaygroundSearchInput {
  origin: string;
  destination: string;
  date: string;
  returnDate?: string;
  passengers: number;
  cabinClass?: 'economy' | 'premium_economy' | 'business' | 'first';
}

export interface PlaygroundSearchResult {
  offers: unknown[];
  totalFound: number;
  sources: string[];
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// Agent mode
// ---------------------------------------------------------------------------

export interface PlaygroundAgentResult {
  agent_id: string;
  output: unknown;
  duration_ms: number;
}

export class AgentNotExecutableError extends Error {
  readonly agent_id: string;
  constructor(agent_id: string) {
    super(
      `Agent '${agent_id}' is not yet wired for playground execution. ` +
        'Generic execution requires PipelineOrchestrator + PipelineSession setup; ' +
        'the playground starts with a curated whitelist and grows as agents are wired in.',
    );
    this.name = 'AgentNotExecutableError';
    this.agent_id = agent_id;
  }
}

// ---------------------------------------------------------------------------
// Adapter mode
// ---------------------------------------------------------------------------

export type AdapterOperation = 'search' | 'price' | 'isAvailable';

export interface PlaygroundAdapterInput {
  operation: AdapterOperation;
  /** Operation-specific payload — passed through to the adapter as-is. */
  input: unknown;
}

export interface PlaygroundAdapterResult {
  operation: AdapterOperation;
  output: unknown;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PlaygroundService {
  private readonly adapter: OtaAdapter & BookingLifecycle;
  private readonly searchService: SearchService;
  /** Lazy cache so we instantiate each curated agent at most once per process. */
  private readonly agentInstances = new Map<string, AgentLike>();

  constructor(adapter: OtaAdapter & BookingLifecycle, searchService: SearchService) {
    this.adapter = adapter;
    this.searchService = searchService;
  }

  catalog(): PlaygroundCatalog {
    return {
      agents: discoverAgents(),
      executable_ids: [...EXECUTABLE_AGENT_IDS],
      schemas: AGENT_SCHEMA_HINTS,
    };
  }

  async search(input: PlaygroundSearchInput): Promise<PlaygroundSearchResult> {
    const start = Date.now();
    const result = await this.searchService.search({
      origin: input.origin,
      destination: input.destination,
      date: input.date,
      ...(input.returnDate ? { returnDate: input.returnDate } : {}),
      passengers: input.passengers,
      ...(input.cabinClass ? { cabinClass: input.cabinClass } : {}),
    });
    return {
      offers: result.offers,
      totalFound: result.totalFound,
      sources: result.sources,
      duration_ms: Date.now() - start,
    };
  }

  async runAgent(agent_id: string, input: unknown): Promise<PlaygroundAgentResult> {
    if (!EXECUTABLE_AGENT_IDS.has(agent_id)) {
      throw new AgentNotExecutableError(agent_id);
    }
    const start = Date.now();
    const agent = await this.resolveAgent(agent_id);
    const output = await agent.execute({ data: input });
    return { agent_id, output, duration_ms: Date.now() - start };
  }

  async runAdapter(req: PlaygroundAdapterInput): Promise<PlaygroundAdapterResult> {
    const start = Date.now();
    let output: unknown;
    if (req.operation === 'isAvailable') {
      output = await this.adapter.isAvailable();
    } else if (req.operation === 'search') {
      output = await this.adapter.search(req.input as Parameters<OtaAdapter['search']>[0]);
    } else if (req.operation === 'price') {
      if (!this.adapter.price) {
        throw new Error("The configured adapter does not implement 'price'.");
      }
      output = await this.adapter.price(req.input as Parameters<NonNullable<OtaAdapter['price']>>[0]);
    } else {
      // Exhaustive check — TS should have caught this; runtime guard for JSON callers.
      throw new Error(`Unsupported adapter operation: ${String(req.operation)}`);
    }
    return { operation: req.operation, output, duration_ms: Date.now() - start };
  }

  // -------------------------------------------------------------------------
  // Curated whitelist
  // -------------------------------------------------------------------------

  private async resolveAgent(agent_id: string): Promise<AgentLike> {
    const cached = this.agentInstances.get(agent_id);
    if (cached) return cached;
    const factory = AGENT_FACTORIES[agent_id];
    if (!factory) {
      // Whitelisted but no factory — should never happen if EXECUTABLE_AGENT_IDS
      // and AGENT_FACTORIES are kept in sync. Treat as unwired.
      throw new AgentNotExecutableError(agent_id);
    }
    const agent = await factory();
    this.agentInstances.set(agent_id, agent);
    return agent;
  }
}

// ---------------------------------------------------------------------------
// Whitelist
// ---------------------------------------------------------------------------

interface AgentLike {
  execute(input: { data: unknown }): Promise<unknown>;
}

/**
 * Lazy factory map. Imports happen when the agent is first invoked so we do
 * not pay the import cost (heavy reference data, fuzzy index, etc.) at boot.
 *
 * To wire another agent into the playground:
 *   1. Add its ID to `EXECUTABLE_AGENT_IDS`.
 *   2. Add a factory entry here that imports the agent class, instantiates,
 *      and runs `initialize()` if needed.
 *   3. Add a schema hint to `AGENT_SCHEMA_HINTS` so the UI can seed the form.
 */
const AGENT_FACTORIES: Record<string, () => Promise<AgentLike>> = {
  '0.1': async () => {
    const { AirportCodeResolver } = await import('@otaip/agents-reference');
    const a = new AirportCodeResolver();
    await a.initialize();
    return a as unknown as AgentLike;
  },
};

const EXECUTABLE_AGENT_IDS: ReadonlySet<string> = new Set(Object.keys(AGENT_FACTORIES));

const AGENT_SCHEMA_HINTS: Record<string, AgentSchemaHint> = {
  '0.1': {
    description: 'Resolve an airport, city, or station code to its canonical record.',
    example_input: { code: 'JFK', code_type: 'iata' },
  },
};
