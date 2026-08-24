/**
 * Refund Processing — Agent 6.1
 *
 * ATPCO Category 33 refund processing: penalty application,
 * commission recall, BSP/ARC reporting, conjunction ticket handling.
 *
 * Partial residual: Cat 33 + THB — see
 * docs/knowledge-base/partial-refund-residual-value.md (issue #150).
 *
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import {
  AgentNotInitializedError,
  AgentInputValidationError,
  isDomainInputRequired,
} from '@otaip/core';
import type { RefundProcessingInput, RefundProcessingResult } from './types.js';
import { processRefund } from './refund-engine.js';

const TICKET_NUMBER_RE = /^\d{13}$/;
const CARRIER_RE = /^[A-Z0-9]{2}$/;
const PASSENGER_NAME_RE = /^[A-Z][A-Z' -]+\/[A-Z][A-Z' -]+$/;
const RECORD_LOCATOR_RE = /^[A-Z0-9]{6}$/;
const VALID_REFUND_TYPES = new Set(['FULL', 'PARTIAL', 'TAX_ONLY']);
const VALID_SETTLEMENT = new Set(['BSP', 'ARC']);
const VALID_PARTIAL_METHODS = new Set(['CAT33_THB', 'CARRIER_SPECIFIC']);

export class RefundProcessing implements Agent<RefundProcessingInput, RefundProcessingResult> {
  readonly id = '6.1';
  readonly name = 'Refund Processing';
  readonly version = '0.1.0';

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<RefundProcessingInput>,
  ): Promise<AgentOutput<RefundProcessingResult>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const result = processRefund(input.data);

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
          ticket_number: input.data.ticket_number,
          refund_type: input.data.refund_type,
          status: 'DOMAIN_INPUT_REQUIRED',
        },
      };
    }

    const warnings: string[] = [];
    if (result.refund.penalty_applied !== '0.00') {
      warnings.push(
        `Penalty of ${input.data.base_fare_currency} ${result.refund.penalty_applied} applied.`,
      );
    }
    if (result.commission_recalled !== '0.00') {
      warnings.push(
        `Commission recall: ${input.data.base_fare_currency} ${result.commission_recalled}.`,
      );
    }
    if (input.data.refund_type === 'TAX_ONLY') {
      warnings.push('Tax-only refund — base fare forfeited.');
    }
    if (input.data.conjunction_tickets && input.data.conjunction_tickets.length > 0) {
      warnings.push(
        `Conjunction refund: ${input.data.conjunction_tickets.length + 1} tickets in set.`,
      );
    }

    return {
      data: result,
      confidence: 1.0,
      warnings: warnings.length > 0 ? warnings : undefined,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        ticket_number: input.data.ticket_number,
        refund_type: input.data.refund_type,
        net_refund: result.net_refund_amount,
        penalty: result.refund.penalty_applied,
        settlement_system: input.data.settlement_system,
        residual_method: result.refund.audit.residual_method,
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

  private validateInput(data: RefundProcessingInput): void {
    if (!data.ticket_number || !TICKET_NUMBER_RE.test(data.ticket_number)) {
      throw new AgentInputValidationError(
        this.id,
        'ticket_number',
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
    if (!data.refund_type || !VALID_REFUND_TYPES.has(data.refund_type)) {
      throw new AgentInputValidationError(
        this.id,
        'refund_type',
        'Must be FULL, PARTIAL, or TAX_ONLY.',
      );
    }
    if (!data.settlement_system || !VALID_SETTLEMENT.has(data.settlement_system)) {
      throw new AgentInputValidationError(this.id, 'settlement_system', 'Must be BSP or ARC.');
    }
    if (!data.base_fare || isNaN(Number(data.base_fare))) {
      throw new AgentInputValidationError(this.id, 'base_fare', 'Must be a valid decimal string.');
    }
    if (
      data.refund_type === 'PARTIAL' &&
      (!data.coupons_to_refund || data.coupons_to_refund.length === 0)
    ) {
      throw new AgentInputValidationError(
        this.id,
        'coupons_to_refund',
        'Required for PARTIAL refund.',
      );
    }
    if (data.partial_valuation) {
      const v = data.partial_valuation;
      if (!VALID_PARTIAL_METHODS.has(v.method)) {
        throw new AgentInputValidationError(
          this.id,
          'partial_valuation.method',
          'Must be CAT33_THB or CARRIER_SPECIFIC. MPA-P / original−used / coupon-ratio are rejected.',
        );
      }
      if (!v.unused_base_fare || isNaN(Number(v.unused_base_fare))) {
        throw new AgentInputValidationError(
          this.id,
          'partial_valuation.unused_base_fare',
          'Must be a valid decimal string.',
        );
      }
      if (!v.unused_taxes || !Array.isArray(v.unused_taxes)) {
        throw new AgentInputValidationError(
          this.id,
          'partial_valuation.unused_taxes',
          'Unused tax breakdown is required (no coupon-ratio tax invention).',
        );
      }
    }
    if (data.conjunction_tickets) {
      for (const ct of data.conjunction_tickets) {
        if (!TICKET_NUMBER_RE.test(ct)) {
          throw new AgentInputValidationError(
            this.id,
            'conjunction_tickets',
            `Invalid conjunction ticket: ${ct}`,
          );
        }
      }
      if (data.refund_type === 'PARTIAL') {
        throw new AgentInputValidationError(
          this.id,
          'refund_type',
          'Partial refund not allowed for conjunction ticket sets — must refund all or none.',
        );
      }
    }
  }
}

export type {
  RefundProcessingInput,
  RefundProcessingOutput,
  RefundProcessingResult,
  RefundRecord,
  RefundAuditTrail,
  RefundType,
  SettlementSystem,
  CommissionType,
  CommissionData,
  TaxItem,
  CouponRefundItem,
  BspRefundFields,
  ArcRefundFields,
  RefundPenaltyRule,
} from './types.js';
