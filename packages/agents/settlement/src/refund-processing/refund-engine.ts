/**
 * Refund Processing Engine — penalty calc, commission recall,
 * tax refund, conjunction handling, BSP/ARC reporting.
 *
 * No invented penalty amounts.
 *
 * - When `input.cat33_rules` is provided, the engine applies the filed
 *   rules: pattern-match the fare basis, use the rule's penalty and
 *   forfeit-base-fare flag.
 * - When `input.cat33_rules` is absent, the engine uses the ATPCO
 *   public default: voluntary refunds incur NO penalty; involuntary
 *   refunds are full refunds.
 *   Source: https://atpco.net/single-blog/what-are-atpco-fare-rules-categories/
 *
 * Two separate rules (do not collapse):
 * 1. No Cat 33 data / no matched provision → ATPCO public default = free refund
 *    (never fail-closed, never DOMAIN_QUESTION for missing Cat data).
 * 2. `waiver_code` present without typed `waiver_effect` → fail closed.
 *    Presence of a waiver code ≠ skip penalty.
 * See docs/knowledge-base/waiver-typology.md.
 *
 * Partial refunds (issue #150 / KB partial-refund-residual-value.md):
 * - Require `partial_valuation` with PUBLISHED_FARE or CARRIER_SPECIFIC
 * - Passenger path = Cat 33 penalty + THB unused base/taxes
 * - NEVER original−used, coupon-ratio, MPA-P, or haversine
 *
 * // DOMAIN_QUESTION: per-carrier ATPCO Cat33 data ingestion pipeline.
 * // DOMAIN_QUESTION: DQ-W1 — map free-text waiver codes → WaiverEffect
 * //   (only when a waiver_code is present; not when Cat 33 data is absent).
 */

import Decimal from 'decimal.js';
import { AgentInputValidationError, domainInputRequired } from '@otaip/core';
import type {
  RefundProcessingInput,
  RefundProcessingResult,
  RefundRecord,
  RefundAuditTrail,
  RefundPenaltyRule,
  TaxItem,
  BspRefundFields,
  ArcRefundFields,
  Cat33Rules,
  WaiverEffect,
  WaiverPenaltyReduction,
} from './types.js';
import { WAIVER_EFFECTS } from './types.js';

const AGENT_ID = '6.1';

function sumTaxes(taxes: TaxItem[]): Decimal {
  let total = new Decimal(0);
  for (const t of taxes) {
    total = total.plus(new Decimal(t.amount));
  }
  return total;
}

function findPenaltyRule(
  rules: Cat33Rules | undefined,
  fareBasis: string,
): RefundPenaltyRule | undefined {
  if (!rules) return undefined;
  for (const rule of rules.rules) {
    if (new RegExp(rule.fare_basis_pattern).test(fareBasis)) {
      return rule;
    }
  }
  return undefined;
}

function calculateCommissionRecall(input: RefundProcessingInput, baseFareRefund: Decimal): Decimal {
  if (!input.commission) return new Decimal(0);

  const originalBase = new Decimal(input.base_fare);
  if (originalBase.equals(0)) return new Decimal(0);

  const commissionAmount = new Decimal(input.commission.amount);
  // Proportional recall: commission * (refund_base / original_base)
  return commissionAmount.times(baseFareRefund).dividedBy(originalBase).toDecimalPlaces(2);
}

function buildBspFields(
  input: RefundProcessingInput,
  totalRefund: Decimal,
  taxBreakdown: TaxItem[],
  penalty: Decimal,
): BspRefundFields {
  const currentDate = input.current_date ?? new Date().toISOString().slice(0, 10);
  return {
    original_ticket_number: input.ticket_number,
    refund_amount: totalRefund.toFixed(2),
    tax_breakdown: taxBreakdown,
    penalty_applied: penalty.toFixed(2),
    refund_indicator: 'R',
    settlement_code: `BSP-${currentDate.replace(/-/g, '')}`,
    remittance_currency: input.base_fare_currency,
  };
}

