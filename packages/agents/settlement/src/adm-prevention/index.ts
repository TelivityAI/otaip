/**
 * ADM Prevention — Agent 6.2
 *
 * Pre-ticketing audit covering fare integrity, passive/UC/churning,
 * married-segment integrity, TTL, and compliance to prevent ADMs.
 *
 * Domain: docs/knowledge-base/adm-prevention.md
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type { ADMPreventionInput, ADMPreventionOutput } from './types.js';
import { runAudit } from './audit-engine.js';

const RECORD_LOCATOR_RE = /^[A-Z0-9]{6}$/;
const PASSENGER_NAME_RE = /^[A-Z][A-Z' -]+\/[A-Z][A-Z' -]+$/;
const CLASS_RE = /^[A-Z]$/;

export class ADMPrevention implements Agent<ADMPreventionInput, ADMPreventionOutput> {
  readonly id = '6.2';
  readonly name = 'ADM Prevention';
  readonly version = '0.2.0';

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(input: AgentInput<ADMPreventionInput>): Promise<AgentOutput<ADMPreventionOutput>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const result = runAudit(input.data);

    const warnings: string[] = [];
    if (result.result.blocking_count > 0) {
      warnings.push(
        `${result.result.blocking_count} blocking issue(s) — ticket MUST NOT be issued.`,
      );
    }
    if (result.result.warning_count > 0) {
      warnings.push(`${result.result.warning_count} warning(s) — review before ticketing.`);
    }

    return {
      data: result,
      confidence: 1.0,
      warnings: warnings.length > 0 ? warnings : undefined,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        record_locator: input.data.booking.record_locator,
        overall_pass: result.result.overall_pass,
        blocking_count: result.result.blocking_count,
        warning_count: result.result.warning_count,
        checks_run: result.result.checks.length,
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

  private validateInput(data: ADMPreventionInput): void {
    if (!data.booking) {
      throw new AgentInputValidationError(this.id, 'booking', 'Booking record required.');
    }
    if (!data.booking.record_locator || !RECORD_LOCATOR_RE.test(data.booking.record_locator)) {
      throw new AgentInputValidationError(
        this.id,
        'record_locator',
        'Must be a 6-character alphanumeric PNR locator.',
      );
    }
    if (!data.booking.passenger_name || !PASSENGER_NAME_RE.test(data.booking.passenger_name)) {
      throw new AgentInputValidationError(
        this.id,
        'passenger_name',
        'Must be in LAST/FIRST format.',
      );
    }
    if (!data.booking.segments || data.booking.segments.length === 0) {
      throw new AgentInputValidationError(this.id, 'segments', 'At least one segment required.');
    }
    if (!data.fare_basis || data.fare_basis.length === 0) {
      throw new AgentInputValidationError(this.id, 'fare_basis', 'Fare basis code required.');
    }
    if (!data.booked_class || !CLASS_RE.test(data.booked_class)) {
      throw new AgentInputValidationError(
        this.id,
        'booked_class',
        'Must be a single uppercase letter.',
      );
    }
  }
}

export { ADM_CHECK_COUNT } from './audit-engine.js';
export {
  CORE_BLOCKING_STATUSES,
  HOST_BLOCKING_STATUSES,
  isBlockingSegmentStatus,
  isCoreBlockingStatus,
  DEFAULT_CHURN_CYCLE_THRESHOLD,
  DEFAULT_CHURN_WINDOW_HOURS,
} from './status-codes.js';

export type {
  ADMPreventionInput,
  ADMPreventionOutput,
  ADMPreventionResult,
  ADMCheck,
  ADMCheckId,
  ADMSeverity,
  BookingRecord,
  BookingSegment,
  DuplicateCheckPnr,
  SegmentHistoryEvent,
  SegmentHistoryAction,
  TtlSource,
  GdsHost,
} from './types.js';
