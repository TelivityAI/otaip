/**
 * Alert — Agent 9.9
 *
 * Queries EventStore events, computes metrics against configurable
 * thresholds, and produces alerts. Read-only — no side effects.
 *
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus, EventStore } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type { AlertInput, AlertOutput } from './types.js';
import { computeAlerts } from './alert-engine.js';

export class AlertAgent
  implements Agent<AlertInput, AlertOutput>
{
  readonly id = '9.9';
  readonly name = 'Alert';
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
    input: AgentInput<AlertInput>,
  ): Promise<AgentOutput<AlertOutput>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const alerts = await computeAlerts(this.store, input.data);

    return {
      data: { alerts },
      confidence: 1.0,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        alert_count: alerts.length,
      },
    };
  }

  async health(): Promise<AgentHealthStatus> {
    if (!this.initialized) {
      return { status: 'unhealthy', details: 'Not initialized. Call initialize() first.' };
    }
    return { status: 'healthy' };
  }

  private validateInput(data: AlertInput): void {
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

export type { AlertInput, AlertOutput, AlertItem, AlertThresholds, AlertSeverityType } from './types.js';
export { DEFAULT_THRESHOLDS } from './types.js';
export { alertContract } from './contract.js';
