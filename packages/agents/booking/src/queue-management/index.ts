/**
 * Queue Management — Agent 3.4
 *
 * GDS queue monitoring and processing — priority assignment,
 * categorization, action routing, and queue command generation.
 *
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type { QueueManagementInput, QueueManagementOutput } from './types.js';
import { processQueue } from './queue-engine.js';

const RECORD_LOCATOR_RE = /^[A-Z0-9]{6}$/;
const VALID_GDS = new Set(['AMADEUS', 'SABRE', 'TRAVELPORT']);
const VALID_TRAVELPORT_HOSTS = new Set(['APOLLO', 'GALILEO', 'WORLDSPAN']);
const VALID_ENTRY_TYPES = new Set([
  'TTL_DEADLINE',
  'SCHEDULE_CHANGE',
  'WAITLIST_CLEAR',
  'INVOLUNTARY_REBOOK',
  'GENERAL',
  'TICKET_REMINDER',
]);

export class QueueManagement implements Agent<QueueManagementInput, QueueManagementOutput> {
  readonly id = '3.4';
  readonly name = 'Queue Management';
  readonly version = '0.1.0';

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<QueueManagementInput>,
  ): Promise<AgentOutput<QueueManagementOutput>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const result = processQueue(input.data);

    const warnings: string[] = [];
    if (result.summary.urgent > 0) {
      warnings.push(`${result.summary.urgent} urgent item(s) require immediate attention.`);
    }
    if (result.summary.high > 0) {
      warnings.push(`${result.summary.high} high-priority item(s).`);
    }

    return {
      data: result,
      confidence: 1.0,
      warnings: warnings.length > 0 ? warnings : undefined,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        total_items: result.summary.total,
        urgent_count: result.summary.urgent,
        high_count: result.summary.high,
        normal_count: result.summary.normal,
        low_count: result.summary.low,
      },
    };
  }

  async health(): Promise<AgentHealthStatus> {
    if (!this.initialized) {
      return { status: 'unhealthy', details: 'Not initialized. Call initialize() first.' };
    }
    return { status: 'healthy' };
  }

  destroy(): void {
    this.initialized = false;
  }

  private validateInput(data: QueueManagementInput): void {
    if (!data.entries || !Array.isArray(data.entries)) {
      throw new AgentInputValidationError(this.id, 'entries', 'Must be an array of queue entries.');
    }
    if (data.entries.length === 0) {
      throw new AgentInputValidationError(this.id, 'entries', 'At least one queue entry required.');
    }

    for (const entry of data.entries) {
      if (!entry.record_locator || !RECORD_LOCATOR_RE.test(entry.record_locator)) {
        throw new AgentInputValidationError(
          this.id,
          'record_locator',
          `Invalid record locator: ${entry.record_locator ?? 'missing'}`,
        );
      }
      if (!entry.gds || !VALID_GDS.has(entry.gds)) {
        throw new AgentInputValidationError(
          this.id,
          'gds',
          `Invalid GDS: ${entry.gds ?? 'missing'}`,
        );
      }
      if (!entry.entry_type || !VALID_ENTRY_TYPES.has(entry.entry_type)) {
        throw new AgentInputValidationError(
          this.id,
          'entry_type',
          `Invalid entry type: ${entry.entry_type ?? 'missing'}`,
        );
      }
      if (entry.queue_number == null || entry.queue_number < 0) {
        throw new AgentInputValidationError(
          this.id,
          'queue_number',
          'Queue number must be a non-negative integer.',
        );
      }
    }

    if (data.gds && !VALID_GDS.has(data.gds)) {
      throw new AgentInputValidationError(this.id, 'gds', `Invalid GDS for commands: ${data.gds}`);
    }

    if (data.travelport_host != null && !VALID_TRAVELPORT_HOSTS.has(data.travelport_host)) {
      throw new AgentInputValidationError(
        this.id,
        'travelport_host',
        `Invalid Travelport host: ${data.travelport_host}`,
      );
    }
  }
}

export type {
  QueueManagementInput,
  QueueManagementOutput,
  QueueEntry,
  QueueProcessingResult,
  QueueCommand,
  QueueEntryType,
  QueuePriority,
  QueueItemStatus,
  QueueGdsSystem,
  TravelportHost,
  QueueAction,
} from './types.js';
