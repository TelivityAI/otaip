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
 *   default per the project's domain spec: voluntary changes are
 *   PERMITTED AT NO CHARGE; involuntary changes have the fee waived.
 * - DOT 24h is assessed separately and never sets `is_free_change`.
 *
 * The previous "$200 default" fallback was a CLAUDE.md violation and
 * has been removed. Carrier-specific rules MUST flow in via input.
 *
 * // DOMAIN_QUESTION: per-carrier ATPCO Cat31 data ingestion pipeline.
 */

import Decimal from 'decimal.js';
import type {
  ChangeManagementInput,
  ChangeManagementOutput,
  ChangeAssessment,
  ChangeFeeRule,
  ChangeAction,
  Cat31Rules,
} from './types.js';
import { assessUsDot24Hour } from './us-dot-24h.js';

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

export function assessChange(input: ChangeManagementInput): ChangeManagementOutput {
  const now = currentTime(input);
  const orig = input.original_ticket;
  const req = input.requested_itinerary;
  const currency = orig.base_fare_currency;
  const isInvoluntary = input.is_involuntary === true;

  const usDot24h = assessUsDot24Hour(input, now);

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
      forfeited_amount: orig.base_fare,
      tax_difference: '0.00',
      total_due: '0.00',
      currency,
      summary: `Change not permitted for fare basis ${orig.fare_basis}. This fare type does not allow voluntary changes (filed Cat31 rejection).`,
      is_free_change: false,
    };
    return { assessment, us_dot_24h: usDot24h };
  }

  const rule = input.cat31_rules
    ? findMatchingRule(input.cat31_rules.rules, orig.fare_basis)
    : undefined;

  // Penalty source-of-truth:
  //   1. Filed Cat31 rule for this fare basis  → rule.change_fee
  //   2. No rule + involuntary                  → 0 (carrier-initiated)
  //   3. No rule + voluntary                    → 0 (ATPCO default)
  // The previous "$200 default when no rule" path was an invention.
  const changeFeeAmount = rule ? new Decimal(rule.change_fee) : new Decimal('0.00');
  const freeChangeHours = rule?.free_change_hours ?? 0;
  const forfeitOnDowngrade = rule?.forfeit_difference_on_downgrade ?? false;

  // Cat 31 filed free-change window ONLY — not US DOT 24h (§259.5(b)(4)).
  const isFreeChange = isWithinFreeChangeWindow(orig.booking_date, now, freeChangeHours);

  // Check waiver code
  const hasWaiver = !!input.waiver_code;

  // Effective change fee: 0 if free window, waiver, or involuntary; else the filed amount.
  const effectiveChangeFee =
    isFreeChange || hasWaiver || isInvoluntary ? new Decimal('0.00') : changeFeeAmount;

  // Fare difference
  const originalFare = new Decimal(orig.base_fare);
  const newFare = new Decimal(req.new_fare);
  const fareDifference = newFare.minus(originalFare);

  // Tax difference
  const originalTax = new Decimal(orig.total_tax);
  const newTax = new Decimal(req.new_tax);
  const taxDifference = newTax.minus(originalTax);

  // Residual value: original fare minus penalty
  const residualValue = originalFare.minus(effectiveChangeFee);

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
  if (hasWaiver) summaryParts.push(`Waiver code ${input.waiver_code!} applied — penalty waived.`);
  if (!rule && !input.cat31_rules)
    summaryParts.push('No Cat31 rules supplied — applying ATPCO default (no charge).');
  if (effectiveChangeFee.greaterThan(0))
    summaryParts.push(`Change fee: ${currency} ${effectiveChangeFee.toFixed(2)}.`);
  if (additionalCollection.greaterThan(0))
    summaryParts.push(`Fare increase: ${currency} ${additionalCollection.toFixed(2)}.`);
  if (forfeitedAmount.greaterThan(0))
    summaryParts.push(`Forfeited on downgrade: ${currency} ${forfeitedAmount.toFixed(2)}.`);
  if (taxDue.greaterThan(0)) summaryParts.push(`Tax adjustment: ${currency} ${taxDue.toFixed(2)}.`);
  summaryParts.push(`Total due: ${currency} ${totalDue.toFixed(2)}.`);

  const assessment: ChangeAssessment = {
    original_ticket_number: orig.ticket_number,
    action,
    change_fee: effectiveChangeFee.toFixed(2),
    change_fee_currency: currency,
    fee_waived: isFreeChange || hasWaiver || isInvoluntary,
    ...(input.waiver_code !== undefined ? { waiver_code: input.waiver_code } : {}),
    fare_difference: fareDifference.toFixed(2),
    additional_collection: additionalCollection.toFixed(2),
    residual_value: residualValue.toFixed(2),
    forfeited_amount: forfeitedAmount.toFixed(2),
    tax_difference: taxDifference.toFixed(2),
    total_due: totalDue.toFixed(2),
    currency,
    summary: summaryParts.join(' '),
    is_free_change: isFreeChange,
  };

  return { assessment, us_dot_24h: usDot24h };
}
