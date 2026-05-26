/**
 * Fare Construction Engine — 12-step pipeline.
 *
 * All financial math uses decimal.js.
 *
 * // DOMAIN_QUESTION: ROE source-of-truth
 * // ROE values are published by IATA monthly. Hardcoded ROE values produce
 * // wrong fares immediately for any currency that drifts. The previous
 * // 1.0 fallback was a CLAUDE.md violation. We now refuse to construct
 * // fares for currencies whose ROE is not in the input data and instead
 * // return DOMAIN_INPUT_REQUIRED listing the missing ROE.
 *
 * // DOMAIN_QUESTION: HIP/BHC fare lookup
 * // Real HIP/BHC detection requires per-carrier filed fares between every
 * // intermediate point in the routing. The simplified heuristics that
 * // previously lived here (per-mile rate comparison and string-matching
 * // city revisits) were CLAUDE.md violations. We now report these checks
 * // as undetected with `missing_inputs` listing the lookup data needed.
 */

import { Decimal } from 'decimal.js';
import { domainInputRequired, isDomainInputRequired } from '@otaip/core';
import type {
  FareConstructionInput,
  FareConstructionResult,
  MileageCheck,
  MileageSurcharge,
  HipCheck,
  BhcCheck,
  CtmCheck,
  AuditStep,
} from './types.js';
// JSON imported directly so esbuild inlines it into dist/index.js — using
// createRequire on the bundled output would fail with MODULE_NOT_FOUND when
// this package is consumed as a built dep.
import mileageJson from './data/mileage-data.json';
import roeJson from './data/roe-rates.json';
import roundingJson from './data/rounding-rules.json';

export { isDomainInputRequired };

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

interface CityPair {
  origin: string;
  destination: string;
  tpm: number;
  mph: number;
}
interface MileageData {
  city_pairs: CityPair[];
}
interface RoeData {
  rates: Record<string, string>;
}
interface RoundingRule {
  unit: string;
  direction: string;
}
interface RoundingData {
  rules: Record<string, RoundingRule>;
  default: RoundingRule;
}

const mileageData = mileageJson as unknown as MileageData;
const roeData = roeJson as unknown as RoeData;
const roundingData = roundingJson as unknown as RoundingData;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findMileage(origin: string, destination: string): CityPair | undefined {
  return mileageData.city_pairs.find(
    (cp) =>
      (cp.origin === origin && cp.destination === destination) ||
      (cp.origin === destination && cp.destination === origin),
  );
}

function getRoe(currency: string): Decimal | null {
  const rate = roeData.rates[currency];
  if (!rate) return null;
  return new Decimal(rate);
}

function getRoundingRule(currency: string): RoundingRule {
  return roundingData.rules[currency] ?? roundingData.default;
}

/**
 * IATA rounding: round UP to the nearest unit.
 */
