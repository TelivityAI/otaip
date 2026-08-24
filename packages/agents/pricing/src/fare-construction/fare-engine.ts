/**
 * Fare Construction Engine — NUC × IROE pipeline with fail-closed data deps.
 *
 * Authoritative KB:
 *   docs/knowledge-base/fare-construction-data-dependencies.md
 *
 * BANS (CLAUDE.md Agent 2.2 / issue #151):
 * - No hardcoded IROE in this module (caller supplies licensed feed).
 * - No haversine / great-circle as TPM.
 * - No IEEE banker's / half-to-even rounding as IATA 024d.
 * - No inventing HIP/BHC/CTM comparison rules.
 *
 * Missing IROE, published TPM/MPM, or 024d rounding → DomainInputRequired.
 */

import { Decimal } from 'decimal.js';
import { domainInputRequired, isDomainInputRequired } from '@otaip/core';
import type {
  FareConstructionInput,
  FareConstructionResult,
  FareConstructionDataSources,
  MileageCheck,
  MileageSurcharge,
  HipCheck,
  BhcCheck,
  CtmCheck,
  AuditStep,
  Rounding024dRule,
  Rounding024dMethod,
  PublishedCityPairMileage,
} from './types.js';

export { isDomainInputRequired };

// ---------------------------------------------------------------------------
// Explicit bans (documented + testable)
// ---------------------------------------------------------------------------

/**
 * TPM must come from the IATA TPM Manual (or equivalent licensed feed).
 * Haversine / great-circle distance is NOT TPM.
 *
 * @see https://www.iata.org/en/publications/manuals/mileage/ticketed-point-mileage-tpm/
 */
export const HAVERSINE_AS_TPM_BANNED =
  'BAN: haversine/great-circle distance must never be used as TPM. Use published IATA TPM.';

/**
 * IROE must be ingested from the licensed monthly (periodic) IATA feed.
 * Hardcoded rates in the engine module graph are forbidden.
 */
export const HARDCODED_IROE_BANNED =
  'BAN: no hardcoded IROE in production. Pass licensed rates via data_sources.iroe.';

/**
 * Resolution 024d uses HX/NX — not banker's (half-to-even) rounding.
 */
export const BANKERS_ROUNDING_AS_IATA_BANNED =
  "BAN: IEEE banker's / half-to-even rounding is not Resolution 024d. Use HX or NX from the licensed table.";

/** Reject any attempt to mark mileage as haversine-sourced. */
export function assertPublishedTpmSource(source: string): void {
  const normalized = source.trim().toLowerCase();
  if (
    normalized.includes('haversine') ||
    normalized.includes('great-circle') ||
    normalized.includes('great_circle') ||
    normalized.includes('geodesic')
  ) {
    throw new Error(HAVERSINE_AS_TPM_BANNED);
  }
}

// ---------------------------------------------------------------------------
// Lookups (from caller-supplied licensed data only)
// ---------------------------------------------------------------------------

function findMileage(
  mileage: PublishedCityPairMileage[],
  origin: string,
  destination: string,
): PublishedCityPairMileage | undefined {
  return mileage.find(
    (cp) =>
      (cp.origin === origin && cp.destination === destination) ||
      (cp.origin === destination && cp.destination === origin),
  );
}

function getIroe(sources: FareConstructionDataSources, currency: string): Decimal | null {
  const rate = sources.iroe[currency];
  if (rate === undefined || rate === '') return null;
  return new Decimal(rate);
}

function getRounding024d(
  sources: FareConstructionDataSources,
  currency: string,
): Rounding024dRule | null {
  const rule = sources.rounding_024d[currency];
  if (!rule) return null;
  if (rule.method !== 'HX' && rule.method !== 'NX') return null;
  if (!rule.unit) return null;
  return rule;
}

/**
 * Apply Resolution 024d rounding for a supplied unit + method.
 * Mechanical HX/NX only — does not invent which currency uses which rule.
 *
 * HX: round up to next higher unit unless already exact.
 * NX: round to nearest unit (half away from zero / commercial half-up).
 * Banker's (half-to-even) is explicitly not used.
 */
export function apply024dRounding(
  amount: Decimal,
  rule: Rounding024dRule,
): Decimal {
  const unit = new Decimal(rule.unit);
  if (unit.lte(0)) {
    throw new Error('024d rounding unit must be positive');
  }

  const divided = amount.div(unit);

  if (rule.method === 'HX') {
    // Round up to next higher unit unless already exact.
    if (divided.isInteger()) return amount;
    return divided.ceil().mul(unit);
  }

  // NX — nearest unit. Half rounds away from zero (not banker's half-to-even).
  const sign = divided.isNegative() ? -1 : 1;
  const abs = divided.abs();
  const floor = abs.floor();
  const frac = abs.minus(floor);
  const half = new Decimal('0.5');
  const roundedAbs = frac.gte(half) ? floor.plus(1) : floor;
  return roundedAbs.mul(sign).mul(unit);
}