function buildArcFields(
  input: RefundProcessingInput,
  totalRefund: Decimal,
  taxBreakdown: TaxItem[],
  penalty: Decimal,
): ArcRefundFields {
  const currentDate = input.current_date ?? new Date().toISOString().slice(0, 10);
  return {
    original_document_number: input.ticket_number,
    total_refund: totalRefund.toFixed(2),
    tax_refund_breakdown: taxBreakdown,
    penalty_deducted: penalty.toFixed(2),
    refund_type_indicator: 'R',
    settlement_week: `ARC-WK${currentDate.slice(5, 7)}${currentDate.slice(8, 10)}`,
  };
}

/**
 * Fail closed only for waiver semantics — never for missing Cat 33 data.
 * Absence of Cat 33 / no matched provision is handled by the ATPCO free default
 * in processRefund; this assert does not throw in that case.
 */
export function assertRefundWaiverInput(input: RefundProcessingInput): void {
  const hasCode = input.waiver_code !== undefined && input.waiver_code !== '';
  const effect = input.waiver_effect;

  if (!hasCode && effect === undefined) return;

  if (hasCode && effect === undefined) {
    // TODO: DOMAIN_QUESTION: DQ-W1 — what is the waiver type and its specific effect?
    throw new AgentInputValidationError(
      AGENT_ID,
      'waiver_effect',
      'Required when waiver_code is set. Presence of a waiver code ≠ skip penalty. See docs/knowledge-base/waiver-typology.md.',
    );
  }

  if (effect !== undefined && !(WAIVER_EFFECTS as readonly string[]).includes(effect)) {
    throw new AgentInputValidationError(
      AGENT_ID,
      'waiver_effect',
      `Unknown waiver_effect "${String(effect)}". Fail closed — do not invent semantics.`,
    );
  }

  if (!hasCode && effect !== undefined) {
    throw new AgentInputValidationError(
      AGENT_ID,
      'waiver_code',
      'Required when waiver_effect is set.',
    );
  }

  if (effect === 'REDUCE_PENALTY') {
    assertReduction(input.waiver_penalty_reduction);
  }

  if (effect === 'CHANGE_REFUND_FORM') {
    if (!input.waiver_refund_form) {
      throw new AgentInputValidationError(
        AGENT_ID,
        'waiver_refund_form',
        'Required when waiver_effect is CHANGE_REFUND_FORM.',
      );
    }
  }

  if (effect === 'CHANGE_REBOOKING_CLASS') {
    const classes = input.permitted_booking_classes ?? [];
    const patterns = input.permitted_fare_basis_patterns ?? [];
    if (classes.length === 0 && patterns.length === 0) {
      // TODO: DOMAIN_QUESTION: DQ-W4 — carrier class-substitution tables
      throw new AgentInputValidationError(
        AGENT_ID,
        'permitted_booking_classes',
        'CHANGE_REBOOKING_CLASS requires permitted_booking_classes and/or permitted_fare_basis_patterns.',
      );
    }
  }
}

function assertReduction(reduction: WaiverPenaltyReduction | undefined): void {
  if (!reduction) {
    throw new AgentInputValidationError(
      AGENT_ID,
      'waiver_penalty_reduction',
      'Required when waiver_effect is REDUCE_PENALTY. Do not invent reduction amounts.',
    );
  }
  if (reduction.kind === 'FIXED') {
    if (!reduction.amount || isNaN(Number(reduction.amount))) {
      throw new AgentInputValidationError(
        AGENT_ID,
        'waiver_penalty_reduction.amount',
        'FIXED reduction requires a decimal amount string (remaining penalty).',
      );
    }
  } else if (reduction.kind === 'PERCENT_WAIVED') {
    if (
      typeof reduction.percent !== 'number' ||
      Number.isNaN(reduction.percent) ||
      reduction.percent < 0 ||
      reduction.percent > 100
    ) {
      throw new AgentInputValidationError(
        AGENT_ID,
        'waiver_penalty_reduction.percent',
        'PERCENT_WAIVED must be a number from 0 to 100.',
      );
    }
  } else {
    throw new AgentInputValidationError(
      AGENT_ID,
      'waiver_penalty_reduction.kind',
      'Must be FIXED or PERCENT_WAIVED.',
    );
  }
}

