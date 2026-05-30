/**
 * Tax Calculation Engine
 *
 * Per-segment tax computation with exemption engine.
 * All financial math uses decimal.js.
 */

import { Decimal } from 'decimal.js';
import type {
  TaxCalculationInput,
  TaxCalculationOutput,
  AppliedTax,
  TaxBreakdown,
  CountryTaxSummary,
  CabinClass,
  ExemptionType,
} from './types.js';
// JSON imported directly so esbuild inlines it into dist/index.js — using
// createRequire on the bundled output would fail with MODULE_NOT_FOUND when
// this package is consumed as a built dep.
import taxRatesJson from './data/tax-rates.json';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

interface TaxTier {
  class?: string;
  band?: string;
  destination?: string;
  amount: string;
  currency: string;
}

interface TaxRule {
  code: string;
  name: string;
  country: string;
  type: 'fixed' | 'percentage' | 'tiered';
  rate?: string;
  amount?: string;
  currency?: string;
  tiers?: TaxTier[];
  per: string;
  applies_to?: string;
  domestic_only: boolean;
  interlineable: boolean;
  carrier_specific?: boolean;
}

interface ExemptionRule {
  type: ExemptionType;
  description: string;
  exempt_from: string;
}

interface TaxData {
  taxes: TaxRule[];
  exemptions: ExemptionRule[];
  currency_conversions: Record<string, string>;
}

const taxData = taxRatesJson as unknown as TaxData;

// ---------------------------------------------------------------------------
// Country-to-airport mapping (simplified)
// ---------------------------------------------------------------------------

