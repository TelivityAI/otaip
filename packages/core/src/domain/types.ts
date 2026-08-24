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
 * - PUBLISHED_FARE — caller-supplied unused/flown amounts from published fare
 *   for flown sectors (Cat 33 + IATA Ticketing Handbook practice; not MPA-P)
 * - CARRIER_SPECIFIC — carrier residual formula amounts supplied by caller
 *
 * Cat 33 absent / unmatched → free refund penalty (ATPCO public default) —
 * that is separate from requiring an explicit valuation method on partials.
 *
 * MPA-P / TPM / haversine / coupon-ratio / original−used without method are
 * explicitly rejected and must never appear as a successful method.
 *
 * Note: THB means the IATA Ticketing Handbook (cite by name only). Do not
 * invent alternate expansions of the acronym.
 */
export type PassengerResidualMethod =
  | 'FULLY_UNUSED'
  | 'PUBLISHED_FARE'
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
 * Engines apply Cat 33 penalties to these amounts — they do not invent them.
 * Cat 33 no-match still means penalty = 0 (free); missing method is fail-closed.
 */
export interface PassengerPartialValuation {
  method: Exclude<PassengerResidualMethod, 'FULLY_UNUSED'>;
  /** Unused base fare after published-fare / carrier valuation (decimal string). */
  unused_base_fare: string;
  /** Optional audit: flown base from that valuation. */
  flown_base_fare?: string;
  /** Unused taxes by code — required for partial money paths. */
  unused_taxes: Array<{ code: string; amount: string; currency: string }>;
}