function filedPenaltyAmount(
  rule: RefundPenaltyRule | undefined,
  isRefundable: boolean,
  baseCap: Decimal,
): Decimal {
  if (rule?.forfeit_base_fare && !isRefundable) {
    // Forfeit path is not a numeric "penalty_applied" in the same sense —
    // callers use forfeit; treat filed charge as full base for reduction math.
    return baseCap;
  }
  if (rule) {
    return Decimal.min(new Decimal(rule.penalty_amount), baseCap);
  }
  // ATPCO no-match / no-data default: no charge
  return new Decimal(0);
}

/**
 * Apply typed waiver to a filed penalty. Does not invent amounts.
 */
function applyWaiverToPenalty(
  filedPenalty: Decimal,
  effect: WaiverEffect | undefined,
  reduction: WaiverPenaltyReduction | undefined,
): { penalty: Decimal; eliminatesCharge: boolean; changesFormOnly: boolean } {
  if (!effect) {
    return { penalty: filedPenalty, eliminatesCharge: false, changesFormOnly: false };
  }

  switch (effect) {
    case 'ELIMINATE_PENALTY':
    case 'IRROP_INVOLUNTARY':
      return { penalty: new Decimal(0), eliminatesCharge: true, changesFormOnly: false };
    case 'REDUCE_PENALTY': {
      // reduction validated by assertRefundWaiverInput
      const r = reduction!;
      if (r.kind === 'FIXED') {
        // FIXED = remaining penalty after waiver (caller-supplied, not invented)
        const remaining = Decimal.min(new Decimal(r.amount), filedPenalty);
        return {
          penalty: Decimal.max(remaining, new Decimal(0)),
          eliminatesCharge: remaining.equals(0),
          changesFormOnly: false,
        };
      }
      // PERCENT_WAIVED: eliminate this percent of the filed penalty
      const waived = filedPenalty.times(r.percent).dividedBy(100);
      const remaining = filedPenalty.minus(waived).toDecimalPlaces(2);
      return {
        penalty: Decimal.max(remaining, new Decimal(0)),
        eliminatesCharge: remaining.equals(0),
        changesFormOnly: false,
      };
    }
    case 'CHANGE_REFUND_FORM':
    case 'CHANGE_REBOOKING_CLASS':
      // Form / class constraint does not skip the filed charge
      return { penalty: filedPenalty, eliminatesCharge: false, changesFormOnly: effect === 'CHANGE_REFUND_FORM' };
    default: {
      // Exhaustiveness / fail closed for any future unknown value at runtime
      throw new AgentInputValidationError(
        AGENT_ID,
        'waiver_effect',
        `Unknown waiver_effect "${String(effect)}". Fail closed.`,
      );
    }
  }
}

