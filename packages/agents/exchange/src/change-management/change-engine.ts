/**
 * Change Management Engine — ATPCO Cat 31 voluntary change assessment.
 *
 * No invented penalty amounts.
 *
 * - When `input.cat31_rules` is provided, the engine applies the filed
 *   rules: pattern-match the fare basis, use the rule's penalty, free-
 *   change window, and downgrade-forfeit flag.
 * - When `input.cat31_rules` is absent, the engine uses the ATPCO
 *   default per the project's domain spec: voluntary changes are
 *   PERMITTED AT NO CHARGE; involuntary changes have the fee waived.
 *
 * Residual value (issue #150 / KB partial-refund-residual-value.md):
 * - FULLY_UNUSED → residual = ticketed base (change fee is separate)
 * - PARTIALLY_USED → require PUBLISHED_FARE or CARRIER_SPECIFIC valuation
 * - NEVER residual = original − change fee
 * - MPA-P / haversine / coupon-ratio are not passenger residual methods
 *
 * // DOMAIN_QUESTION: per-carrier ATPCO Cat31 data ingestion pipeline.
 * // DOMAIN_QUESTION: DQ-R5 Cat 31 residual on partially used changes.
 */

import Decimal from 'decimal.js';
import { domainInputRequired } from '@otaip/core';
import type {
  ChangeManagementInput,
  ChangeManagementResult,
  ChangeAssessment,
  ChangeFeeRule,
  ChangeAction,
  Cat31Rules,
} from './types.js';

function currentTime(input: ChangeManagementInput): Date {
  return input.current_datetime ? new Date(input.current_datetime) : new Date();
}

function findMatchingRule(rules: ChangeFeeRule[], fareBasis: string): ChangeFeeRule | undefined {
  for (const rule of rules) {
    const re = new RegExp(rule.fare_basis_pattern);
    if (re.test(fareBasis)) {
      return rule;
    }
  }
  return undefined;
}

function isRejectFare(rules: Cat31Rules | undefined, fareBasis: string): boolean {
  if (!rules) return false;
  return rules.reject_patterns.some((p) => new RegExp(p).test(fareBasis));
}

function isWithinFreeChangeWindow(
  bookingDate: string | undefined,
  now: Date,
  freeChangeHours: number,
): boolean {
  if (freeChangeHours <= 0 || !bookingDate) return false;
  const booked = new Date(bookingDate);
  const hoursSinceBooking = (now.getTime() - booked.getTime()) / (1000 * 60 * 60);
  return hoursSinceBooking <= freeChangeHours;
}

function resolveResidual(
  input: ChangeManagementInput,
  originalFare: Decimal,
):
  | { ok: true; residual: Decimal; method: 'FULLY_UNUSED' | 'PUBLISHED_FARE' | 'CARRIER_SPECIFIC' }
  | { ok: false; result: ReturnType<typeof domainInputRequired> } {
  const usage = input.ticket_usage ?? 'FULLY_UNUSED';

  if (usage === 'FULLY_UNUSED') {
    // Residual is the full ticketed base. Change fee is collected separately.
    return { ok: true, residual: originalFare, method: 'FULLY_UNUSED' };
  }

  // PARTIALLY_USED — require explicit published-fare or carrier residual amounts.
  // Cat 33 + IATA Ticketing Handbook (THB) govern passenger path; MPA-P does not.
  // Missing method is fail-closed. Missing Cat 33 data is a separate free-penalty path.
  const valuation = input.residual_valuation;
  if (!valuation) {
    return {
      ok: false,
      result: domainInputRequired({
        missing: [
          'residual_valuation',
          'published_fare_or_carrier_residual_amounts',
        ],
        description:
          'Partially used ticket: passenger residual requires explicit PUBLISHED_FARE or CARRIER_SPECIFIC unused amounts (Cat 33 + IATA Ticketing Handbook practice). Cannot use original−used, MPA-P interline proration, haversine, or coupon-ratio splits. Note: absence of Cat 33 data means free penalty — it does not invent a proration method.',
        references: [
          'docs/knowledge-base/partial-refund-residual-value.md',
          'IATA Ticketing Handbook (THB) — cite by name only',
          'GitHub issue #150',
        ],
      }),
    };
  }

  if (valuation.method !== 'PUBLISHED_FARE' && valuation.method !== 'CARRIER_SPECIFIC') {
    return {
      ok: false,
      result: domainInputRequired({
        missing: ['residual_valuation.method'],
        description:
          'Partially used residual method must be PUBLISHED_FARE or CARRIER_SPECIFIC. MPA-P is airline interline settlement, not passenger residual.',
        references: [
          'docs/knowledge-base/partial-refund-residual-value.md',
          'GitHub issue #150',
        ],
      }),
    };
  }

  return {
    ok: true,
    residual: new Decimal(valuation.unused_base_fare),
    method: valuation.method,
  };
}