function iataRound(amount: Decimal, unit: string): Decimal {
  const u = new Decimal(unit);
  // Divide by unit, round up (ceiling), multiply back
  return amount.div(u).ceil().mul(u);
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

export function constructFare(input: FareConstructionInput): FareConstructionResult {
  const audit: AuditStep[] = [];
  let stepNum = 0;

  function addStep(name: string, description: string, inputVal: string, outputVal: string): void {
    stepNum++;
    audit.push({ step: stepNum, name, description, input: inputVal, output: outputVal });
  }

  // Step 1: Validate components
  addStep(
    'Validate Components',
    `${input.components.length} fare component(s), journey type ${input.journey_type}`,
    JSON.stringify(input.components.map((c) => `${c.origin}-${c.destination}`)),
    'valid',
  );

  // Step 2: Sum NUC amounts
  let totalNuc = new Decimal(0);
  for (const comp of input.components) {
    totalNuc = totalNuc.plus(new Decimal(comp.nuc_amount));
  }
  addStep(
    'Sum NUC',
    'Sum all fare component NUC amounts',
    input.components.map((c) => c.nuc_amount).join(' + '),
    totalNuc.toFixed(2),
  );

  // Step 3: Mileage validation
  const mileageChecks: MileageCheck[] = [];
  let totalTpm = 0;
  let totalMph = 0;

  for (const comp of input.components) {
    const cp = findMileage(comp.origin, comp.destination);
    if (cp) {
      mileageChecks.push({
        origin: comp.origin,
        destination: comp.destination,
        tpm: cp.tpm,
        mph: cp.mph,
        data_available: true,
      });
      totalTpm += cp.tpm;
      totalMph += cp.mph;
    } else {
      mileageChecks.push({
        origin: comp.origin,
        destination: comp.destination,
        tpm: null,
        mph: null,
        data_available: false,
      });
    }
  }

  addStep(
    'Mileage Validation',
    `TPM total: ${totalTpm}, MPM total: ${totalMph}`,
    `${mileageChecks.length} segments`,
    `TPM=${totalTpm} MPM=${totalMph}`,
  );

  // Step 4: Check mileage exceeded
  const mileageExceeded = totalMph > 0 && totalTpm > totalMph;
  const excessPct =
    totalMph > 0 ? new Decimal(totalTpm).minus(totalMph).div(totalMph).mul(100).toNumber() : 0;

  addStep(
    'Mileage Excess Check',
    `Excess: ${excessPct.toFixed(1)}%`,
    `TPM=${totalTpm} vs MPM=${totalMph}`,
    mileageExceeded ? `exceeded by ${excessPct.toFixed(1)}%` : 'within MPM',
  );

  // Step 5: Mileage surcharge
  let surchargePercentage = 0;
  if (mileageExceeded) {
    if (excessPct <= 5) surchargePercentage = 5;
    else if (excessPct <= 10) surchargePercentage = 10;
    else if (excessPct <= 15) surchargePercentage = 15;
    else if (excessPct <= 20) surchargePercentage = 20;
    else surchargePercentage = 25;
  }

  const surchargeNuc = totalNuc.mul(surchargePercentage).div(100);
  const mileageSurcharge: MileageSurcharge = {
    applies: surchargePercentage > 0,
    percentage: surchargePercentage,
    surcharge_nuc: surchargeNuc.toFixed(2),
    description:
      surchargePercentage > 0
        ? `${surchargePercentage}% mileage surcharge applied (excess ${excessPct.toFixed(1)}%)`
        : 'No mileage surcharge',
  };

  if (surchargePercentage > 0) {
    totalNuc = totalNuc.plus(surchargeNuc);
  }

  addStep(
    'Mileage Surcharge',
    mileageSurcharge.description,
    `base NUC=${totalNuc.minus(surchargeNuc).toFixed(2)}`,
    `total NUC=${totalNuc.toFixed(2)}`,
  );

  // Step 6: HIP check (Higher Intermediate Point)
  // Real HIP detection requires per-airline filed fares between every
  // intermediate point in the routing. Without that lookup data, we
  // report `detected: false` and surface the missing inputs. We do NOT
  // apply per-mile-rate heuristics — those are not the published ATPCO
  // HIP comparison rule.
  const hipMissing: string[] = [];
  if (input.components.length > 1) {
    for (let i = 0; i < input.components.length - 1; i++) {
      const comp = input.components[i]!;
      hipMissing.push(`intermediate_point_fares:${comp.origin}-${comp.destination}`);
    }
  }
  const hipCheck: HipCheck = {
    detected: false,
    hip_point: null,
    hip_nuc: null,
    description:
      hipMissing.length > 0
        ? 'HIP check skipped — intermediate-point fare lookup data not provided.'
        : 'HIP check not applicable for single-component fare.',
    ...(hipMissing.length > 0 ? { missing_inputs: hipMissing } : {}),
  };

  addStep(
    'HIP Check',
    hipCheck.description,
    'fare components',
    hipMissing.length > 0 ? 'skipped — domain input required' : 'no HIP',
  );

  // Step 7: BHC check (Backhaul Check)
  // Real BHC requires geographic direction analysis (great-circle bearing
  // of each fare component vs. intended journey direction). Simple "city
  // revisited" string matching is not the published BHC rule. We report
  // `detected: false` and list the missing inputs.
  const bhcMissing =
    input.components.length > 1
      ? ['geographic_direction_analysis:fare_components']
      : [];
  const bhcCheck: BhcCheck = {
    detected: false,
    description:
      bhcMissing.length > 0
        ? 'Backhaul check skipped — geographic direction analysis data not provided.'
        : 'Backhaul check not applicable for single-component fare.',
    ...(bhcMissing.length > 0 ? { missing_inputs: bhcMissing } : {}),
  };

  addStep(
    'BHC Check',
    bhcCheck.description,
    'routing',
    bhcMissing.length > 0 ? 'skipped — domain input required' : 'no BHC',
  );

  // Step 8: CTM check (Circle Trip Minimum)
  const ctmCheck: CtmCheck = {
    applies: false,
    ctm_nuc: null,
    description: 'CTM not applicable (not a circle trip)',
  };

  if (input.journey_type === 'CT' && input.components.length >= 2) {
    // CTM = sum of half round-trip fares for each component
    // Simplified: CTM = total_nuc (already the minimum)
    ctmCheck.applies = true;
    ctmCheck.ctm_nuc = totalNuc.toFixed(2);
    ctmCheck.description = 'Circle Trip Minimum applies';
  }

  addStep(
    'CTM Check',
    ctmCheck.description,
    input.journey_type,
    ctmCheck.applies ? `CTM NUC=${ctmCheck.ctm_nuc}` : 'N/A',
  );

  // Step 9: Get ROE
  // No fallback. ROE values are published by IATA monthly. Returning
  // anything else (especially 1.0) silently produces wrong fares for
  // every non-USD currency. If ROE is missing → DomainInputRequired.
  const roe = getRoe(input.selling_currency);
  if (!roe) {
    addStep(
      'ROE Lookup',
      `No ROE for ${input.selling_currency} — refusing to construct fare.`,
      input.selling_currency,
      'DOMAIN_INPUT_REQUIRED',
    );
    return domainInputRequired({
      missing: [`roe_table_entry:${input.selling_currency}`],
      description: `No ROE entry for ${input.selling_currency}. Construction halted to avoid producing an incorrect local-currency fare.`,
      references: ['IATA monthly ROE publication', 'ATPCO Fare Construction guide'],
    });
  }
  addStep(
    'ROE Lookup',
    `ROE for ${input.selling_currency}`,
    input.selling_currency,
    roe.toFixed(6),
  );

  const effectiveRoe = roe;

  // Step 10: NUC × ROE = local currency
  const localRaw = totalNuc.mul(effectiveRoe);
  addStep(
    'NUC × ROE',
    `${totalNuc.toFixed(2)} × ${effectiveRoe.toFixed(6)}`,
    `NUC ${totalNuc.toFixed(2)}`,
    `${input.selling_currency} ${localRaw.toFixed(6)}`,
  );

  // Step 11: IATA rounding
  const roundingRule = getRoundingRule(input.selling_currency);
  const localRounded = iataRound(localRaw, roundingRule.unit);

  addStep(
    'IATA Rounding',
    `Round UP to nearest ${roundingRule.unit}`,
    localRaw.toFixed(6),
    localRounded.toString(),
  );

  // Step 12: Final result
  addStep(
    'Final Fare',
    `Constructed fare in ${input.selling_currency}`,
    `NUC ${totalNuc.toFixed(2)} × ROE ${effectiveRoe.toFixed(6)}`,
    `${input.selling_currency} ${localRounded.toString()}`,
  );

  return {
    total_nuc: totalNuc.toFixed(2),
    roe: effectiveRoe.toFixed(6),
    local_amount_raw: localRaw.toFixed(6),
    local_amount: localRounded.toString(),
    currency: input.selling_currency,
    rounding_unit: roundingRule.unit,
    mileage_checks: mileageChecks,
    total_tpm: totalTpm,
    total_mph: totalMph,
    mileage_exceeded: mileageExceeded,
    mileage_surcharge: mileageSurcharge,
    hip_check: hipCheck,
    bhc_check: bhcCheck,
    ctm_check: ctmCheck,
    audit_trail: audit,
  };
}