function resolveVoluntaryPenalty(
  input: RefundProcessingInput,
  rule: RefundPenaltyRule | undefined,
  baseCap: Decimal,
): { baseFareRefund: Decimal; penalty: Decimal; forfeited: boolean } {
  const isInvoluntary = input.is_involuntary === true;
  const effect = input.waiver_effect;

  // Involuntary flag or IRROP waiver → full base, no voluntary Cat 33 charge
  if (isInvoluntary || effect === 'IRROP_INVOLUNTARY' || effect === 'ELIMINATE_PENALTY') {
    return { baseFareRefund: baseCap, penalty: new Decimal(0), forfeited: false };
  }

  // Filed forfeit (non-refundable) — waiver REDUCE still needs a numeric base;
  // without eliminate/IRROP, forfeit stands unless REDUCE supplies remaining.
  if (rule?.forfeit_base_fare && !input.is_refundable && effect !== 'REDUCE_PENALTY') {
    // CHANGE_REFUND_FORM / CHANGE_REBOOKING_CLASS do not override forfeit
    return { baseFareRefund: new Decimal(0), penalty: new Decimal(0), forfeited: true };
  }

  const filed = filedPenaltyAmount(rule, input.is_refundable, baseCap);
  const { penalty } = applyWaiverToPenalty(filed, effect, input.waiver_penalty_reduction);

  if (rule?.forfeit_base_fare && !input.is_refundable && effect === 'REDUCE_PENALTY') {
    // Caller supplied remaining penalty against what would have been full forfeit
    const baseFareRefund = Decimal.max(baseCap.minus(penalty), new Decimal(0));
    return { baseFareRefund, penalty, forfeited: false };
  }

  const baseFareRefund = Decimal.max(baseCap.minus(penalty), new Decimal(0));
  return { baseFareRefund, penalty, forfeited: false };
}

