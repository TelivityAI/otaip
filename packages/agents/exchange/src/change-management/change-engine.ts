/**
 * Change Management Engine — ATPCO Cat 31 voluntary change assessment
 * plus US DOT 14 CFR §259.5(b)(4) 24-hour reservation assessment.
 *
 * No invented penalty amounts.
 *
 * - When `input.cat31_rules` is provided, the engine applies the filed
 *   rules: pattern-match the fare basis, use the rule's penalty, free-
 *   change window, and downgrade-forfeit flag.
 * - When `input.cat31_rules` is absent, the engine uses the ATPCO
 *   public default: voluntary changes are PERMITTED AT NO CHARGE;
 *   involuntary changes have the fee waived.
 *   Source: https://atpco.net/single-blog/what-are-atpco-fare-rules-categories/
 * - DOT 24h is assessed separately and never sets `is_free_change`.
 *
 * Two separate rules (do not collapse):
 * 1. No Cat 31 data / no matched provision → ATPCO public default = free change
 *    (never fail-closed, never DOMAIN_QUESTION for missing Cat data).
 * 2. `waiver_code` present without typed `waiver_effect` → fail closed.
 *    Presence of a waiver code ≠ skip penalty.
 * See docs/knowledge-base/waiver-typology.md.
 *
 * Residual value (issue #150 / KB partial-refund-residual-value.md):
 * - FULLY_UNUSED → residual = ticketed base (change fee is separate)
 * - PARTIALLY_USED → require PUBLISHED_FARE or CARRIER_SPECIFIC valuation
 * - NEVER residual = original − change fee
 * - MPA-P / haversine / coupon-ratio are not passenger residual methods
 *
 * // DOMAIN_QUESTION: per-carrier ATPCO Cat31 data ingestion pipeline.
 * // DOMAIN_QUESTION: DQ-W1 — map free-text waiver codes → WaiverEffect
 * //   (only when a waiver_code is present; not when Cat 31 data is absent).
 * // DOMAIN_QUESTION: DQ-R5 Cat 31 residual on partially used changes.
 */

import Decimal from 'decimal.js';
import { AgentInputValidationError, domainInputRequired } from '@otaip/core';
import type {
  ChangeManagementInput,
  ChangeManagementResult,
  ChangeAssessment,
  ChangeFeeRule,
  ChangeAction,
  Cat31Rules,
  WaiverEffect,
  WaiverPenaltyReduction,
} from './types.js';
import { WAIVER_EFFECTS } from './types.js';
import { assessUsDot24Hour } from './us-dot-24h.js';

const AGENT_ID = '5.1';

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
    return { ok: true, residual: originalFare, method: 'FULLY_UNUSED' };
  }

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

/**
 * Fail closed only for waiver semantics — never for missing Cat 31 data.
 * Absence of Cat 31 / no matched provision is handled by the ATPCO free default
 * in assessChange; this assert does not throw in that case.
 */
