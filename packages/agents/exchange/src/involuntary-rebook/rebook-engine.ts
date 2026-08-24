/**
 * Involuntary Rebook Engine — trigger assessment, protection candidates,
 * regulatory entitlements.
 *
 * Domain authority: docs/knowledge-base/involuntary-rebook-irrop.md
 * EU261: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32004R0261
 *
 * EU261 compensation is delegated to @otaip/core regulations/eu261, which
 * encodes published Art.7 constants (great-circle bands — never TPM).
 *
 * Art.8: when EU261 applies, passenger must be offered reimbursement vs
 * re-routing choice — do NOT silently select "same carrier first".
 *
 * US DOT 14 CFR §250 IDB applies only to involuntary denied boarding
 * (oversales) — NOT to delays/cancellations.
 *
 * // TODO: DOMAIN_QUESTION: DQ-IRROP-1 per-carrier IRROP threshold catalogue
 * // Do NOT hardcode 60 minutes as an industry standard.
 */

import { applyEU261 } from '@otaip/core';
import type {
  Art8Choice,
  InvoluntaryRebookInput,
  InvoluntaryRebookOutput,
  InvoluntaryRebookResult,
  InvoluntaryTrigger,
  IrropMeasurementPoint,
  ProtectionFlightOption,
  ProtectionOption,
  ProtectionPath,
  RegulatoryFlag,
} from './types.js';

// Plain ESM JSON import — esbuild/tsup inlines this into dist/index.js. Do NOT
// switch to `createRequire('./data/...json')`: tsup does not copy data files to
// dist, so a runtime require resolves nothing → MODULE_NOT_FOUND on import.
// (Guarded repo-wide by `pnpm verify:dist`.)
import euCountriesJson from './data/eu-countries.json';
const EU_COUNTRIES = new Set((euCountriesJson as { countries: string[] }).countries);

const ART8_CHOICES: Art8Choice[] = [
  'REIMBURSEMENT',
  'REROUTING_EARLIEST',
  'REROUTING_LATER',
];

// ---------------------------------------------------------------------------
// Trigger assessment — fail closed on unknown carrier thresholds
// ---------------------------------------------------------------------------

interface TriggerAssessment {
  isInvoluntary: boolean;
  trigger: InvoluntaryTrigger;
  /** Set when threshold / measurement input was needed but missing. */
  missingThreshold?: boolean;
  missingInputs?: string[];
  measurementPoint?: IrropMeasurementPoint;
}

function assessTrigger(input: InvoluntaryRebookInput): TriggerAssessment {
  const sc = input.schedule_change;

  if (input.is_passenger_no_show) {
    return { isInvoluntary: false, trigger: 'NO_SHOW' };
  }

  switch (sc.change_type) {
    case 'FLIGHT_CANCELLATION':
      return { isInvoluntary: true, trigger: 'FLIGHT_CANCELLATION' };

    case 'TIME_CHANGE': {
      const threshold = input.thresholds?.time_change_minutes;
      const measurementPoint = input.thresholds?.measurement_point;
      const missing: string[] = [];
      if (threshold === undefined) missing.push('thresholds.time_change_minutes');
      if (measurementPoint === undefined) missing.push('thresholds.measurement_point');
      if (missing.length > 0) {
        return {
          isInvoluntary: false,
          trigger: 'TIME_CHANGE',
          missingThreshold: true,
          missingInputs: missing,
        };
      }
      const minutes = sc.time_change_minutes ?? 0;
      return {
        isInvoluntary: minutes > threshold!,
        trigger: 'TIME_CHANGE',
        measurementPoint,
      };
    }

    case 'MISCONNECT': {
      // TODO: DOMAIN_QUESTION: DQ-IRROP-2 per-carrier MCT / misconnect definition
      const threshold = input.thresholds?.misconnect_minutes;
      if (threshold === undefined) {
        return {
          isInvoluntary: false,
          trigger: 'MISCONNECT',
          missingThreshold: true,
          missingInputs: ['thresholds.misconnect_minutes'],
        };
      }
      const shortfall = sc.misconnect_shortfall_minutes ?? 0;
      return {
        isInvoluntary: shortfall > 0 && shortfall >= threshold,
        trigger: 'MISCONNECT',
        measurementPoint: input.thresholds?.measurement_point ?? 'ARRIVAL',
      };
    }

    case 'ROUTING_CHANGE':
      return { isInvoluntary: true, trigger: 'ROUTING_CHANGE' };

    case 'EQUIPMENT_DOWNGRADE':
      // Equipment downgrade is flagged but not auto-involuntary — handled
      // separately via downgrade compensation rules (Agent 6.5 / Art.10).
      // TODO: DOMAIN_QUESTION: DQ-IRROP-6 downgrade → involuntary boundary
      return { isInvoluntary: false, trigger: 'EQUIPMENT_DOWNGRADE' };
  }
}