export function processRefund(input: RefundProcessingInput): RefundProcessingResult {
  assertRefundWaiverInput(input);

  const originalBase = new Decimal(input.base_fare);
  const originalTax = sumTaxes(input.taxes);
  const rule = findPenaltyRule(input.cat33_rules, input.fare_basis);

  let baseFareRefund: Decimal;
  let taxRefund: Decimal;
  let taxBreakdown: TaxItem[];
  let penalty: Decimal;
  let couponsRefunded: number[];
  let residualMethod: 'PUBLISHED_FARE' | 'CARRIER_SPECIFIC' | undefined;
  let flownBaseFare: string | undefined;

  switch (input.refund_type) {
    case 'FULL': {
      // Penalty source-of-truth:
      //   - involuntary / IRROP_INVOLUNTARY / ELIMINATE_PENALTY → 0
      //   - REDUCE_PENALTY → caller-supplied reduction of filed charge
      //   - CHANGE_REFUND_FORM / CHANGE_REBOOKING_CLASS → filed charge still applies
      //   - filed forfeit_base_fare → entire base forfeited (unless eliminate/reduce)
      //   - filed penalty_amount → that amount (subject to typed waiver)
      //   - no rule + voluntary → 0 (ATPCO public default)
      const resolved = resolveVoluntaryPenalty(input, rule, originalBase);
      baseFareRefund = resolved.baseFareRefund;
      penalty = resolved.penalty;
      taxRefund = originalTax;
      taxBreakdown = input.taxes;
      couponsRefunded = Array.from({ length: input.total_coupons }, (_, i) => i + 1);
      break;
    }

    case 'PARTIAL': {
      const valuation = input.partial_valuation;
      if (!valuation) {
        return domainInputRequired({
          missing: [
            'partial_valuation',
            'published_fare_or_carrier_residual_amounts',
          ],
          description:
            'PARTIAL refund requires explicit PUBLISHED_FARE or CARRIER_SPECIFIC unused base/taxes. Rejected: original−used without method, coupon-count ratio, MPA-P interline proration, and haversine through-fare splits. Absence of Cat 33 data means free Cat 33 penalty once amounts are supplied — it does not invent a proration method. THB = IATA Ticketing Handbook (cite by name only).',
          references: [
            'docs/knowledge-base/partial-refund-residual-value.md',
            'IATA Ticketing Handbook (THB) — cite by name only',
            'GitHub issue #150',
          ],
        });
      }

      if (valuation.method !== 'PUBLISHED_FARE' && valuation.method !== 'CARRIER_SPECIFIC') {
        return domainInputRequired({
          missing: ['partial_valuation.method'],
          description:
            'partial_valuation.method must be PUBLISHED_FARE or CARRIER_SPECIFIC. MPA-P is airline interline settlement, not passenger residual.',
          references: [
            'docs/knowledge-base/partial-refund-residual-value.md',
            'GitHub issue #150',
          ],
        });
      }

      const unusedBase = new Decimal(valuation.unused_base_fare);
      const resolved = resolveVoluntaryPenalty(input, rule, unusedBase);
      baseFareRefund = resolved.baseFareRefund;
      penalty = resolved.penalty;
      taxBreakdown = valuation.unused_taxes;
      taxRefund = sumTaxes(taxBreakdown);
      residualMethod = valuation.method;
      flownBaseFare = valuation.flown_base_fare;

      const refundableCoupons = (input.coupons_to_refund ?? []).filter((c) => c.refundable);
      couponsRefunded = refundableCoupons.map((c) => c.coupon_number);
      break;
    }

    case 'TAX_ONLY': {
      // Tax-only refund — base fare forfeited (no-show on non-refundable)
      baseFareRefund = new Decimal(0);
      penalty = new Decimal(0);
      taxRefund = originalTax;
      taxBreakdown = input.taxes;
      couponsRefunded = Array.from({ length: input.total_coupons }, (_, i) => i + 1);
      break;
    }
  }

  // Commission recall
  const commissionRecalled = calculateCommissionRecall(input, baseFareRefund);

  // Total and net
  const totalRefund = baseFareRefund.plus(taxRefund);
  const netRefund = totalRefund.minus(commissionRecalled);

  // Audit trail
  const audit: RefundAuditTrail = {
    original_ticket_number: input.ticket_number,
    ...(input.conjunction_tickets !== undefined ? { conjunction_tickets: input.conjunction_tickets } : {}),
    refund_type: input.refund_type,
    original_base_fare: originalBase.toFixed(2),
    original_total_tax: originalTax.toFixed(2),
    penalty_applied: penalty.toFixed(2),
    ...(input.waiver_code !== undefined ? { waiver_code: input.waiver_code } : {}),
    ...(input.waiver_effect !== undefined ? { waiver_effect: input.waiver_effect } : {}),
    ...(input.waiver_refund_form !== undefined
      ? { waiver_refund_form: input.waiver_refund_form }
      : {}),
    base_fare_refunded: baseFareRefund.toFixed(2),
    tax_refunded: taxRefund.toFixed(2),
    commission_recalled: commissionRecalled.toFixed(2),
    coupons_refunded: couponsRefunded,
    ...(residualMethod !== undefined ? { residual_method: residualMethod } : {}),
    ...(flownBaseFare !== undefined ? { flown_base_fare: flownBaseFare } : {}),
  };

  // Settlement fields
  const bspFields =
    input.settlement_system === 'BSP'
      ? buildBspFields(input, totalRefund, taxBreakdown, penalty)
      : undefined;
  const arcFields =
    input.settlement_system === 'ARC'
      ? buildArcFields(input, totalRefund, taxBreakdown, penalty)
      : undefined;

  const refund: RefundRecord = {
    ticket_number: input.ticket_number,
    refund_type: input.refund_type,
    penalty_applied: penalty.toFixed(2),
    base_fare_refund: baseFareRefund.toFixed(2),
    tax_refund: taxRefund.toFixed(2),
    tax_breakdown: taxBreakdown,
    total_refund: totalRefund.toFixed(2),
    commission_recalled: commissionRecalled.toFixed(2),
    net_refund: netRefund.toFixed(2),
    ...(input.waiver_code !== undefined ? { waiver_code: input.waiver_code } : {}),
    ...(input.waiver_effect !== undefined ? { waiver_effect: input.waiver_effect } : {}),
    ...(input.waiver_refund_form !== undefined
      ? { waiver_refund_form: input.waiver_refund_form }
      : {}),
    ...(bspFields !== undefined ? { bsp_fields: bspFields } : {}),
    ...(arcFields !== undefined ? { arc_fields: arcFields } : {}),
    audit,
  };

  return {
    refund,
    net_refund_amount: netRefund.toFixed(2),
    commission_recalled: commissionRecalled.toFixed(2),
  };
}
