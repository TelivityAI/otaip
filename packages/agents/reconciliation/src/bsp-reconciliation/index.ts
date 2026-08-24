/**
 * BSP Reconciliation — Agent 7.1
 *
 * Matches agency booking records against BSP HOT files,
 * validates commission, identifies discrepancies, flags issues
 * before remittance deadline.
 *
 * Domain: docs/knowledge-base/bsp-hot-reconciliation.md (DISH Rev 23).
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type { BSPReconciliationInput, BSPReconciliationOutput } from './types.js';
import { matchRecords } from './reconciliation-matcher.js';

const TICKET_NUMBER_RE = /^\d{13}$/;
const CARRIER_RE = /^[A-Z0-9]{2}$/;

export class BSPReconciliation implements Agent<BSPReconciliationInput, BSPReconciliationOutput> {
  readonly id = '7.1';
  readonly name = 'BSP Reconciliation';
  readonly version = '0.2.0';

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<BSPReconciliationInput>,
  ): Promise<AgentOutput<BSPReconciliationOutput>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const result = matchRecords(input.data);

    const warnings: string[] = [];
    if (result.summary.critical_count > 0) {
      warnings.push(
        `${result.summary.critical_count} critical discrepancies found — review before remittance.`,
      );
    }
    if (result.summary.patterns.length > 0) {
      warnings.push(`${result.summary.patterns.length} recurring pattern(s) detected.`);
    }
    if (result.summary.currencies_present.length > 1) {
      warnings.push(
        `Multi-currency HOT: transaction CUTP values [${result.summary.currencies_present.join(', ')}]. ` +
          `Do not assume single-currency; IROE≠ICER — amounts compared only within matching CUTP.`,
      );
    }
    if (input.data.remittance_deadline) {
      const now = input.data.current_datetime ? new Date(input.data.current_datetime) : new Date();
      const deadline = new Date(input.data.remittance_deadline);
      const hoursUntil = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
      if (hoursUntil < 48 && hoursUntil > 0) {
        warnings.push(
          `Remittance deadline in ${Math.round(hoursUntil)} hours — resolve discrepancies urgently.`,
        );
      }
    }
    // TODO: DOMAIN_QUESTION: DQ-HOT-1 — market remittance calendar / grace not hardcoded

    return {
      data: result,
      confidence: 1.0,
      warnings: warnings.length > 0 ? warnings : undefined,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        billing_period: input.data.billing_period,
        total_agency: result.summary.total_agency_records,
        total_hot: result.summary.total_hot_records,
        matched: result.summary.matched_count,
        discrepancies: result.summary.discrepancy_count,
        currencies_present: result.summary.currencies_present,
        passed: result.passed,
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

  private validateInput(data: BSPReconciliationInput): void {
    if (!data.agency_records || !Array.isArray(data.agency_records)) {
      throw new AgentInputValidationError(
        this.id,
        'agency_records',
        'Must be an array of agency records.',
      );
    }
    if (!data.hot_records || !Array.isArray(data.hot_records)) {
      throw new AgentInputValidationError(
        this.id,
        'hot_records',
        'Must be an array of HOT file records.',
      );
    }
    if (!data.billing_period || data.billing_period.trim().length === 0) {
      throw new AgentInputValidationError(this.id, 'billing_period', 'Billing period required.');
    }

    for (const ar of data.agency_records) {
      if (!ar.ticket_number || !TICKET_NUMBER_RE.test(ar.ticket_number)) {
        throw new AgentInputValidationError(
          this.id,
          'agency_records.ticket_number',
          `Invalid ticket number: ${ar.ticket_number ?? 'missing'}`,
        );
      }
      if (!ar.airline_code || !CARRIER_RE.test(ar.airline_code)) {
        throw new AgentInputValidationError(
          this.id,
          'agency_records.airline_code',
          `Invalid airline code: ${ar.airline_code ?? 'missing'}`,
        );
      }
      if (ar.original_ticket_number && !TICKET_NUMBER_RE.test(ar.original_ticket_number)) {
        throw new AgentInputValidationError(
          this.id,
          'agency_records.original_ticket_number',
          `Invalid original ticket number: ${ar.original_ticket_number}`,
        );
      }
      if (ar.conjunction_ticket_numbers) {
        for (const ct of ar.conjunction_ticket_numbers) {
          if (!TICKET_NUMBER_RE.test(ct)) {
            throw new AgentInputValidationError(
              this.id,
              'agency_records.conjunction_ticket_numbers',
              `Invalid conjunction ticket number: ${ct}`,
            );
          }
        }
      }
    }

    for (const hot of data.hot_records) {
      if (!hot.ticket_number || !TICKET_NUMBER_RE.test(hot.ticket_number)) {
        throw new AgentInputValidationError(
          this.id,
          'hot_records.ticket_number',
          `Invalid ticket number: ${hot.ticket_number ?? 'missing'}`,
        );
      }
    }
  }
}

export { HOTFileParser } from './hot-file-parser.js';

export type {
  BSPReconciliationInput,
  BSPReconciliationOutput,
  HOTFileRecord,
  HOTFileFormat,
  HOTTransactionType,
  DishTransactionCode,
  RelatedDocumentRef,
  AgencyRecord,
  Discrepancy,
  DiscrepancyType,
  DiscrepancySeverity,
  PatternDetection,
  ReconciliationSummary,
} from './types.js';
