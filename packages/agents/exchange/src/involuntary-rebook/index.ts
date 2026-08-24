/**
 * Involuntary Rebook — Agent 5.3
 *
 * Carrier-initiated schedule change handling: trigger assessment,
 * reprotection candidates (not silent same-carrier rebook), regulatory
 * entitlements (EU261 Art.3/7/8, US DOT IDB oversales-only).
 *
 * Domain: docs/knowledge-base/involuntary-rebook-irrop.md
 * EU261: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32004R0261
 *
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type { InvoluntaryRebookInput, InvoluntaryRebookOutput } from './types.js';
import { processInvoluntaryRebook } from './rebook-engine.js';

const RECORD_LOCATOR_RE = /^[A-Z0-9]{6}$/;
const CARRIER_RE = /^[A-Z0-9]{2}$/;
const AIRPORT_RE = /^[A-Z]{3}$/;
const PASSENGER_NAME_RE = /^[A-Z][A-Z' -]+\/[A-Z][A-Z' -]+$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const VALID_CHANGE_TYPES = new Set([
  'TIME_CHANGE',
  'ROUTING_CHANGE',
  'EQUIPMENT_DOWNGRADE',
  'FLIGHT_CANCELLATION',
  'MISCONNECT',
]);

export class InvoluntaryRebook implements Agent<InvoluntaryRebookInput, InvoluntaryRebookOutput> {
  readonly id = '5.3';
  readonly name = 'Involuntary Rebook';
  readonly version = '0.1.0';

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<InvoluntaryRebookInput>,
  ): Promise<AgentOutput<InvoluntaryRebookOutput>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const engineOutput = processInvoluntaryRebook(input.data);
    const result = { result: engineOutput.result };

    const warnings: string[] = [...(engineOutput.warnings ?? [])];
    if (result.result.is_involuntary) {
      warnings.push(`Involuntary change detected: ${result.result.trigger}.`);
      for (const flag of result.result.regulatory_flags) {
        if (flag.applies) {
          warnings.push(`${flag.framework} regulatory entitlement applies.`);
        }
      }
      if (result.result.art8_passenger_choice_required) {
        warnings.push(
          'EU261 Art.8 passenger choice required before executing reprotection.',
        );
      }
    }
    if (result.result.is_no_show) {
      warnings.push('Passenger no-show detected — different rules apply.');
    }

    return {
      data: result,
      confidence: 1.0,
      warnings: warnings.length > 0 ? warnings : undefined,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        record_locator: input.data.original_pnr.record_locator,
        is_involuntary: result.result.is_involuntary,
        trigger: result.result.trigger,
        protection_path: result.result.protection_path,
        original_routing_credit: result.result.original_routing_credit,
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

  private validateInput(data: InvoluntaryRebookInput): void {
    const pnr = data.original_pnr;
    if (!pnr.record_locator || !RECORD_LOCATOR_RE.test(pnr.record_locator)) {
      throw new AgentInputValidationError(
        this.id,
        'record_locator',
        'Must be a 6-character alphanumeric PNR locator.',
      );
    }
    if (!pnr.passenger_name || !PASSENGER_NAME_RE.test(pnr.passenger_name)) {
      throw new AgentInputValidationError(
        this.id,
        'passenger_name',
        'Must be in LAST/FIRST format.',
      );
    }
    const seg = pnr.affected_segment;
    if (!seg.carrier || !CARRIER_RE.test(seg.carrier)) {
      throw new AgentInputValidationError(
        this.id,
        'carrier',
        'Must be a 2-character IATA carrier code.',
      );
    }
    if (!AIRPORT_RE.test(seg.origin) || !AIRPORT_RE.test(seg.destination)) {
      throw new AgentInputValidationError(
        this.id,
        'origin/destination',
        'Must be 3-letter IATA airport codes.',
      );
    }
    if (!pnr.departure_country || !COUNTRY_RE.test(pnr.departure_country)) {
      throw new AgentInputValidationError(
        this.id,
        'departure_country',
        'Must be ISO 2-letter country code.',
      );
    }
    if (!pnr.arrival_country || !COUNTRY_RE.test(pnr.arrival_country)) {
      throw new AgentInputValidationError(
        this.id,
        'arrival_country',
        'Must be ISO 2-letter country code.',
      );
    }

    const sc = data.schedule_change;
    if (!sc.change_type || !VALID_CHANGE_TYPES.has(sc.change_type)) {
      throw new AgentInputValidationError(
        this.id,
        'change_type',
        `Must be one of: ${[...VALID_CHANGE_TYPES].join(', ')}`,
      );
    }
  }
}

export type {
  InvoluntaryRebookInput,
  InvoluntaryRebookOutput,
  InvoluntaryRebookResult,
  InvoluntaryTrigger,
  IrropMeasurementPoint,
  ProtectionPath,
  ProtectionFlightOption,
  ProtectionOption,
  RegulatoryFlag,
  RegulatoryFramework,
  Art8Choice,
  ScheduleChangeNotification,
  OriginalPnrSummary,
} from './types.js';