function missingDataSourcesResult() {
  return domainInputRequired({
    missing: [
      'data_sources.iroe',
      'data_sources.rounding_024d',
      'data_sources.mileage',
    ],
    description:
      'Fare construction requires licensed IROE, Resolution 024d rounding, and published TPM/MPM via data_sources. No hardcoded rates or haversine substitutes.',
    references: [
      'IATA Rates of Exchange (IROE)',
      'IATA Resolution 024d',
      'https://www.iata.org/en/publications/manuals/mileage/ticketed-point-mileage-tpm/',
      'docs/knowledge-base/fare-construction-data-dependencies.md',
    ],
  });
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export function constructFare(input: FareConstructionInput): FareConstructionResult {
  const audit: AuditStep[] = [];
  let stepNum = 0;

  function addStep(name: string, description: string, inputVal: string, outputVal: string): void {
    stepNum++;
    audit.push({ step: stepNum, name, description, input: inputVal, output: outputVal });
  }

  // Step 1: Validate components present (schema validated by agent)
  addStep(
    'Validate Components',
    `${input.components.length} fare component(s), journey type ${input.journey_type}`,
    JSON.stringify(input.components.map((c) => `${c.origin}-${c.destination}`)),
    'valid',
  );

  // Step 2: Require licensed data_sources (fail closed — no bundled IROE/TPM)
  const sources = input.data_sources;
  if (
    !sources ||
    !sources.iroe ||
    !sources.rounding_024d ||
    !Array.isArray(sources.mileage)
  ) {
    addStep(
      'Data Sources',
      'Licensed IROE / 024d / TPM-MPM not provided',
      'data_sources',
      'DOMAIN_INPUT_REQUIRED',
    );
    return missingDataSourcesResult();
  }

  addStep(
    'Data Sources',
    'Caller-supplied licensed IROE, 024d, and TPM/MPM present',
    `iroe_keys=${Object.keys(sources.iroe).length}; mileage_rows=${sources.mileage.length}`,
    'ok',
  );

  // Step 3: Sum NUC amounts
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

  // Step 4: Published TPM/MPM lookup — fail closed if any pair missing
  const mileageChecks: MileageCheck[] = [];
  const missingTpm: string[] = [];
  let totalTpm = 0;
  let totalMpm = 0;

  for (const comp of input.components) {
    const cp = findMileage(sources.mileage, comp.origin, comp.destination);
    if (cp) {
      mileageChecks.push({
        origin: comp.origin,
        destination: comp.destination,
        tpm: cp.tpm,
        mpm: cp.mpm,
        data_available: true,
      });
      totalTpm += cp.tpm;
      totalMpm += cp.mpm;
    } else {
      missingTpm.push(`tpm:${comp.origin}-${comp.destination}`);
      mileageChecks.push({
        origin: comp.origin,
        destination: comp.destination,
        tpm: null,
        mpm: null,
        data_available: false,
      });
    }
  }

  if (missingTpm.length > 0) {
    addStep(
      'Mileage Validation',
      'Published TPM missing — refusing haversine substitute',
      missingTpm.join(', '),
      'DOMAIN_INPUT_REQUIRED',
    );
    return domainInputRequired({
      missing: missingTpm,
      description: `${HAVERSINE_AS_TPM_BANNED} Missing published TPM for: ${missingTpm.join(', ')}.`,
      references: [
        'https://www.iata.org/en/publications/manuals/mileage/ticketed-point-mileage-tpm/',
        'IATA Maximum Permitted Mileage Manual',
        'docs/knowledge-base/fare-construction-data-dependencies.md',
      ],
    });
  }

  addStep(
    'Mileage Validation',
    `TPM total: ${totalTpm}, MPM total: ${totalMpm}`,
    `${mileageChecks.length} segments`,
    `TPM=${totalTpm} MPM=${totalMpm}`,
  );

  // Step 5: MPM excess check (published mileages only)
  const mileageExceeded = totalMpm > 0 && totalTpm > totalMpm;
  const excessPct =
    totalMpm > 0 ? new Decimal(totalTpm).minus(totalMpm).div(totalMpm).mul(100).toNumber() : 0;

  addStep(
    'Mileage Excess Check',
    `Excess: ${excessPct.toFixed(1)}%`,
    `TPM=${totalTpm} vs MPM=${totalMpm}`,
    mileageExceeded ? `exceeded by ${excessPct.toFixed(1)}%` : 'within MPM',
  );

  // Step 6: Mileage surcharge (EMS bands — requires published TPM/MPM above)
  // TODO: DOMAIN_QUESTION: confirm EMS percentage bands against current IATA
  // mileage system documentation for each market; do not extend beyond 5% steps.
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

  // Step 7: HIP sketch — no invented comparison rules
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

  // Step 8: BHC sketch
  const bhcMissing =
    input.components.length > 1 ? ['geographic_direction_analysis:fare_components'] : [];
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

  // Step 9: CTM sketch — do NOT invent CTM = total_nuc
  const ctmMissing =
    input.journey_type === 'CT' && input.components.length >= 2
      ? ['circle_trip_minima_nuc:filed_half_rt_fares']
      : [];
  const ctmCheck: CtmCheck = {
    applies: false,
    ctm_nuc: null,
    description:
      ctmMissing.length > 0
        ? 'CTM check skipped — filed circle-trip minima not provided.'
        : 'CTM not applicable (not a multi-component circle trip)',
    ...(ctmMissing.length > 0 ? { missing_inputs: ctmMissing } : {}),
  };

  addStep(
    'CTM Check',
    ctmCheck.description,
    input.journey_type,
    ctmMissing.length > 0 ? 'skipped — domain input required' : 'N/A',
  );

  // Step 10: IROE lookup — no hardcoded fallback
  const iroe = getIroe(sources, input.selling_currency);
  if (!iroe) {
    addStep(
      'IROE Lookup',
      `No IROE for ${input.selling_currency} — refusing to construct fare.`,
      input.selling_currency,
      'DOMAIN_INPUT_REQUIRED',
    );
    return domainInputRequired({
      missing: [`iroe_table_entry:${input.selling_currency}`],
      description: `${HARDCODED_IROE_BANNED} No IROE entry for ${input.selling_currency}.`,
      references: [
        'IATA Rates of Exchange (IROE)',
        'docs/knowledge-base/fare-construction-data-dependencies.md',
      ],
    });
  }
  addStep(
    'IROE Lookup',
    `IROE for ${input.selling_currency}`,
    input.selling_currency,
    iroe.toFixed(6),
  );

  // Step 11: NUC × IROE = local currency
  const localRaw = totalNuc.mul(iroe);
  addStep(
    'NUC × IROE',
    `${totalNuc.toFixed(2)} × ${iroe.toFixed(6)}`,
    `NUC ${totalNuc.toFixed(2)}`,
    `${input.selling_currency} ${localRaw.toFixed(6)}`,
  );

  // Step 12: Resolution 024d rounding — no default unit / no banker's
  const roundingRule = getRounding024d(sources, input.selling_currency);
  if (!roundingRule) {
    addStep(
      '024d Rounding',
      `No 024d rule for ${input.selling_currency}`,
      input.selling_currency,
      'DOMAIN_INPUT_REQUIRED',
    );
    return domainInputRequired({
      missing: [`rounding_024d:${input.selling_currency}`],
      description: `${BANKERS_ROUNDING_AS_IATA_BANNED} No Resolution 024d entry for ${input.selling_currency}.`,
      references: [
        'IATA Resolution 024d',
        'docs/knowledge-base/fare-construction-data-dependencies.md',
      ],
    });
  }

  const localRounded = apply024dRounding(localRaw, roundingRule);
  const method: Rounding024dMethod = roundingRule.method;

  addStep(
    '024d Rounding',
    `${method} to nearest unit ${roundingRule.unit}`,
    localRaw.toFixed(6),
    localRounded.toString(),
  );

  // Step 13: Final result
  addStep(
    'Final Fare',
    `Constructed fare in ${input.selling_currency}`,
    `NUC ${totalNuc.toFixed(2)} × IROE ${iroe.toFixed(6)}`,
    `${input.selling_currency} ${localRounded.toString()}`,
  );

  const iroeStr = iroe.toFixed(6);

  return {
    total_nuc: totalNuc.toFixed(2),
    iroe: iroeStr,
    roe: iroeStr,
    local_amount_raw: localRaw.toFixed(6),
    local_amount: localRounded.toString(),
    currency: input.selling_currency,
    rounding_unit: roundingRule.unit,
    rounding_method: method,
    mileage_checks: mileageChecks,
    total_tpm: totalTpm,
    total_mpm: totalMpm,
    total_mph: totalMpm,
    mileage_exceeded: mileageExceeded,
    mileage_surcharge: mileageSurcharge,
    hip_check: hipCheck,
    bhc_check: bhcCheck,
    ctm_check: ctmCheck,
    audit_trail: audit,
  };
}
