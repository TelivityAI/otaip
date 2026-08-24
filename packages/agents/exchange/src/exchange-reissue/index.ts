/**
 * Exchange/Reissue — Agent 5.2
 *
 * Ticket reissue with residual value, tax carryforward,
 * GDS exchange command stubs, conjunction ticket handling.
 *
 * Residual method required — never invent original − change fee
 * (docs/knowledge-base/partial-refund-residual-value.md, issue #150).
 *
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import {
  AgentNotInitializedError,
  AgentInputValidationError,
  isDomainInputRequired,
} from '@otaip/core';
import type { ExchangeReissueInput, ExchangeReissueResult } from './types.js';
import { processReissue } from './reissue-engine.js';

const TICKET_NUMBER_RE = /^\d{13}$/;
const CARRIER_RE = /^[A-Z0-9]{2}$/;
const AIRPORT_RE = /^[A-Z]{3}$/;
const PASSENGER_NAME_RE = /^[A-Z][A-Z' -]+\/[A-Z][A-Z' -]+$/;
const RECORD_LOCATOR_RE = /^[A-Z0-9]{6}$/;
const VALID_GDS = new Set(['AMADEUS', 'SABRE', 'TRAVELPORT']);
const VALID_RESIDUAL_METHODS = new Set(['FULLY_UNUSED', 'PUBLISHED_FARE', 'CARRIER_SPECIFIC']);

export class ExchangeReissue implements Agent<ExchangeReissueInput, ExchangeReissueResult> {
  readonly id = '5.2';
  readonly name = 'Exchange/Reissue';
  readonly version = '0.1.0';

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<ExchangeReissueInput>,
  ): Promise<AgentOutput<ExchangeReissueResult>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const result = processReissue(input.data);

    if (isDomainInputRequired(result)) {
      return {
        data: result,
        confidence: 0,
        warnings: [
          `DOMAIN_INPUT_REQUIRED: ${result.description}`,
          ...result.missing.map((m) => `missing: ${m}`),
        ],
        metadata: {
          agent_id: this.id,
          agent_version: this.version,
          original_ticket: input.data.original_ticket_number,
          status: 'DOMAIN_INPUT_REQUIRED',
        },
      };
    }

    const warnings: string[] = [];
    if (result.credit_amount !== '0.00') {
      warnings.push(
        `Credit of ${input.data.new_fare_currency} ${result.credit_amount} due to passenger (residual exceeds new fare).`,
      );
    }
    if (input.data.conjunction_originals && input.data.conjunction_originals.length > 0) {
      warnings.push(
        `Conjunction exchange: ${input.data.conjunction_originals.length + 1} original tickets referenced.`,
      );
    }

    return {
      data: result,
      confidence: 1.0,
      warnings: warnings.length > 0 ? warnings : undefined,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        original_ticket: input.data.original_ticket_number,
        new_ticket: result.reissue.ticket_number,
        additional_collection: result.additional_collection,
        credit_amount: result.credit_amount,
        residual_method: result.reissue.exchange_audit.residual_method,
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

  private validateInput(data: ExchangeReissueInput): void {
    if (!data.original_ticket_number || !TICKET_NUMBER_RE.test(data.original_ticket_number)) {
      throw new AgentInputValidationError(
        this.id,
        'original_ticket_number',
        'Must be a 13-digit ticket number.',
      );
    }
    if (!data.issuing_carrier || !CARRIER_RE.test(data.issuing_carrier)) {
      throw new AgentInputValidationError(
        this.id,
        'issuing_carrier',
        'Must be a 2-character IATA carrier code.',
      );
    }
    if (!data.passenger_name || !PASSENGER_NAME_RE.test(data.passenger_name)) {
      throw new AgentInputValidationError(
        this.id,
        'passenger_name',
        'Must be in LAST/FIRST format.',
      );
    }
    if (!data.record_locator || !RECORD_LOCATOR_RE.test(data.record_locator)) {
      throw new AgentInputValidationError(
        this.id,
        'record_locator',
        'Must be a 6-character alphanumeric PNR locator.',
      );
    }
    if (!data.new_segments || data.new_segments.length === 0) {
      throw new AgentInputValidationError(
        this.id,
        'new_segments',
        'At least one new segment required.',
      );
    }
    for (const seg of data.new_segments) {
      if (!CARRIER_RE.test(seg.carrier)) {
        throw new AgentInputValidationError(
          this.id,
          'segment.carrier',
          `Invalid carrier: ${seg.carrier}`,
        );
      }
      if (!AIRPORT_RE.test(seg.origin) || !AIRPORT_RE.test(seg.destination)) {
        throw new AgentInputValidationError(
          this.id,
          'segment.origin/destination',
          'Invalid airport code.',
        );
      }
    }
    if (!data.new_fare || isNaN(Number(data.new_fare))) {
      throw new AgentInputValidationError(this.id, 'new_fare', 'Must be a valid decimal string.');
    }
    if (!data.form_of_payment) {
      throw new AgentInputValidationError(this.id, 'form_of_payment', 'Form of payment required.');
    }
    if (data.gds && !VALID_GDS.has(data.gds)) {
      throw new AgentInputValidationError(this.id, 'gds', `Invalid GDS: ${data.gds}`);
    }
    if (!data.residual_method || !VALID_RESIDUAL_METHODS.has(data.residual_method)) {
      throw new AgentInputValidationError(
        this.id,
        'residual_method',
        'Must be FULLY_UNUSED, PUBLISHED_FARE, or CARRIER_SPECIFIC. original−change-fee / MPA-P / coupon-ratio are rejected.',
      );
    }
    if (!data.residual_value || isNaN(Number(data.residual_value))) {
      throw new AgentInputValidationError(
        this.id,
        'residual_value',
        'Must be a valid decimal string.',
      );
    }
    if (data.conjunction_originals) {
      for (const ct of data.conjunction_originals) {
        if (!TICKET_NUMBER_RE.test(ct)) {
          throw new AgentInputValidationError(
            this.id,
            'conjunction_originals',
            `Invalid conjunction ticket number: ${ct}`,
          );
        }
      }
    }
  }
}

export type {
  ExchangeReissueInput,
  ExchangeReissueOutput,
  ExchangeReissueResult,
  ReissueRecord,
  ReissuedCoupon,
  ExchangeAuditTrail,
  ExchangeCommand,
  ExchangeGdsSystem,
  ExchangeSegment,
  TaxItem,
  FormOfPayment,
} from './types.js';
