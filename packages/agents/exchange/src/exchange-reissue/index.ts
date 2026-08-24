/**
 * Exchange/Reissue — Agent 5.2
 *
 * Ticket reissue with residual value, tax carryforward,
 * GDS exchange command stubs, conjunction ticket handling.
 *
 * Tax carryforward is per-tax CARRY | RECALCULATE | FORFEIT.
 * Same O&D alone is insufficient. See docs/knowledge-base/tax-carryforward-reissue.md
 *
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type { ExchangeReissueInput, ExchangeReissueOutput } from './types.js';
import { processReissue } from './reissue-engine.js';
import {
  TaxCarryforwardRuleMissingError,
  collectTaxCodes,
  indexRulesByCode,
} from './tax-carryforward.js';

const TICKET_NUMBER_RE = /^\d{13}$/;
const CARRIER_RE = /^[A-Z0-9]{2}$/;
const AIRPORT_RE = /^[A-Z]{3}$/;
const PASSENGER_NAME_RE = /^[A-Z][A-Z' -]+\/[A-Z][A-Z' -]+$/;
const RECORD_LOCATOR_RE = /^[A-Z0-9]{6}$/;
const VALID_GDS = new Set(['AMADEUS', 'SABRE', 'TRAVELPORT']);
const VALID_GEOGRAPHY = new Set(['SAME_AIRPORT', 'SAME_CITY', 'DIFFERENT']);
const VALID_FLOWN = new Set(['UNFLOWN', 'PARTIALLY_FLOWN', 'FULLY_FLOWN']);
const VALID_NATURE = new Set(['TRANSPORT', 'SALES']);
const VALID_MIN_GEO = new Set(['SAME_AIRPORT', 'SAME_CITY']);
const VALID_EXPIRED_ACTION = new Set(['RECALCULATE', 'FORFEIT']);

export class ExchangeReissue implements Agent<ExchangeReissueInput, ExchangeReissueOutput> {
  readonly id = '5.2';
  readonly name = 'Exchange/Reissue';
  readonly version = '0.2.0';

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<ExchangeReissueInput>,
  ): Promise<AgentOutput<ExchangeReissueOutput>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    let result: ExchangeReissueOutput;
    try {
      result = processReissue(input.data);
    } catch (err) {
      if (err instanceof TaxCarryforwardRuleMissingError) {
        throw new AgentInputValidationError(
          this.id,
          'tax_carryforward_rules',
          err.message,
        );
      }
      throw err;
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
    if (input.data.same_origin_destination !== undefined) {
      warnings.push(
        'same_origin_destination is deprecated and ignored for tax carryforward; decisions use tax_carryforward_context + per-code rules (same O&D ≠ keep all TFCs).',
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
        tax_decision_count: result.tax_decisions.length,
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

    this.validateTaxCarryforward(data);
  }

  private validateTaxCarryforward(data: ExchangeReissueInput): void {
    if (!data.tax_carryforward_context) {
      throw new AgentInputValidationError(
        this.id,
        'tax_carryforward_context',
        'Required. Same O&D boolean alone is insufficient for TFC carryforward (see docs/knowledge-base/tax-carryforward-reissue.md).',
      );
    }
    const ctx = data.tax_carryforward_context;
    if (!VALID_GEOGRAPHY.has(ctx.geography_match)) {
      throw new AgentInputValidationError(
        this.id,
        'tax_carryforward_context.geography_match',
        'Must be SAME_AIRPORT, SAME_CITY, or DIFFERENT.',
      );
    }
    if (!VALID_FLOWN.has(ctx.flown_status)) {
      throw new AgentInputValidationError(
        this.id,
        'tax_carryforward_context.flown_status',
        'Must be UNFLOWN, PARTIALLY_FLOWN, or FULLY_FLOWN.',
      );
    }
    if (typeof ctx.within_validity_window !== 'boolean') {
      throw new AgentInputValidationError(
        this.id,
        'tax_carryforward_context.within_validity_window',
        'Must be a boolean (caller evaluates published windows; engine does not invent dates).',
      );
    }
    if (typeof ctx.point_of_sale_unchanged !== 'boolean') {
      throw new AgentInputValidationError(
        this.id,
        'tax_carryforward_context.point_of_sale_unchanged',
        'Must be a boolean (sales vs transport reassessment).',
      );
    }

    if (!data.tax_carryforward_rules || !Array.isArray(data.tax_carryforward_rules)) {
      throw new AgentInputValidationError(
        this.id,
        'tax_carryforward_rules',
        'Required. Provide a per-code rule for every tax on original ∪ new tickets. Fail closed when unknown.',
      );
    }

    for (const rule of data.tax_carryforward_rules) {
      if (!rule.tax_code || typeof rule.tax_code !== 'string') {
        throw new AgentInputValidationError(
          this.id,
          'tax_carryforward_rules.tax_code',
          'Each rule requires a tax_code.',
        );
      }
      if (!VALID_NATURE.has(rule.nature)) {
        throw new AgentInputValidationError(
          this.id,
          'tax_carryforward_rules.nature',
          `Invalid nature for ${rule.tax_code}: must be TRANSPORT or SALES.`,
        );
      }
      if (!VALID_MIN_GEO.has(rule.min_geography)) {
        throw new AgentInputValidationError(
          this.id,
          'tax_carryforward_rules.min_geography',
          `Invalid min_geography for ${rule.tax_code}.`,
        );
      }
      if (!VALID_EXPIRED_ACTION.has(rule.on_validity_expired)) {
        throw new AgentInputValidationError(
          this.id,
          'tax_carryforward_rules.on_validity_expired',
          `Must be RECALCULATE or FORFEIT for ${rule.tax_code}.`,
        );
      }
    }

    // Fail closed: every code on the ticket set must have a rule
    const ruleMap = indexRulesByCode(data.tax_carryforward_rules);
    const codes = collectTaxCodes(data.original_taxes ?? [], data.new_taxes ?? []);
    for (const code of codes) {
      if (!ruleMap.has(code)) {
        throw new AgentInputValidationError(
          this.id,
          'tax_carryforward_rules',
          `No tax carryforward rule for code ${code}. Fail closed — do not assume CARRY from same O&D. Supply a rule from TTBS/ATPCO/SITA.`,
        );
      }
    }
  }
}

export type {
  ExchangeReissueInput,
  ExchangeReissueOutput,
  ReissueRecord,
  ReissuedCoupon,
  ExchangeAuditTrail,
  ExchangeCommand,
  ExchangeGdsSystem,
  ExchangeSegment,
  TaxItem,
  FormOfPayment,
  TaxCarryforwardAction,
  TaxCarryforwardDecision,
  TaxCarryforwardContext,
  TaxCarryforwardRule,
  TaxGeographyMatch,
  TaxItineraryFlownStatus,
  TaxNature,
} from './types.js';

export {
  decideTaxCarryforward,
  decideAllTaxCarryforwards,
  CARRIER_IMPOSED_SURCHARGE_CODES,
  TaxCarryforwardRuleMissingError,
} from './tax-carryforward.js';
