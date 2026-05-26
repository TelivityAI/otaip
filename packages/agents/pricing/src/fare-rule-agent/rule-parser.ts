/**
 * Core logic for Fare Rule Agent.
 *
 * Loads ATPCO tariff snapshot and parses rules into structured format.
 */

import type {
  FareRuleInput,
  FareRuleResult,
  FareRuleOutput,
  FareRuleCategory,
  PenaltyRule,
  AdvancePurchaseRule,
  MinimumStayRule,
  MaximumStayRule,
  SeasonalityRule,
  BlackoutPeriod,
} from './types.js';
// JSON imported directly so esbuild inlines it into dist/index.js — using
// createRequire on the bundled output would fail with MODULE_NOT_FOUND when
// this package is consumed as a built dep.
import tariffJson from './data/atpco-tariff-snapshot.json';

// ---------------------------------------------------------------------------
// Types for raw JSON data
// ---------------------------------------------------------------------------

interface RawCategory {
  name: string;
  text: string;
  structured?: Record<string, unknown>;
}

interface RawRule {
  rule_id: string;
  carrier: string;
  fare_basis: string;
  market: { origin: string; destination: string };
  tariff: string;
  rule_number: string;
  effective_date: string;
  discontinue_date: string;
  categories: Record<string, RawCategory>;
}

interface TariffSnapshot {
  rules: RawRule[];
}

const tariffData = tariffJson as unknown as TariffSnapshot;

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

function matchRules(input: FareRuleInput): RawRule[] {
  return tariffData.rules.filter((rule) => {
    // Carrier match — exact only. YY industry fares only match when queried with carrier=YY.
    if (rule.carrier !== input.carrier) {
      return false;
    }

    // Fare basis match
    if (rule.fare_basis.toUpperCase() !== input.fare_basis.toUpperCase()) {
      return false;
    }

    // Market match (check both directions)
    const marketMatch =
      (rule.market.origin === input.origin && rule.market.destination === input.destination) ||
      (rule.market.origin === input.destination && rule.market.destination === input.origin);
    if (!marketMatch) {
      return false;
    }

    // Date filter — if travel_date provided, check effective range
    if (input.travel_date) {
      if (input.travel_date < rule.effective_date || input.travel_date > rule.discontinue_date) {
        return false;
      }
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// Category parsing
// ---------------------------------------------------------------------------

function parseCategories(
  rawCategories: Record<string, RawCategory>,
  requestedCategories?: number[],
): FareRuleCategory[] {
  const result: FareRuleCategory[] = [];

  for (const [catNum, cat] of Object.entries(rawCategories)) {
    const categoryNumber = parseInt(catNum, 10);

    // Filter to requested categories if specified
    if (requestedCategories && requestedCategories.length > 0) {
      if (!requestedCategories.includes(categoryNumber)) {
        continue;
      }
    }

    result.push({
      category_number: categoryNumber,
      name: cat.name,
      text: cat.text,
      structured: cat.structured ?? null,
    });
  }

  // Sort by category number
  result.sort((a, b) => a.category_number - b.category_number);

  return result;
}

// ---------------------------------------------------------------------------
// Quick-access extractors
// ---------------------------------------------------------------------------

function extractPenalty(categories: Record<string, RawCategory>): PenaltyRule | null {
  const cat16 = categories['16'];
  if (!cat16?.structured) return null;

  const s = cat16.structured;
  return {
    refundable: s['refundable'] === true,
    changeable: s['changeable'] === true,
    change_fee: (s['change_fee'] ?? null) as PenaltyRule['change_fee'],
    no_show_fee: (s['no_show_fee'] ?? null) as PenaltyRule['no_show_fee'],
  };
}

function extractAdvancePurchase(
  categories: Record<string, RawCategory>,
): AdvancePurchaseRule | null {
  const cat5 = categories['5'];
  if (!cat5?.structured) return null;

  const minDays = cat5.structured['min_days'];
  if (typeof minDays !== 'number') return null;

  return { min_days: minDays };
}

function extractMinStay(categories: Record<string, RawCategory>): MinimumStayRule | null {
  const cat6 = categories['6'];
  if (!cat6?.structured) return null;

  const s = cat6.structured;
  return {
    min_days: typeof s['min_days'] === 'number' ? s['min_days'] : 0,
    saturday_night_required: s['saturday_night_required'] === true,
  };
}

function extractMaxStay(categories: Record<string, RawCategory>): MaximumStayRule | null {
  const cat7 = categories['7'];
  if (!cat7?.structured) return null;

  const maxMonths = cat7.structured['max_months'];
  if (typeof maxMonths !== 'number') return null;

  return { max_months: maxMonths };
}

function extractSeasonality(categories: Record<string, RawCategory>): SeasonalityRule | null {
  const cat3 = categories['3'];
  if (!cat3?.structured) return null;

  const s = cat3.structured;
  if (!s['season']) return null;

  return {
    season: String(s['season']),
    valid_from: String(s['valid_from']),
    valid_to: String(s['valid_to']),
    blackout_dates: (s['blackout_dates'] as BlackoutPeriod[] | undefined) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Blackout check
// ---------------------------------------------------------------------------

function checkBlackout(travelDate: string, seasonality: SeasonalityRule | null): boolean | null {
  if (!seasonality || !travelDate) return null;

  for (const blackout of seasonality.blackout_dates) {
    if (travelDate >= blackout.from && travelDate <= blackout.to) {
      return true;
    }
  }

  return false;
}

function checkValidForDate(
  travelDate: string,
  seasonality: SeasonalityRule | null,
  effectiveDate: string,
  discontinueDate: string,
): boolean | null {
  if (!travelDate) return null;

  // Check effective range
  if (travelDate < effectiveDate || travelDate > discontinueDate) {
    return false;
  }

  // Check seasonal validity
  if (seasonality) {
    if (travelDate < seasonality.valid_from || travelDate > seasonality.valid_to) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function lookupFareRules(input: FareRuleInput): FareRuleOutput {
  const matched = matchRules(input);

  if (matched.length === 0) {
    return {
      rules: [],
      total_rules: 0,
      valid_for_date: null,
      in_blackout: null,
    };
  }

  const results: FareRuleResult[] = matched.map((rule) => {
    const categories = parseCategories(rule.categories, input.categories);
    const penaltySummary = extractPenalty(rule.categories);
    const advancePurchase = extractAdvancePurchase(rule.categories);
    const minimumStay = extractMinStay(rule.categories);
    const maximumStay = extractMaxStay(rule.categories);
    const seasonality = extractSeasonality(rule.categories);

    return {
      rule_id: rule.rule_id,
      carrier: rule.carrier,
      fare_basis: rule.fare_basis,
      market: rule.market,
      tariff: rule.tariff,
      rule_number: rule.rule_number,
      effective_date: rule.effective_date,
      discontinue_date: rule.discontinue_date,
      categories,
      penalty_summary: penaltySummary,
      advance_purchase: advancePurchase,
      minimum_stay: minimumStay,
      maximum_stay: maximumStay,
      seasonality,
    };
  });

  // Date validation based on first matched rule
  const firstRule = results[0]!;
  const validForDate = input.travel_date
    ? checkValidForDate(
        input.travel_date,
        firstRule.seasonality,
        firstRule.effective_date,
        firstRule.discontinue_date,
      )
    : null;
  const inBlackout = input.travel_date
    ? checkBlackout(input.travel_date, firstRule.seasonality)
    : null;

  return {
    rules: results,
    total_rules: results.length,
    valid_for_date: validForDate,
    in_blackout: inBlackout,
  };
}
