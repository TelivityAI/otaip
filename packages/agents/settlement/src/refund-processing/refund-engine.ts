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
 *   default per the project's domain spec: voluntary refunds incur NO
 *   penalty; involuntary refunds are full refunds.
 *
 * Partial refunds (issue #150 / KB partial-refund-residual-value.md):
 * - Require `partial_valuation` with PUBLISHED_FARE or CARRIER_SPECIFIC
 * - Passenger path = Cat 33 penalty + THB unused base/taxes
 * - NEVER original−used, coupon-ratio, MPA-P, or haversine
 *
 * // DOMAIN_QUESTION: per-carrier ATPCO Cat33 data ingestion pipeline.
 */

import Decimal from 'decimal.js';
import { domainInputRequired } from '@otaip/core';
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
} from './types.js';

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

function applyBasePenalty(
  unusedBase: Decimal,
  rule: RefundPenaltyRule | undefined,
  isInvoluntary: boolean,
  isRefundable: boolean,
): { baseFareRefund: Decimal; penalty: Decimal } {
  if (isInvoluntary) {
    return { baseFareRefund: unusedBase, penalty: new Decimal(0) };
  }
  if (rule?.forfeit_base_fare && !isRefundable) {
    return { baseFareRefund: new Decimal(0), penalty: new Decimal(0) };
  }
  if (rule) {
    const penaltyAmount = new Decimal(rule.penalty_amount);
    const penalty = Decimal.min(penaltyAmount, unusedBase);
    return { baseFareRefund: unusedBase.minus(penalty), penalty };
  }
  // No Cat 33 data / no matching provision → ATPCO public default: free (no penalty).
  // Bare waiver_code is NOT this path — fail closed before calling this helper.
  return { baseFareRefund: unusedBase, penalty: new Decimal(0) };
}

export function processRefund(input: RefundProcessingInput): RefundProcessingResult {
  const originalBase = new Decimal(input.base_fare);
  const originalTax = sumTaxes(input.taxes);
  const rule = findPenaltyRule(input.cat33_rules, input.fare_basis);
  const isInvoluntary = input.is_involuntary === true;

  // Bare waiver_code ≠ free (same split as #153). Fail closed until typed effect.
  if (input.waiver_code) {
    return domainInputRequired({
      missing: ['waiver_effect'],
      description:
        'waiver_code is present without typed waiver_effect. Bare waiver identity does not skip Cat 33 penalty (issue #138 / PR #153). Contrast: no Cat 33 data / unmatched provision → free refund (ATPCO public default) — that path does not apply to bare waivers or missing proration methods.',
      references: [
        'docs/knowledge-base/partial-refund-residual-value.md',
        'GitHub issue #138',
        'GitHub issue #150',
      ],
    });
  }

  let baseFareRefund: Decimal;
  let taxRefund: Decimal;
  let taxBreakdown: TaxItem[];
  let penalty: Decimal;
  let couponsRefunded: number[];
  let residualMethod: 'PUBLISHED_FARE' | 'CARRIER_SPECIFIC' | undefined;
  let flownBaseFare: string | undefined;

  switch (input.refund_type) {
    case 'FULL': {
      const applied = applyBasePenalty(
        originalBase,
        rule,
        isInvoluntary,
        input.is_refundable,
      );
      baseFareRefund = applied.baseFareRefund;
      penalty = applied.penalty;
      taxRefund = originalTax;
      taxBreakdown = input.taxes;
      couponsRefunded = Array.from({ length: input.total_coupons }, (_, i) => i + 1);
      break;
    }

    case 'PARTIAL': {
      // Fail closed without an explicit passenger valuation method.
      // Cat 33 no-match = free penalty (separate). Method missing ≠ free.
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
      const applied = applyBasePenalty(
        unusedBase,
        rule,
        isInvoluntary,
        input.is_refundable,
      );
      baseFareRefund = applied.baseFareRefund;
      penalty = applied.penalty;
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
    ...(input.conjunction_tickets !== undefined
      ? { conjunction_tickets: input.conjunction_tickets }
      : {}),
    refund_type: input.refund_type,
    original_base_fare: originalBase.toFixed(2),
    original_total_tax: originalTax.toFixed(2),
    penalty_applied: penalty.toFixed(2),
    ...(input.waiver_code !== undefined ? { waiver_code: input.waiver_code } : {}),
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
