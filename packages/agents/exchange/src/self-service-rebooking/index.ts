/**
 * Self-Service Rebooking — Agent 5.5
 *
 * Orchestrates AvailabilitySearch (1.1) + ChangeManagement (5.1)
 * to present priced rebooking alternatives. Does NOT execute the
 * reissue — that's the job of ExchangeReissue (5.2).
 *
 * Cost formula per alternative:
 *   totalCost = changeFee + fareDifference + taxDifference
 *
 * Involuntary reasons (schedule_change / missed_connection /
 * cancellation) waive the change fee regardless of ATPCO Cat 31
 * rules. Voluntary changes honor Cat 31 via ChangeManagement.
 */

import Decimal from 'decimal.js';
import type { Agent, AgentHealthStatus, AgentInput, AgentOutput, SearchOffer } from '@otaip/core';
import {
  AgentInputValidationError,
  AgentNotInitializedError,
  isDomainInputRequired,
} from '@otaip/core';
import { AvailabilitySearch } from '@otaip/agents-search';
import type { AvailabilitySearchInput } from '@otaip/agents-search';
import { ChangeManagement } from '../change-management/index.js';
import type { ChangeFeeRule, RequestedItinerary } from '../change-management/types.js';
import {
  applyInvoluntaryWaiver,
  computeDifferences,
  computeTotalCost,
  isInvoluntary,
} from './pricing.js';
import type {
  OriginalFarePolicy,
  RebookingAlternative,
  RebookingInput,
  RebookingOutput,
} from './types.js';

const IATA_RE = /^[A-Z]{3}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SelfServiceRebookingAgentOptions {
  /** Injected search agent. Required. */
  availabilitySearch: AvailabilitySearch;
  /** Injected change-management agent. Required. */
  changeManagement: ChangeManagement;
  /**
   * Optional fee-rule resolver for the original fare. When provided,
   * the returned `originalFarePolicy.changeFeeRule` is populated for
   * reference. Not called when reason is involuntary.
   */
  feeRuleResolver?: (fareBasis: string) => ChangeFeeRule | undefined;
}

