/**
 * Agent 20.8 — Activity Search
 *
 * Thin typed wrapper around Hotelbeds Activities search so Tarmac can
 * route→fill and Aviare can map to activity_search.
 */
import type { Agent, AgentInput, AgentOutput } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type { ActivitySearchAgentInput, ActivitySearchAgentOutput } from './types.js';

export type {
  ActivitySearchAgentInput,
  ActivitySearchAgentOutput,
  ActivitySearchAgentOffer,
} from './types.js';

export interface ActivitySearchAdapter {
  searchActivities(req: {
    destination: string;
    from: string;
    to: string;
    paxes?: Array<{ age: number }>;
  }): Promise<Array<{ code?: string; name?: string; amountsFrom?: Array<{ amount?: string; currency?: string }> }>>;
}

export class ActivitySearchAgent
  implements Agent<ActivitySearchAgentInput, ActivitySearchAgentOutput>
{
  readonly id = '20.8';
  readonly name = 'Activity Search';
  readonly version = '0.1.0';

  private initialized = false;
  constructor(private readonly adapter?: ActivitySearchAdapter) {}

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<ActivitySearchAgentInput>,
  ): Promise<AgentOutput<ActivitySearchAgentOutput>> {
    if (!this.initialized) throw new AgentNotInitializedError(this.id);
    const d = input.data;
    if (!d.destination || !d.dateFrom || !d.dateTo) {
      throw new AgentInputValidationError(
        this.id,
        'destination/dateFrom/dateTo',
        'Required.',
      );
    }
    if (!this.adapter) {
      return {
        data: { offers: [] },
        metadata: { note: 'No adapter injected — envelope validated only.' },
      };
    }
    const adults = d.adults ?? 1;
    const paxes = [
      ...Array.from({ length: adults }, () => ({ age: 30 })),
      ...(d.childrenAges ?? []).map((age) => ({ age })),
    ];
    const raw = await this.adapter.searchActivities({
      destination: d.destination,
      from: d.dateFrom,
      to: d.dateTo,
      paxes,
    });
    const offers = raw.slice(0, 3).map((o) => ({
      activityCode: String(o.code ?? ''),
      name: String(o.name ?? 'Activity'),
      fromPrice: String(o.amountsFrom?.[0]?.amount ?? '0'),
      currency: String(o.amountsFrom?.[0]?.currency ?? 'EUR'),
    }));
    return { data: { offers } };
  }

  async healthCheck() {
    return { status: 'healthy' as const, agentId: this.id };
  }
}
