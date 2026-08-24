/**
 * Tax carryforward decisions for Agent 5.2 Exchange/Reissue.
 *
 * Authoritative KB: docs/knowledge-base/tax-carryforward-reissue.md
 * IATA TTFC: https://www.iata.org/en/programs/airline-distribution/taxation/ticket-taxes/
 *
 * Same O&D ≠ keep all TFCs. Decide per tax code.
 * YQ/YR: do not assume carryforward.
 * IROE ≠ ICER — this module does not convert currencies or invent rates.
 *
 * // DOMAIN_QUESTION: DQ-TC1–TC4 in the KB (nature mapping, ICER feed, YQ/YR catalogue).
 */

import type {
  TaxCarryforwardAction,
  TaxCarryforwardContext,
  TaxCarryforwardDecision,
  TaxCarryforwardRule,
  TaxItem,
} from './types.js';

/** Carrier-imposed surcharge codes that must never silently CARRY from same O&D. */
export const CARRIER_IMPOSED_SURCHARGE_CODES = new Set(['YQ', 'YR']);

export class TaxCarryforwardRuleMissingError extends Error {
  readonly code = 'TAX_CARRYFORWARD_RULE_MISSING';

  constructor(
    public readonly taxCode: string,
    message?: string,
  ) {
    super(
      message ??
        `No tax carryforward rule for code ${taxCode}. Fail closed — do not assume CARRY from same O&D. Supply a rule from TTBS/ATPCO/SITA.`,
    );
    this.name = 'TaxCarryforwardRuleMissingError';
  }
}

function geographySatisfies(
  match: TaxCarryforwardContext['geography_match'],
  min: TaxCarryforwardRule['min_geography'],
): boolean {
  if (match === 'DIFFERENT') return false;
  if (min === 'SAME_AIRPORT') return match === 'SAME_AIRPORT';
  // min === SAME_CITY: SAME_AIRPORT or SAME_CITY both satisfy
  return match === 'SAME_AIRPORT' || match === 'SAME_CITY';
}

/**
 * Decide CARRY | RECALCULATE | FORFEIT for one tax code.
 * Does not invent amounts — only the action.
 */
export function decideTaxCarryforward(
  taxCode: string,
  rule: TaxCarryforwardRule | undefined,
  context: TaxCarryforwardContext,
): TaxCarryforwardDecision {
  if (!rule) {
    throw new TaxCarryforwardRuleMissingError(taxCode);
  }

  const isCarrierImposed = CARRIER_IMPOSED_SURCHARGE_CODES.has(taxCode.toUpperCase());

  // YQ/YR: never assume carryforward (KB). Require explicit_carry_authorized.
  if (isCarrierImposed && rule.explicit_carry_authorized !== true) {
    return {
      tax_code: taxCode,
      action: 'RECALCULATE',
      reason:
        'YQ/YR carrier-imposed surcharge: do not assume carryforward; recalculate unless carrier rule sets explicit_carry_authorized.',
    };
  }

  if (rule.carry_never === true) {
    return {
      tax_code: taxCode,
      action: 'RECALCULATE',
      reason: `Rule for ${taxCode} sets carry_never; recalculate from TTBS/ATPCO/SITA.`,
    };
  }

  if (!context.within_validity_window) {
    const action: TaxCarryforwardAction =
      rule.on_validity_expired === 'FORFEIT' ? 'FORFEIT' : 'RECALCULATE';
    return {
      tax_code: taxCode,
      action,
      reason: `Tax validity window does not cover new travel; ${action} per rule (not same-O&D boolean).`,
    };
  }

  if (
    context.flown_status === 'PARTIALLY_FLOWN' &&
    rule.recalculate_when_partially_flown === true
  ) {
    return {
      tax_code: taxCode,
      action: 'RECALCULATE',
      reason: `Partially flown itinerary forces RECALCULATE for ${taxCode}.`,
    };
  }

  if (
    rule.nature === 'SALES' &&
    rule.recalculate_when_pos_changed === true &&
    !context.point_of_sale_unchanged
  ) {
    return {
      tax_code: taxCode,
      action: 'RECALCULATE',
      reason: `Sales tax ${taxCode}: point of sale changed; reassess (transport vs sales).`,
    };
  }

  if (!geographySatisfies(context.geography_match, rule.min_geography)) {
    return {
      tax_code: taxCode,
      action: 'RECALCULATE',
      reason: `Geography ${context.geography_match} does not meet min_geography ${rule.min_geography} for ${taxCode}; same O&D city is not enough when airport-bound.`,
    };
  }

  // Carrier-imposed with explicit authorization still needs geography/validity above.
  if (isCarrierImposed && rule.explicit_carry_authorized === true) {
    return {
      tax_code: taxCode,
      action: 'CARRY',
      reason: `YQ/YR carry explicitly authorized by carrier rule; dimensions satisfied.`,
    };
  }

  return {
    tax_code: taxCode,
    action: 'CARRY',
    reason: `Dimensions satisfied for ${taxCode} (${rule.nature}; geography ${context.geography_match}).`,
  };
}

/**
 * Collect every tax code on original ∪ new; fail closed if any lack a rule.
 */
export function collectTaxCodes(originalTaxes: TaxItem[], newTaxes: TaxItem[]): string[] {
  const codes = new Set<string>();
  for (const t of originalTaxes) codes.add(t.code);
  for (const t of newTaxes) codes.add(t.code);
  return [...codes];
}

export function indexRulesByCode(
  rules: TaxCarryforwardRule[],
): Map<string, TaxCarryforwardRule> {
  const map = new Map<string, TaxCarryforwardRule>();
  for (const r of rules) {
    map.set(r.tax_code, r);
  }
  return map;
}

/**
 * Produce ordered per-tax decisions for all codes on the reissue.
 * Throws TaxCarryforwardRuleMissingError when a code has no rule.
 */
export function decideAllTaxCarryforwards(
  originalTaxes: TaxItem[],
  newTaxes: TaxItem[],
  rules: TaxCarryforwardRule[],
  context: TaxCarryforwardContext,
): TaxCarryforwardDecision[] {
  const ruleMap = indexRulesByCode(rules);
  const codes = collectTaxCodes(originalTaxes, newTaxes);
  const decisions: TaxCarryforwardDecision[] = [];

  for (const code of codes) {
    decisions.push(decideTaxCarryforward(code, ruleMap.get(code), context));
  }

  return decisions;
}
