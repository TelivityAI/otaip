/**
 * Change Management — Agent 5.1
 *
 * ATPCO Category 31 voluntary change assessment: change fees,
 * fare difference, residual value, waiver codes.
 *
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type { ChangeManagementInput, ChangeManagementOutput } from './types.js';
import { assessChange } from './change-engine.js';

const TICKET_NUMBER_RE = /^\d{13}$/;
const CARRIER_RE = /^[A-Z0-9]{2}$/;
const PASSENGER_NAME_RE = /^[A-Z][A-Z' -]+\/[A-Z][A-Z' -]+$/;
const RECORD_LOCATOR_RE = /^[A-Z0-9]{6}$/;

export class ChangeManagement implements Agent<ChangeManagementInput, ChangeManagementOutput> {
  readonly id = '5.1';
  readonly name = 'Change Management';
  readonly version = '0.1.0';

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<ChangeManagementInput>,
  ): Promise<AgentOutput<ChangeManagementOutput>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const result = assessChange(input.data);

    const warnings: string[] = [];
    if (result.assessment.action === 'REJECT') {
      warnings.push('Change not permitted for this fare type.');
    }
    if (result.assessment.forfeited_amount !== '0.00') {
      warnings.push(
        `Fare difference forfeited: ${result.assessment.currency} ${result.assessment.forfeited_amount} (non-refundable fare downgrade).`,
      );
    }

    return {
      data: result,
      confidence: 1.0,
      warnings: warnings.length > 0 ? warnings : undefined,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        original_ticket: input.data.original_ticket.ticket_number,
        action: result.assessment.action,
        total_due: result.assessment.total_due,
        fee_waived: result.assessment.fee_waived,
        us_dot_24h_eligible: result.us_dot_24h.eligible,
        us_dot_24h_remedy: result.us_dot_24h.carrier_remedy,
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

  private validateInput(data: ChangeManagementInput): void {
    const ot = data.original_ticket;
    if (!ot.ticket_number || !TICKET_NUMBER_RE.test(ot.ticket_number)) {
      throw new AgentInputValidationError(
        this.id,
        'ticket_number',
        'Must be a 13-digit ticket number.',
      );
    }
    if (!ot.issuing_carrier || !CARRIER_RE.test(ot.issuing_carrier)) {
      throw new AgentInputValidationError(
        this.id,
        'issuing_carrier',
        'Must be a 2-character IATA carrier code.',
      );
    }
    if (!ot.passenger_name || !PASSENGER_NAME_RE.test(ot.passenger_name)) {
      throw new AgentInputValidationError(
        this.id,
        'passenger_name',
        'Must be in LAST/FIRST format.',
      );
    }
    if (!ot.record_locator || !RECORD_LOCATOR_RE.test(ot.record_locator)) {
      throw new AgentInputValidationError(
        this.id,
        'record_locator',
        'Must be a 6-character alphanumeric PNR locator.',
      );
    }
    if (!ot.base_fare || isNaN(Number(ot.base_fare))) {
      throw new AgentInputValidationError(this.id, 'base_fare', 'Must be a valid decimal string.');
    }

    const ri = data.requested_itinerary;
    if (!ri.segments || ri.segments.length === 0) {
      throw new AgentInputValidationError(
        this.id,
        'segments',
        'At least one segment required in requested itinerary.',
      );
    }
    if (!ri.new_fare || isNaN(Number(ri.new_fare))) {
      throw new AgentInputValidationError(this.id, 'new_fare', 'Must be a valid decimal string.');
    }
  }
}

export type {
  ChangeManagementInput,
  ChangeManagementOutput,
  ChangeAssessment,
  OriginalTicketSummary,
  RequestedItinerary,
  ChangeFeeRule,
  ChangeAction,
  UsDot24HourRemedy,
  UsDot24HourBookingChannel,
  UsDot24HourIneligibilityReason,
  UsDot24HourEntitlement,
  UsDot24HourContext,
  UsDot24HourAssessment,
  UsDot24HourCarrierRemedyRow,
  Cat31Rules,
} from './types.js';