export function assertChangeWaiverInput(input: ChangeManagementInput): void {
  const hasCode = input.waiver_code !== undefined && input.waiver_code !== '';
  const effect = input.waiver_effect;

  if (!hasCode && effect === undefined) return;

  if (hasCode && effect === undefined) {
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
        'FIXED reduction requires a decimal amount string (remaining change fee).',
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

function applyWaiverToFee(
  filedFee: Decimal,
  effect: WaiverEffect | undefined,
  reduction: WaiverPenaltyReduction | undefined,
): Decimal {
  if (!effect) return filedFee;

  switch (effect) {
    case 'ELIMINATE_PENALTY':
    case 'IRROP_INVOLUNTARY':
      return new Decimal('0.00');
    case 'REDUCE_PENALTY': {
      const r = reduction!;
      if (r.kind === 'FIXED') {
        return Decimal.max(Decimal.min(new Decimal(r.amount), filedFee), new Decimal(0));
      }
      const waived = filedFee.times(r.percent).dividedBy(100);
      return Decimal.max(filedFee.minus(waived), new Decimal(0)).toDecimalPlaces(2);
    }
    case 'CHANGE_REFUND_FORM':
    case 'CHANGE_REBOOKING_CLASS':
      return filedFee;
    default:
      throw new AgentInputValidationError(
        AGENT_ID,
        'waiver_effect',
        `Unknown waiver_effect "${String(effect)}". Fail closed.`,
      );
  }
}

export function assessChange(input: ChangeManagementInput): ChangeManagementResult {
  assertChangeWaiverInput(input);

  const now = currentTime(input);
  const orig = input.original_ticket;
  const req = input.requested_itinerary;
  const currency = orig.base_fare_currency;
  const isInvoluntary = input.is_involuntary === true;
  const effect = input.waiver_effect;

  const usDot24h = assessUsDot24Hour(input, now);

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
      ...(input.waiver_code !== undefined ? { waiver_code: input.waiver_code } : {}),
      ...(effect !== undefined ? { waiver_effect: effect } : {}),
    };
    return { assessment, us_dot_24h: usDot24h };
  }

  const originalFare = new Decimal(orig.base_fare);
  const residualResolved = resolveResidual(input, originalFare);
  if (!residualResolved.ok) {
    return residualResolved.result;
  }

  const rule = input.cat31_rules
    ? findMatchingRule(input.cat31_rules.rules, orig.fare_basis)
    : undefined;

  const changeFeeAmount = rule ? new Decimal(rule.change_fee) : new Decimal('0.00');
  const freeChangeHours = rule?.free_change_hours ?? 0;
  const forfeitOnDowngrade = rule?.forfeit_difference_on_downgrade ?? false;

  const isFreeChange = isWithinFreeChangeWindow(orig.booking_date, now, freeChangeHours);

  let effectiveChangeFee: Decimal;
  if (isFreeChange || isInvoluntary) {
    effectiveChangeFee = new Decimal('0.00');
  } else {
    effectiveChangeFee = applyWaiverToFee(
      changeFeeAmount,
      effect,
      input.waiver_penalty_reduction,
    );
  }

  const feeWaived =
    isFreeChange ||
    isInvoluntary ||
    effect === 'ELIMINATE_PENALTY' ||
    effect === 'IRROP_INVOLUNTARY' ||
    (effect === 'REDUCE_PENALTY' && effectiveChangeFee.equals(0));

  const newFare = new Decimal(req.new_fare);
  const residualValue = residualResolved.residual;
  const fareDifference = newFare.minus(originalFare);

  const originalTax = new Decimal(orig.total_tax);
  const newTax = new Decimal(req.new_tax);
  const taxDifference = newTax.minus(originalTax);

  let additionalCollection = new Decimal('0.00');
  let forfeitedAmount = new Decimal('0.00');

  if (fareDifference.greaterThan(0)) {
    additionalCollection = fareDifference;
  } else if (fareDifference.lessThan(0)) {
    if (!orig.is_refundable && forfeitOnDowngrade) {
      forfeitedAmount = fareDifference.abs();
    }
  }

  const taxDue = taxDifference.greaterThan(0) ? taxDifference : new Decimal('0.00');
  const totalDue = effectiveChangeFee.plus(additionalCollection).plus(taxDue);

  let action: ChangeAction = 'REISSUE';
  if (totalDue.equals(0) && fareDifference.equals(0) && effectiveChangeFee.equals(0)) {
    action = 'REBOOK';
  }

  const summaryParts: string[] = [];
  if (isInvoluntary || effect === 'IRROP_INVOLUNTARY') {
    summaryParts.push('Involuntary change — fee waived per carrier/regulatory practice.');
  }
  if (isFreeChange) summaryParts.push('Free change (within booking window).');
  if (effect === 'ELIMINATE_PENALTY') {
    summaryParts.push(
      `Waiver code ${input.waiver_code!} effect ELIMINATE_PENALTY — change fee eliminated.`,
    );
  } else if (effect === 'REDUCE_PENALTY') {
    summaryParts.push(
      `Waiver code ${input.waiver_code!} effect REDUCE_PENALTY — change fee ${currency} ${effectiveChangeFee.toFixed(2)}.`,
    );
  } else if (effect === 'CHANGE_REBOOKING_CLASS') {
    summaryParts.push(
      `Waiver code ${input.waiver_code!} effect CHANGE_REBOOKING_CLASS — filed change fee still applies; rebooking class/fare constrained.`,
    );
  } else if (effect === 'CHANGE_REFUND_FORM') {
    summaryParts.push(
      `Waiver code ${input.waiver_code!} effect CHANGE_REFUND_FORM (${input.waiver_refund_form}) — filed change fee still applies.`,
    );
  } else if (input.waiver_code) {
    summaryParts.push(`Waiver code ${input.waiver_code} recorded.`);
  }
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
    fee_waived: feeWaived,
    ...(input.waiver_code !== undefined ? { waiver_code: input.waiver_code } : {}),
    ...(effect !== undefined ? { waiver_effect: effect } : {}),
    ...(input.permitted_booking_classes !== undefined
      ? { permitted_booking_classes: input.permitted_booking_classes }
      : {}),
    ...(input.permitted_fare_basis_patterns !== undefined
      ? { permitted_fare_basis_patterns: input.permitted_fare_basis_patterns }
      : {}),
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

  return { assessment, us_dot_24h: usDot24h };
}