export class SelfServiceRebookingAgent
  implements Agent<RebookingInput, RebookingOutput>
{
  readonly id = '5.5';
  readonly name = 'Self-Service Rebooking';
  readonly version = '0.2.0';

  private initialized = false;
  private readonly search: AvailabilitySearch;
  private readonly change: ChangeManagement;
  private readonly feeRuleResolver?: (fareBasis: string) => ChangeFeeRule | undefined;

  constructor(options: SelfServiceRebookingAgentOptions) {
    this.search = options.availabilitySearch;
    this.change = options.changeManagement;
    if (options.feeRuleResolver !== undefined) {
      this.feeRuleResolver = options.feeRuleResolver;
    }
  }

  async initialize(): Promise<void> {
    await this.search.initialize();
    await this.change.initialize();
    this.initialized = true;
  }

  async execute(input: AgentInput<RebookingInput>): Promise<AgentOutput<RebookingOutput>> {
    if (!this.initialized) throw new AgentNotInitializedError(this.id);
    const d = input.data;

    this.validateInput(d);

    const maxAlternatives = d.maxAlternatives ?? 5;
    const requestedAt = d.requestedAt ?? new Date().toISOString();

    // Step 1: search alternatives on the requested route/date.
    const searchInput: AvailabilitySearchInput = {
      origin: d.newOrigin,
      destination: d.newDestination,
      departure_date: d.newDepartureDate,
      passengers: [{ type: 'ADT', count: 1 }],
    };
    const searchResult = await this.search.execute({ data: searchInput }).catch(() => null);

    let candidates: SearchOffer[] = searchResult?.data.offers ?? [];

    // Step 2: optional same-day filter (exact calendar match).
    if (d.sameDay === true) {
      candidates = candidates.filter((o) =>
        o.itinerary.segments[0]?.departure_time.startsWith(d.newDepartureDate),
      );
    }

    const originalFarePolicy: OriginalFarePolicy = {
      isRefundable: d.originalTicket.is_refundable,
    };
    if (this.feeRuleResolver) {
      const rule = this.feeRuleResolver(d.originalTicket.fare_basis);
      if (rule !== undefined) originalFarePolicy.changeFeeRule = rule;
    }

    if (candidates.length === 0) {
      return {
        data: { alternatives: [], noAlternativesFound: true, originalFarePolicy },
        confidence: 0.7,
        metadata: { agent_id: this.id, candidateCount: 0 },
      };
    }

    // Step 3: assess each candidate via ChangeManagement, compute cost.
    const priced: Array<RebookingAlternative & { sortKey: number }> = [];
    const involuntary = isInvoluntary(d.reason);

    for (const offer of candidates) {
      const requested: RequestedItinerary = {
        segments: offer.itinerary.segments.map((s) => ({
          carrier: s.carrier,
          flight_number: s.flight_number,
          origin: s.origin,
          destination: s.destination,
          departure_date: s.departure_time.slice(0, 10),
          booking_class: s.booking_class ?? 'Y',
          fare_basis: offer.fare_basis?.[0] ?? 'UNKNOWN',
        })),
        new_fare: new Decimal(offer.price.base_fare).toFixed(2),
        new_fare_currency: offer.price.currency,
        new_tax: new Decimal(offer.price.taxes).toFixed(2),
      };

      const assessment = await this.change
        .execute({
          data: {
            original_ticket: d.originalTicket,
            requested_itinerary: requested,
            current_datetime: requestedAt,
          },
        })
        .catch(() => null);

      if (!assessment || isDomainInputRequired(assessment.data)) continue;
      const a = assessment.data.assessment;

      // Skip REJECTed candidates entirely (noted in count but not returned).
      if (a.action === 'REJECT' && !involuntary) continue;

      const { changeFee, waived } = applyInvoluntaryWaiver(a, d.reason);
      const { fareDifference, taxDifference } = computeDifferences(d.originalTicket, offer);
      const totalCost = computeTotalCost(changeFee, fareDifference, taxDifference);

      const restrictions: string[] = [];
      if (involuntary) {
        restrictions.push(`involuntary change (${d.reason}) — fee waived`);
      } else if (waived) {
        restrictions.push('fee waived');
      }
      if (d.sameDay === true) {
        restrictions.push('same-day rebooking only');
      }

      priced.push({
        rank: 0,
        newItinerary: offer,
        changeFee,
        fareDifference,
        taxDifference,
        totalCost,
        // For involuntary REJECT-from-engine, treat as REISSUE since the carrier
        // obligation forces an alternative.
        action: a.action === 'REJECT' && involuntary ? 'REISSUE' : a.action,
        policyRestrictions: restrictions,
        sortKey: new Decimal(totalCost.amount).toNumber(),
      });
    }

    // Step 4: sort by totalCost ascending, cap, assign ranks.
    priced.sort((a, b) => a.sortKey - b.sortKey);
    const top: RebookingAlternative[] = priced.slice(0, maxAlternatives).map((p, i) => ({
      rank: i + 1,
      newItinerary: p.newItinerary,
      changeFee: p.changeFee,
      fareDifference: p.fareDifference,
      taxDifference: p.taxDifference,
      totalCost: p.totalCost,
      action: p.action,
      policyRestrictions: p.policyRestrictions,
    }));

    return {
      data: {
        alternatives: top,
        noAlternativesFound: top.length === 0,
        originalFarePolicy,
      },
      confidence: 1.0,
      metadata: {
        agent_id: this.id,
        candidateCount: candidates.length,
        alternativeCount: top.length,
      },
    };
  }

  async health(): Promise<AgentHealthStatus> {
    if (!this.initialized) return { status: 'unhealthy', details: 'Not initialized.' };
    const s = await this.search.health();
    if (s.status !== 'healthy') return s;
    const c = await this.change.health();
    if (c.status !== 'healthy') return c;
    return { status: 'healthy' };
  }

  destroy(): void {
    this.initialized = false;
  }

  // ─────────────────────────────────────────────────────────────────────────

  private validateInput(d: RebookingInput): void {
    if (!d.originalTicket) {
      throw new AgentInputValidationError(this.id, 'originalTicket', 'Required.');
    }
    if (!IATA_RE.test(d.newOrigin)) {
      throw new AgentInputValidationError(this.id, 'newOrigin', 'Must be a 3-letter IATA code.');
    }
    if (!IATA_RE.test(d.newDestination)) {
      throw new AgentInputValidationError(this.id, 'newDestination', 'Must be a 3-letter IATA code.');
    }
    if (d.newOrigin === d.newDestination) {
      throw new AgentInputValidationError(this.id, 'newDestination', 'Must differ from newOrigin.');
    }
    if (!ISO_DATE_RE.test(d.newDepartureDate)) {
      throw new AgentInputValidationError(this.id, 'newDepartureDate', 'Must be YYYY-MM-DD.');
    }
    const VALID_REASONS = ['voluntary', 'schedule_change', 'missed_connection', 'cancellation'];
    if (!VALID_REASONS.includes(d.reason)) {
      throw new AgentInputValidationError(
        this.id,
        'reason',
        `Must be one of: ${VALID_REASONS.join(', ')}.`,
      );
    }
    if (d.maxAlternatives !== undefined && d.maxAlternatives < 1) {
      throw new AgentInputValidationError(this.id, 'maxAlternatives', 'Must be >= 1.');
    }
  }
}

export type {
  Money,
  OriginalFarePolicy,
  RebookingAlternative,
  RebookingInput,
  RebookingOutput,
  RebookingReason,
} from './types.js';