// ---------------------------------------------------------------------------
// Protection candidates — hierarchy pattern, endorsement fail-closed
// Do NOT silently execute "same carrier first" (Art.8 passenger choice).
// ---------------------------------------------------------------------------

function classifyFlight(
  f: ProtectionFlightOption,
): Exclude<ProtectionPath, 'NONE_AVAILABLE'> {
  const sameOperating = f.is_same_operating_carrier === true || f.is_same_carrier === true;
  if (sameOperating) return 'SAME_OPERATING';
  if (f.is_marketing_carrier === true) return 'MARKETING_CARRIER';
  if (f.is_alliance_partner) return 'ALLIANCE_PARTNER';
  if (f.is_interline) return 'INTERLINE';
  return 'OTHER';
}

function endorsementAllows(
  f: ProtectionFlightOption,
  path: Exclude<ProtectionPath, 'NONE_AVAILABLE'>,
): { allowed: boolean; needsInput: boolean } {
  if (path === 'SAME_OPERATING') {
    return { allowed: f.endorsement_allows !== false, needsInput: false };
  }
  // Fail closed: non–same-operating requires explicit endorsement_allows.
  if (f.endorsement_allows === undefined) {
    return { allowed: false, needsInput: true };
  }
  return { allowed: f.endorsement_allows, needsInput: false };
}

const PATH_NOTES: Record<Exclude<ProtectionPath, 'NONE_AVAILABLE'>, string> = {
  SAME_OPERATING: 'Same operating carrier — highest-ranked reprotection candidate.',
  MARKETING_CARRIER: 'Marketing carrier / codeshare — ranked after same operating.',
  ALLIANCE_PARTNER:
    'Alliance partner — only when endorsement/agreement permits (not any alliance flight).',
  INTERLINE: 'Interline / SPA involuntary protection candidate.',
  OTHER: 'Offline / other carrier — typically requires special authority.',
};

function buildProtectionOptions(
  input: InvoluntaryRebookInput,
): { options: ProtectionOption[]; endorsementWarnings: string[] } {
  if (!input.available_flights || input.available_flights.length === 0) {
    return { options: [], endorsementWarnings: [] };
  }

  const buckets: Record<Exclude<ProtectionPath, 'NONE_AVAILABLE'>, ProtectionOption[]> = {
    SAME_OPERATING: [],
    MARKETING_CARRIER: [],
    ALLIANCE_PARTNER: [],
    INTERLINE: [],
    OTHER: [],
  };
  const endorsementWarnings: string[] = [];

  for (const f of input.available_flights) {
    const path = classifyFlight(f);
    const { allowed, needsInput } = endorsementAllows(f, path);
    if (needsInput) {
      endorsementWarnings.push(
        `DOMAIN_INPUT_REQUIRED: endorsement_allows missing for ${f.carrier}${f.flight_number} (${path}) — excluded (fail closed).`,
      );
      continue;
    }
    if (!allowed) {
      endorsementWarnings.push(
        `Endorsement constraint excludes ${f.carrier}${f.flight_number} (${path}).`,
      );
      continue;
    }
    buckets[path].push({
      path,
      carrier: f.carrier,
      flight_number: f.flight_number,
      departure_date: f.departure_date,
      departure_time: f.departure_time,
      booking_class: f.booking_class,
      notes: PATH_NOTES[path],
    });
  }

  const options: ProtectionOption[] = [
    ...buckets.SAME_OPERATING,
    ...buckets.MARKETING_CARRIER,
    ...buckets.ALLIANCE_PARTNER,
    ...buckets.INTERLINE,
    ...buckets.OTHER,
  ];

  return { options, endorsementWarnings };
}

// ---------------------------------------------------------------------------
// Regulatory entitlements — Art.3 scope matrix (not "EU carrier anywhere")
// ---------------------------------------------------------------------------

