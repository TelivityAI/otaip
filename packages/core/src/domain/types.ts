/**
 * Shared "needs domain input" result type for engines that cannot proceed
 * without authoritative travel-domain data (ATPCO Cat 31/33 rules,
 * IATA ROE tables, regulatory inputs, etc.).
 *
 * Engines must NOT invent fares, penalties, compensation amounts, or
 * mileage values. When required inputs are absent and no published
 * regulatory default applies, return DomainInputRequired instead of
 * synthesizing a result.
 */

export interface DomainInputRequired {
  status: 'DOMAIN_INPUT_REQUIRED';
  /** Machine-readable list of missing inputs (e.g. ['atpco_cat31_rules', 'roe_table_entry:EUR']). */
  missing: string[];
  /** Human-readable explanation. */
  description: string;
  /** Authoritative references that would supply the missing inputs. */
  references: string[];
}

export function domainInputRequired(args: {
  missing: string[];
  description: string;
  references: string[];
}): DomainInputRequired {
  return { status: 'DOMAIN_INPUT_REQUIRED', ...args };
}

export function isDomainInputRequired(
  value: unknown,
): value is DomainInputRequired {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'DOMAIN_INPUT_REQUIRED'
  );
}

/**
 * Passenger residual / partial-refund valuation method (Agents 5.1 / 5.2 / 6.1).
 *
 * See `docs/knowledge-base/partial-refund-residual-value.md`.
 *
 * - FULLY_UNUSED — no flown coupons; residual/refundable base = ticketed base
 * - CAT33_THB — Historical Ticket Based (Cat 33 Re-Price Indicator A) flown valuation
 * - CARRIER_SPECIFIC — carrier residual formula amounts supplied by caller
 *
 * MPA-P / TPM / haversine / coupon-ratio / original−used without method are
 * explicitly rejected and must never appear as a successful method.
 */
export type PassengerResidualMethod =
  | 'FULLY_UNUSED'
  | 'CAT33_THB'
  | 'CARRIER_SPECIFIC';

/** Methods that engines must refuse (issue #150). */
export const REJECTED_PASSENGER_RESIDUAL_METHODS = [
  'ORIGINAL_MINUS_USED',
  'ORIGINAL_MINUS_CHANGE_FEE',
  'MPA_P',
  'HAVERSINE_THROUGH_FARE_SPLIT',
  'COUPON_COUNT_RATIO',
] as const;

export type RejectedPassengerResidualMethod =
  (typeof REJECTED_PASSENGER_RESIDUAL_METHODS)[number];

/**
 * Caller-supplied unused value after an explicit valuation method.
 * Engines apply Cat 31/33 penalties to these amounts — they do not invent them.
 */
export interface PassengerPartialValuation {
  method: Exclude<PassengerResidualMethod, 'FULLY_UNUSED'>;
  /** Unused base fare after THB / carrier valuation (decimal string). */
  unused_base_fare: string;
  /** Optional audit: flown base from THB / carrier valuation. */
  flown_base_fare?: string;
  /** Unused taxes by code — required for partial money paths. */
  unused_taxes: Array<{ code: string; amount: string; currency: string }>;
}