export function assessChange(input: ChangeManagementInput): ChangeManagementResult {
  const now = currentTime(input);
  const orig = input.original_ticket;
  const req = input.requested_itinerary;
  const currency = orig.base_fare_currency;
  const isInvoluntary = input.is_involuntary === true;

  // Reject path applies only when filed rules say so.
  if (isRejectFare(input.cat31_rules, orig.fare_basis)) {
    const assessment: ChangeAssessment = {
      original_ticket_number: orig.ticket_number,
      action: 'REJECT',
      change_fee: '0.00',
      change_fee_currency: currency,
      fee_waived: false,
      fare_difference: '0.00',
      additional_collection: '0.00',
      residual_value: '0.00',
      residual_method: 'FULLY_UNUSED',
      forfeited_amount: orig.base_fare,
      tax_difference: '0.00',
      total_due: '0.00',
      currency,
      summary: `Change not permitted for fare basis ${orig.fare_basis}. This fare type does not allow voluntary changes (filed Cat31 rejection).`,
      is_free_change: false,
    };
    return { assessment };
  }

  // Bare waiver_code ≠ free (same split as #153 / waiver-typology). Fail closed
  // until typed waiver_effect is supplied — do not invent skip-penalty.
  if (input.waiver_code) {
    return domainInputRequired({
      missing: ['waiver_effect'],
      description:
        'waiver_code is present without typed waiver_effect. Bare waiver identity does not skip Cat 31 penalty (issue #138 / PR #153). Contrast: no Cat 31 data / unmatched provision → free change (ATPCO public default) — that path does not apply to bare waivers.',
      references: [
        'docs/knowledge-base/partial-refund-residual-value.md',
        'GitHub issue #138',
        'GitHub issue #150',
      ],
    });
  }

  const originalFare = new Decimal(orig.base_fare);
  const residualResolved = resolveResidual(input, originalFare);
  if (!residualResolved.ok) {
    return residualResolved.result;
  }

  const rule = input.cat31_rules
    ? findMatchingRule(input.cat31_rules.rules, orig.fare_basis)
    : undefined;

  // Penalty source-of-truth:
  //   1. Filed Cat31 rule for this fare basis  → rule.change_fee
  //   2. No rule + involuntary                  → 0 (carrier-initiated)
  //   3. No rule / unmatched provision + voluntary → 0 (ATPCO public default — free)
  // Bare waiver_code is NOT a free path (handled above).
  const changeFeeAmount = rule ? new Decimal(rule.change_fee) : new Decimal('0.00');
  const freeChangeHours = rule?.free_change_hours ?? 0;
  const forfeitOnDowngrade = rule?.forfeit_difference_on_downgrade ?? false;

  // Check free change window
  const isFreeChange = isWithinFreeChangeWindow(orig.booking_date, now, freeChangeHours);

  // Effective change fee: 0 if free window or involuntary; else the filed amount.
  // Never treat bare waiver_code as fee waived.
  const effectiveChangeFee =
    isFreeChange || isInvoluntary ? new Decimal('0.00') : changeFeeAmount;

  // Fare difference vs residual available for application toward new fare
  const newFare = new Decimal(req.new_fare);
  const residualValue = residualResolved.residual;
  const fareDifference = newFare.minus(originalFare);

  // Tax difference
  const originalTax = new Decimal(orig.total_tax);
  const newTax = new Decimal(req.new_tax);
  const taxDifference = newTax.minus(originalTax);

  // Additional collection and forfeiture
  let additionalCollection = new Decimal('0.00');
  let forfeitedAmount = new Decimal('0.00');

  if (fareDifference.greaterThan(0)) {
    // Upgrade: passenger pays the difference
    additionalCollection = fareDifference;
  } else if (fareDifference.lessThan(0)) {
    // Downgrade
    if (!orig.is_refundable && forfeitOnDowngrade) {
      // Non-refundable AND filed rule says forfeit: forfeit the difference
      forfeitedAmount = fareDifference.abs();
    }
    // Refundable fares: the negative difference would be credited (handled by agent 5.2)
  }

  // Total due from passenger
  const taxDue = taxDifference.greaterThan(0) ? taxDifference : new Decimal('0.00');
  const totalDue = effectiveChangeFee.plus(additionalCollection).plus(taxDue);

  // Determine action
  let action: ChangeAction = 'REISSUE';
  if (totalDue.equals(0) && fareDifference.equals(0) && effectiveChangeFee.equals(0)) {
    action = 'REBOOK'; // Simple same-fare rebook
  }

  // Build summary
  const summaryParts: string[] = [];
  if (isInvoluntary) summaryParts.push('Involuntary change — fee waived per carrier/regulatory practice.');
  if (isFreeChange) summaryParts.push('Free change (within booking window).');
  if (!rule && !input.cat31_rules)
    summaryParts.push('No Cat31 rules supplied — applying ATPCO default (no charge).');
  else if (input.cat31_rules && !rule)
    summaryParts.push('No matching Cat31 provision — applying ATPCO default (no charge).');
  if (effectiveChangeFee.greaterThan(0))
    summaryParts.push(`Change fee: ${currency} ${effectiveChangeFee.toFixed(2)}.`);
  if (additionalCollection.greaterThan(0))
    summaryParts.push(`Fare increase: ${currency} ${additionalCollection.toFixed(2)}.`);
  if (forfeitedAmount.greaterThan(0))
    summaryParts.push(`Forfeited on downgrade: ${currency} ${forfeitedAmount.toFixed(2)}.`);
  if (taxDue.greaterThan(0)) summaryParts.push(`Tax adjustment: ${currency} ${taxDue.toFixed(2)}.`);
  summaryParts.push(
    `Residual (${residualResolved.method}): ${currency} ${residualValue.toFixed(2)}.`,
  );
  summaryParts.push(`Total due: ${currency} ${totalDue.toFixed(2)}.`);

  const assessment: ChangeAssessment = {
    original_ticket_number: orig.ticket_number,
    action,
    change_fee: effectiveChangeFee.toFixed(2),
    change_fee_currency: currency,
    fee_waived: isFreeChange || isInvoluntary,
    fare_difference: fareDifference.toFixed(2),
    additional_collection: additionalCollection.toFixed(2),
    residual_value: residualValue.toFixed(2),
    residual_method: residualResolved.method,
    forfeited_amount: forfeitedAmount.toFixed(2),
    tax_difference: taxDifference.toFixed(2),
    total_due: totalDue.toFixed(2),
    currency,
    summary: summaryParts.join(' '),
    is_free_change: isFreeChange,
  };

  return { assessment };
}