function assessEu261Jurisdiction(input: InvoluntaryRebookInput): {
  applies: boolean;
  reason: string;
} {
  const pnr = input.original_pnr;
  const departureIsEu = EU_COUNTRIES.has(pnr.departure_country);
  const arrivalIsEu = EU_COUNTRIES.has(pnr.arrival_country);
  const isEuCarrier = pnr.is_eu_carrier;
  const thirdCountryBenefits =
    input.eu261_inputs?.third_country_benefits_already_received === true;

  // Art.3(1)(a): departing from Member State / EEA(+CH list) — any carrier.
  if (departureIsEu) {
    return {
      applies: true,
      reason: `Art.3(1)(a): departure from EU/EEA(+CH) country (${pnr.departure_country}) — applies to any operating carrier.`,
    };
  }

  // Art.3(1)(b): third country → Member State, Community carrier only.
  if (arrivalIsEu && isEuCarrier) {
    if (thirdCountryBenefits) {
      return {
        applies: false,
        reason:
          'Art.3(1)(b): Community carrier into EU/EEA, but passenger already received benefits/compensation/assistance in the third country of departure — regulation does not apply.',
      };
    }
    return {
      applies: true,
      reason: `Art.3(1)(b): arrival in EU/EEA(+CH) (${pnr.arrival_country}) on Community carrier (${pnr.affected_segment.operating_carrier ?? pnr.affected_segment.carrier}).`,
    };
  }

  if (arrivalIsEu && !isEuCarrier) {
    return {
      applies: false,
      reason: `Art.3(1)(b): arrival in EU/EEA(${pnr.arrival_country}) on non-Community carrier (${pnr.affected_segment.carrier}) — EU261 does not apply.`,
    };
  }

  return {
    applies: false,
    reason:
      'Non-EU departure and non-EU arrival (or non-Community carrier on inbound) — EU261 does not apply (Art.3(1)).',
  };
}