// TODO: [NEEDS DOMAIN INPUT] Real implementation needs full IATA airport-country database
const AIRPORT_COUNTRY: Record<string, string> = {
  JFK: 'US',
  LAX: 'US',
  SFO: 'US',
  ORD: 'US',
  MIA: 'US',
  ATL: 'US',
  DFW: 'US',
  SEA: 'US',
  BOS: 'US',
  EWR: 'US',
  LHR: 'GB',
  LGW: 'GB',
  MAN: 'GB',
  CDG: 'FR',
  ORY: 'FR',
  FRA: 'DE',
  MUC: 'DE',
  FCO: 'IT',
  MXP: 'IT',
  MAD: 'ES',
  BCN: 'ES',
  AMS: 'NL',
  DUB: 'IE',
  LIS: 'PT',
  ZRH: 'CH',
  GVA: 'CH',
  ARN: 'SE',
  OSL: 'NO',
  NRT: 'JP',
  HND: 'JP',
  KIX: 'JP',
  SIN: 'SG',
  SYD: 'AU',
  MEL: 'AU',
  YYZ: 'CA',
  YVR: 'CA',
  GRU: 'BR',
  GIG: 'BR',
  MEX: 'MX',
  CUN: 'MX',
  DXB: 'AE',
  AUH: 'AE',
  DEL: 'IN',
  BOM: 'IN',
  ICN: 'KR',
  GMP: 'KR',
  BKK: 'TH',
  AKL: 'NZ',
  JNB: 'ZA',
  CPT: 'ZA',
  RUH: 'SA',
  JED: 'SA',
  PEK: 'CN',
  PVG: 'CN',
  KUL: 'MY',
  HKG: 'HK',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCountryForAirport(iata: string, fallback: string): string {
  return AIRPORT_COUNTRY[iata] ?? fallback;
}

function getTaxesForCountry(country: string): TaxRule[] {
  return taxData.taxes.filter((t) => t.country === country);
}

function getConversionRate(from: string, to: string): Decimal {
  if (from === to) return new Decimal(1);

  const fromToUsd = taxData.currency_conversions[from];
  const toToUsd = taxData.currency_conversions[to];

  if (!fromToUsd || !toToUsd) return new Decimal(1);

  // from -> USD -> to: amount * (fromToUsd / toToUsd)
  return new Decimal(fromToUsd).div(new Decimal(toToUsd));
}

function resolveTieredAmount(
  tiers: TaxTier[],
  cabinClass: CabinClass,
  isDomestic: boolean,
  originCountry: string,
  destCountry: string,
): { amount: string; currency: string } | null {
  const classMap: Record<CabinClass, string> = {
    economy: 'economy',
    premium: 'premium',
    business: 'premium',
    first: 'premium',
  };
  const classKey = classMap[cabinClass];
  const isShort = originCountry === destCountry || isDomestic;
  const bandKey = isShort ? 'short' : 'long';

  // Tiers that have BOTH class AND band (e.g., GB APD)
  const classAndBandTiers = tiers.filter((t) => t.class !== undefined && t.band !== undefined);
  if (classAndBandTiers.length > 0) {
    const match = classAndBandTiers.find((t) => t.class === classKey && t.band === bandKey);
    if (match) return { amount: match.amount, currency: match.currency };
    // Fallback: match class only
    const classOnly = classAndBandTiers.find((t) => t.class === classKey);
    if (classOnly) return { amount: classOnly.amount, currency: classOnly.currency };
  }

  // Class-only tiers
  const classTier = tiers.find(
    (t) => t.class !== undefined && t.band === undefined && t.class === classKey,
  );
  if (classTier) return { amount: classTier.amount, currency: classTier.currency };

  // Band-only tiers
  const bandTier = tiers.find(
    (t) => t.band !== undefined && t.class === undefined && t.band === bandKey,
  );
  if (bandTier) return { amount: bandTier.amount, currency: bandTier.currency };
  const anyBand = tiers.find((t) => t.band !== undefined && t.class === undefined);
  if (anyBand) return { amount: anyBand.amount, currency: anyBand.currency };

  // Destination-based tiers
  const destTiers = tiers.filter((t) => t.destination !== undefined);
  if (destTiers.length > 0) {
    if (isDomestic) {
      const domestic = destTiers.find((t) => t.destination === 'domestic');
      if (domestic) return { amount: domestic.amount, currency: domestic.currency };
    }
    const last = destTiers[destTiers.length - 1]!;
    return { amount: last.amount, currency: last.currency };
  }

  // Fallback to first tier
  if (tiers.length > 0) {
    return { amount: tiers[0]!.amount, currency: tiers[0]!.currency };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Exemption engine
// ---------------------------------------------------------------------------

type ExemptCategory = 'all' | 'departure_taxes' | 'government_taxes' | 'carrier_surcharges';

function getActiveExemptions(input: TaxCalculationInput): ExemptionType[] {
  const active: ExemptionType[] = [];

  if (input.passenger_type === 'infant') active.push('infant');
  if (input.passenger_type === 'crew') active.push('crew');
  if (input.passenger_type === 'diplomatic') active.push('diplomatic');
  if (input.is_transit) active.push('transit');
  if (input.is_involuntary) active.push('involuntary');

  return active;
}

function isExempt(
  taxRule: TaxRule,
  activeExemptions: ExemptionType[],
): { exempt: boolean; reason: string | null } {
  for (const exemptionType of activeExemptions) {
    const rule = taxData.exemptions.find((e) => e.type === exemptionType);
    if (!rule) continue;

    const category = rule.exempt_from as ExemptCategory;

    if (category === 'all') {
      return { exempt: true, reason: rule.description };
    }

    if (category === 'departure_taxes' && taxRule.per === 'departure') {
      return { exempt: true, reason: rule.description };
    }

    if (category === 'government_taxes' && !taxRule.carrier_specific) {
      return { exempt: true, reason: rule.description };
    }

    if (category === 'carrier_surcharges' && taxRule.carrier_specific) {
      return { exempt: true, reason: rule.description };
    }
  }

  return { exempt: false, reason: null };
}

// ---------------------------------------------------------------------------
// Main calculation
// ---------------------------------------------------------------------------

export function calculateTaxes(input: TaxCalculationInput): TaxCalculationOutput {
  const appliedTaxes: AppliedTax[] = [];
  const activeExemptions = getActiveExemptions(input);
  const exemptionDescriptions: string[] = [];

  // Track which exemptions were actually used
  const usedExemptions = new Set<string>();

  // Process each segment
  for (let segIdx = 0; segIdx < input.segments.length; segIdx++) {
    const seg = input.segments[segIdx]!;

    const originCountry = getCountryForAirport(seg.origin, seg.origin_country);
    const destCountry = getCountryForAirport(seg.destination, seg.destination_country);
    const isDomestic = originCountry === destCountry;

    // Get departure taxes from origin country
    const departureTaxes = getTaxesForCountry(originCountry);
    // Get arrival taxes from destination country
    const arrivalTaxes = getTaxesForCountry(destCountry).filter((t) => t.per === 'arrival');

    // Also get international taxes (YQ/YR carrier surcharges)
    const intlTaxes = getTaxesForCountry('INTL');

    const allApplicable = [...departureTaxes, ...arrivalTaxes, ...intlTaxes];

    for (const taxRule of allApplicable) {
      // Skip domestic-only taxes for international segments
      if (taxRule.domestic_only && !isDomestic) continue;

      // Skip carrier-specific taxes with zero amount (placeholder)
      if (taxRule.carrier_specific && taxRule.amount === '0.00') continue;

      // Check per-type applicability
      if (taxRule.per === 'arrival' && taxRule.country !== destCountry) continue;
      if (taxRule.per === 'departure' && taxRule.country !== originCountry) continue;
      if (
        taxRule.per === 'segment' &&
        taxRule.country !== originCountry &&
        taxRule.country !== 'INTL'
      )
        continue;
      if (taxRule.per === 'enplanement' && taxRule.country !== originCountry) continue;

      // Check exemption
      const exemptResult = isExempt(taxRule, activeExemptions);
      if (exemptResult.exempt && exemptResult.reason) {
        usedExemptions.add(exemptResult.reason);
      }

      // Calculate amount
      let originalAmount: Decimal;
      let originalCurrency: string;

      if (taxRule.type === 'percentage') {
        // Percentage-based tax
        const rate = new Decimal(taxRule.rate!);
        const baseFare = new Decimal(seg.base_fare_nuc);
        originalAmount = baseFare.mul(rate).div(100);
        originalCurrency = 'NUC';
      } else if (taxRule.type === 'tiered' && taxRule.tiers) {
        const resolved = resolveTieredAmount(
          taxRule.tiers,
          seg.cabin_class,
          isDomestic,
          originCountry,
          destCountry,
        );
        if (!resolved) continue;
        originalAmount = new Decimal(resolved.amount);
        originalCurrency = resolved.currency;
      } else {
        // Fixed amount
        originalAmount = new Decimal(taxRule.amount!);
        originalCurrency = taxRule.currency!;
      }

      // If exempt, record with zero amount
      const effectiveAmount = exemptResult.exempt ? new Decimal(0) : originalAmount;

      // Convert to selling currency
      const convRate = getConversionRate(originalCurrency, input.selling_currency);
      const convertedAmount = effectiveAmount.mul(convRate);

      appliedTaxes.push({
        code: taxRule.code,
        name: taxRule.name,
        country: taxRule.country,
        type: taxRule.type,
        original_amount: originalAmount.toFixed(2),
        original_currency: originalCurrency,
        converted_amount: convertedAmount.toFixed(2),
        segment_indices: [segIdx],
        interlineable: taxRule.interlineable,
        exempt: exemptResult.exempt,
        exemption_reason: exemptResult.reason,
      });
    }
  }

  // Build breakdown
  const byCountry: Record<string, CountryTaxSummary> = {};
  let interlineableTotal = new Decimal(0);
  let nonInterlineableTotal = new Decimal(0);
  let totalTax = new Decimal(0);

  for (const tax of appliedTaxes) {
    const amount = new Decimal(tax.converted_amount);
    totalTax = totalTax.plus(amount);

    if (tax.interlineable) {
      interlineableTotal = interlineableTotal.plus(amount);
    } else {
      nonInterlineableTotal = nonInterlineableTotal.plus(amount);
    }

    if (!byCountry[tax.country]) {
      byCountry[tax.country] = { country: tax.country, total: '0.00', count: 0 };
    }
    const entry = byCountry[tax.country]!;
    entry.total = new Decimal(entry.total).plus(amount).toFixed(2);
    entry.count++;
  }

  const breakdown: TaxBreakdown = {
    by_country: byCountry,
    interlineable_total: interlineableTotal.toFixed(2),
    non_interlineable_total: nonInterlineableTotal.toFixed(2),
  };

  for (const desc of usedExemptions) {
    exemptionDescriptions.push(desc);
  }

  return {
    taxes: appliedTaxes,
    total_tax: totalTax.toFixed(2),
    currency: input.selling_currency,
    breakdown,
    exemptions_applied: exemptionDescriptions,
    segments_processed: input.segments.length,
  };
}
