/**
 * Routing Audit — Agent 9.7
 *
 * Analyses routing decisions and outcomes from the EventStore within a
 * given time window. Read-only — no side effects.
 *
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus, EventStore } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type { RoutingAuditInput, RoutingAuditOutput } from './types.js';
import { computeRoutingReport } from './audit-engine.js';

export class RoutingAuditAgent
  implements Agent<RoutingAuditInput, RoutingAuditOutput>
{
  readonly id = '9.7';
  readonly name = 'Routing Audit';
  readonly version = '0.1.0';

  private initialized = false;
  private readonly store: EventStore;

  constructor(store: EventStore) {
    this.store = store;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<RoutingAuditInput>,
  ): Promise<AgentOutput<RoutingAuditOutput>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const report = await computeRoutingReport(this.store, input.data);

    return {
      data: { report },
      confidence: 1.0,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        time_window: input.data.time_window,
      },
    };
  }

  async health(): Promise<AgentHealthStatus> {
    if (!this.initialized) {
      return { status: 'unhealthy', details: 'Not initialized. Call initialize() first.' };
    }
    return { status: 'healthy' };
  }

  private validateInput(data: RoutingAuditInput): void {
    if (!data.time_window) {
      throw new AgentInputValidationError(this.id, 'time_window', 'Required object with from/to ISO strings.');
    }
    if (!data.time_window.from || !data.time_window.to) {
      throw new AgentInputValidationError(this.id, 'time_window', 'Both from and to are required.');
    }
    if (data.time_window.from >= data.time_window.to) {
      throw new AgentInputValidationError(this.id, 'time_window', '"from" must precede "to".');
    }
  }
}

export type { RoutingAuditInput, RoutingAuditOutput, RoutingReport, ChannelStats } from './types.js';
export { routingAuditContract } from './contract.js';