function assessRegulatory(
  input: InvoluntaryRebookInput,
  trigger: InvoluntaryTrigger,
): RegulatoryFlag[] {
  const flags: RegulatoryFlag[] = [];
  const jurisdiction = assessEu261Jurisdiction(input);

  if (!jurisdiction.applies) {
    flags.push({
      framework: 'EU261',
      applies: false,
      reason: jurisdiction.reason,
    });
  } else {
    const eu = input.eu261_inputs ?? {};
    const flightCancelled = trigger === 'FLIGHT_CANCELLATION';
    const missing: string[] = [];
    // Art.7(4): great-circle only — never TPM.
    if (eu.distance_km === undefined) missing.push('eu261_inputs.distance_km');
    if (!flightCancelled && eu.arrival_delay_hours === undefined) {
      missing.push('eu261_inputs.arrival_delay_hours');
    }
    if (eu.extraordinary_circumstances === undefined) {
      missing.push('eu261_inputs.extraordinary_circumstances');
    }
    if (flightCancelled && eu.notice_days_before_departure === undefined) {
      missing.push('eu261_inputs.notice_days_before_departure');
    }

    if (missing.length > 0) {
      flags.push({
        framework: 'EU261',
        applies: true,
        reason: `${jurisdiction.reason} Compensation not computed — see missing_inputs. Art.7 amounts require great-circle distance (Art.7(4)), never TPM.`,
        compensation_eur: null,
        reduction_percent: 0,
        missing_inputs: missing,
      });
    } else {
      const result = applyEU261({
        distanceKm: eu.distance_km!,
        arrivalDelayHours: flightCancelled ? 0 : eu.arrival_delay_hours!,
        extraordinaryCircumstances: eu.extraordinary_circumstances!,
        flightCancelled,
        ...(flightCancelled ? { noticeDaysBeforeDeparture: eu.notice_days_before_departure } : {}),
        ...(eu.rerouting_offered !== undefined ? { reroutingOffered: eu.rerouting_offered } : {}),
        ...(eu.rerouting_arrival_lateness_hours !== undefined
          ? { reroutingArrivalLatenessHours: eu.rerouting_arrival_lateness_hours }
          : {}),
      });
      flags.push({
        framework: 'EU261',
        applies: true,
        reason: `${jurisdiction.reason} ${result.reason}`,
        compensation_eur: result.eligible ? result.compensationEur : '0.00',
        reduction_percent: result.reductionPercent,
      });
    }
  }

  // US DOT 14 CFR §250 — IDB (oversales) ONLY.
  if (input.is_oversale_denied_boarding === true) {
    flags.push({
      framework: 'US_DOT',
      applies: true,
      reason:
        'US DOT 14 CFR §250: involuntary denied boarding due to oversales. Compensation via Agent 6.5 / applyUsDotIdb — not computed on the rebook path.',
    });
  } else {
    flags.push({
      framework: 'US_DOT',
      applies: false,
      reason:
        'US DOT 14 CFR §250 covers involuntary denied boarding (oversales) only — not delays, cancellations, or schedule changes. See Agent 6.5 (Feedback & Complaint) for IDB handling.',
    });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export function processInvoluntaryRebook(
  input: InvoluntaryRebookInput,
): InvoluntaryRebookOutput & { warnings?: string[] } {
  const assessment = assessTrigger(input);
  const { isInvoluntary, trigger } = assessment;
  const isNoShow = input.is_passenger_no_show === true;

  const { options: protectionOptions, endorsementWarnings } = isInvoluntary
    ? buildProtectionOptions(input)
    : { options: [], endorsementWarnings: [] };
  const protectionPath: ProtectionPath =
    protectionOptions.length > 0 ? protectionOptions[0]!.path : 'NONE_AVAILABLE';

  const regulatoryFlags = isInvoluntary ? assessRegulatory(input, trigger) : [];
  const eu261Applies = regulatoryFlags.some((f) => f.framework === 'EU261' && f.applies);
  // Art.8: when EU261 applies, passenger choice is mandatory — do not silently rebook.
  const art8Required = isInvoluntary && eu261Applies;
  const art8Choices: Art8Choice[] = art8Required ? [...ART8_CHOICES] : [];

  // Original routing credit: entitlement flag only — carrier implementation varies.
  // TODO: DOMAIN_QUESTION: DQ-IRROP-5 carrier-specific original routing credit
  const originalRoutingCredit = isInvoluntary && !isNoShow;

  const summaryParts: string[] = [];
  if (isNoShow) {
    summaryParts.push('Passenger no-show — involuntary protection does not apply.');
  } else if (isInvoluntary) {
    summaryParts.push(`Involuntary change: ${trigger.replace(/_/g, ' ').toLowerCase()}.`);
    if (art8Required) {
      summaryParts.push(
        'EU261 Art.8: passenger must choose reimbursement or re-routing — do not silently rebook same carrier.',
      );
    }
    if (protectionOptions.length > 0) {
      summaryParts.push(
        `Reprotection candidates (ranked, not executed): ${protectionPath.replace(/_/g, ' ').toLowerCase()} — ${protectionOptions[0]!.carrier}${protectionOptions[0]!.flight_number}${protectionOptions.length > 1 ? ` (+${protectionOptions.length - 1} more)` : ''}.`,
      );
    } else {
      summaryParts.push('No eligible protection candidates — manual handling required.');
    }
    for (const flag of regulatoryFlags) {
      if (flag.applies) {
        summaryParts.push(`${flag.framework} applies: ${flag.reason}`);
      }
    }
    if (originalRoutingCredit) {
      summaryParts.push('Original routing credit: passenger retains original fare basis (carrier-specific).');
    }
  } else if (assessment.missingThreshold) {
    summaryParts.push(
      `Fail-closed: ${trigger} assessment requires carrier-specific threshold input (${(assessment.missingInputs ?? []).join(', ')}). Treating as non-involuntary pending input. Do not hardcode 60 minutes.`,
    );
  } else {
    summaryParts.push(
      `Schedule change does not meet involuntary threshold (trigger: ${trigger.replace(/_/g, ' ').toLowerCase()}).`,
    );
  }

  const warnings: string[] = [...endorsementWarnings];
  if (assessment.missingThreshold) {
    for (const field of assessment.missingInputs ?? [
      'thresholds.time_change_minutes',
    ]) {
      warnings.push(
        `DOMAIN_INPUT_REQUIRED: ${field} is required for ${trigger} assessment (carrier-specific; no default). See docs/knowledge-base/involuntary-rebook-irrop.md.`,
      );
    }
  }
  if (art8Required) {
    warnings.push(
      'EU261 Art.8: offer passenger choice (REIMBURSEMENT | REROUTING_EARLIEST | REROUTING_LATER) before executing reprotection — do not silently select same carrier.',
    );
  }
  for (const flag of regulatoryFlags) {
    if (flag.applies && flag.missing_inputs && flag.missing_inputs.length > 0) {
      warnings.push(
        `DOMAIN_INPUT_REQUIRED: ${flag.framework} compensation needs ${flag.missing_inputs.join(', ')} (Art.7 great-circle distance, never TPM).`,
      );
    }
  }

  const result: InvoluntaryRebookResult = {
    is_involuntary: isInvoluntary,
    trigger,
    is_no_show: isNoShow,
    protection_options: protectionOptions,
    // Candidate ranking tip only — Art.8 forbids treating this as executed selection.
    protection_path: isInvoluntary ? protectionPath : 'NONE_AVAILABLE',
    art8_passenger_choice_required: art8Required,
    art8_choices: art8Choices,
    ...(assessment.measurementPoint !== undefined
      ? { measurement_point: assessment.measurementPoint }
      : {}),
    regulatory_flags: regulatoryFlags,
    original_routing_credit: originalRoutingCredit,
    summary: summaryParts.join(' '),
  };

  return warnings.length > 0 ? { result, warnings } : { result };
}
