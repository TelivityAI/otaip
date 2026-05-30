/**
 * Involuntary Rebook Engine — trigger assessment, protection logic,
 * regulatory entitlements.
 *
 * EU261 compensation is delegated to @otaip/core regulations/eu261, which
 * encodes the published Regulation (EC) No 261/2004 constants.
 *
 * US DOT 14 CFR §250 IDB applies only to involuntary denied boarding
 * (oversales) — NOT to delays/cancellations. We therefore mark the US_DOT
 * flag as not-applicable on the rebook path even when a US touchpoint
 * exists, and reference the IDB module for callers who do hit oversales
 * (Agent 6.5 Feedback & Complaint).
 *
 * // DOMAIN_QUESTION: per-carrier IRROP threshold catalogue
 * // The 60-minute time-change threshold previously hardcoded here was
 * // a CLAUDE.md violation. Different carriers define IRROP triggers
 * // differently. Callers must supply `input.thresholds.time_change_minutes`
 * // when assessing a TIME_CHANGE; without it we conservatively report
 * // non-involuntary and emit a warning.
 */

import { applyEU261 } from '@otaip/core';
import type {
  InvoluntaryRebookInput,
  InvoluntaryRebookOutput,
  InvoluntaryRebookResult,
  InvoluntaryTrigger,
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

// ---------------------------------------------------------------------------
// Trigger assessment
// ---------------------------------------------------------------------------

interface TriggerAssessment {
  isInvoluntary: boolean;
  trigger: InvoluntaryTrigger;
  /** Set when threshold input was needed but missing. */
  missingThreshold?: boolean;
}

function assessTrigger(input: InvoluntaryRebookInput): TriggerAssessment {
  const sc = input.schedule_change;
  const threshold = input.thresholds?.time_change_minutes;

  if (input.is_passenger_no_show) {
    return { isInvoluntary: false, trigger: 'NO_SHOW' };
  }

  switch (sc.change_type) {
    case 'FLIGHT_CANCELLATION':
      return { isInvoluntary: true, trigger: 'FLIGHT_CANCELLATION' };

    case 'TIME_CHANGE': {
      if (threshold === undefined) {
        return { isInvoluntary: false, trigger: 'TIME_CHANGE', missingThreshold: true };
      }
      const minutes = sc.time_change_minutes ?? 0;
      return { isInvoluntary: minutes > threshold, trigger: 'TIME_CHANGE' };
    }

    case 'ROUTING_CHANGE':
      return { isInvoluntary: true, trigger: 'ROUTING_CHANGE' };

    case 'EQUIPMENT_DOWNGRADE':
      // Equipment downgrade is flagged but not auto-involuntary — handled
      // separately via downgrade compensation rules (Agent 6.5).
      return { isInvoluntary: false, trigger: 'EQUIPMENT_DOWNGRADE' };
  }
}

// ---------------------------------------------------------------------------
// Protection logic
// ---------------------------------------------------------------------------

function buildProtectionOptions(input: InvoluntaryRebookInput): ProtectionOption[] {
  if (!input.available_flights || input.available_flights.length === 0) {
    return [];
  }

  const options: ProtectionOption[] = [];

  // Priority 1: Same carrier
  const sameCarrier = input.available_flights.filter((f) => f.is_same_carrier);
  for (const f of sameCarrier) {
    options.push({
      path: 'SAME_CARRIER',
      carrier: f.carrier,
      flight_number: f.flight_number,
      departure_date: f.departure_date,
      departure_time: f.departure_time,
      booking_class: f.booking_class,
      notes: 'Same carrier — preferred protection option.',
    });
  }

  // Priority 2: Alliance partners
  const alliance = input.available_flights.filter(
    (f) => f.is_alliance_partner && !f.is_same_carrier,
  );
  for (const f of alliance) {
    options.push({
      path: 'ALLIANCE_PARTNER',
      carrier: f.carrier,
      flight_number: f.flight_number,
      departure_date: f.departure_date,
      departure_time: f.departure_time,
      booking_class: f.booking_class,
      notes: 'Alliance partner — secondary protection option.',
    });
  }

  // Priority 3: Interline
  const interline = input.available_flights.filter(
    (f) => f.is_interline && !f.is_same_carrier && !f.is_alliance_partner,
  );
  for (const f of interline) {
    options.push({
      path: 'INTERLINE',
      carrier: f.carrier,
      flight_number: f.flight_number,
      departure_date: f.departure_date,
      departure_time: f.departure_time,
      booking_class: f.booking_class,
      notes: 'Interline — last resort protection.',
    });
  }

  return options;
}

// ---------------------------------------------------------------------------
// Regulatory entitlements
// ---------------------------------------------------------------------------

function assessRegulatory(
  input: InvoluntaryRebookInput,
  trigger: InvoluntaryTrigger,
): RegulatoryFlag[] {
  const flags: RegulatoryFlag[] = [];
  const pnr = input.original_pnr;

  // EU261 jurisdiction: departing from EU/EEA, OR EU carrier (regardless of route).
  const departureIsEu = EU_COUNTRIES.has(pnr.departure_country);
  const isEuCarrier = pnr.is_eu_carrier;
  const eu261Applies = departureIsEu || isEuCarrier;

  if (!eu261Applies) {
    flags.push({
      framework: 'EU261',
      applies: false,
      reason: 'Non-EU departure and non-EU carrier — EU261 does not apply.',
    });
  } else {
    const eu = input.eu261_inputs ?? {};
    const flightCancelled = trigger === 'FLIGHT_CANCELLATION';
    const missing: string[] = [];
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

    const reasonPrefix = departureIsEu
      ? `Departure from EU/EEA country (${pnr.departure_country}).`
      : `EU carrier (${pnr.affected_segment.carrier}) — EU261 applies regardless of route.`;

    if (missing.length > 0) {
      flags.push({
        framework: 'EU261',
        applies: true,
        reason: `${reasonPrefix} Compensation not computed — see missing_inputs.`,
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
        reason: `${reasonPrefix} ${result.reason}`,
        compensation_eur: result.eligible ? result.compensationEur : '0.00',
        reduction_percent: result.reductionPercent,
      });
    }
  }

  // US DOT 14 CFR §250 — IDB (oversales) ONLY. Delays/cancellations are
  // not denied-boarding events. We surface this as not-applicable on the
  // rebook path even when the route touches the US.
  flags.push({
    framework: 'US_DOT',
    applies: false,
    reason:
      'US DOT 14 CFR §250 covers involuntary denied boarding (oversales) only — not delays or cancellations. See Agent 6.5 (Feedback & Complaint) for IDB handling.',
  });

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

  const protectionOptions = isInvoluntary ? buildProtectionOptions(input) : [];
  const protectionPath: ProtectionPath =
    protectionOptions.length > 0 ? protectionOptions[0]!.path : 'NONE_AVAILABLE';

  const regulatoryFlags = isInvoluntary ? assessRegulatory(input, trigger) : [];

  // Original routing credit: passenger retains original fare basis when
  // rebooked involuntarily. Carrier-specific implementation varies — this
  // flag merely indicates entitlement, not the calculated residual.
  const originalRoutingCredit = isInvoluntary && !isNoShow;

  // Build summary
  const summaryParts: string[] = [];
  if (isNoShow) {
    summaryParts.push('Passenger no-show — involuntary protection does not apply.');
  } else if (isInvoluntary) {
    summaryParts.push(`Involuntary change: ${trigger.replace('_', ' ').toLowerCase()}.`);
    if (protectionOptions.length > 0) {
      summaryParts.push(
        `Protection: ${protectionPath.replace('_', ' ').toLowerCase()} — ${protectionOptions[0]!.carrier}${protectionOptions[0]!.flight_number}.`,
      );
    } else {
      summaryParts.push('No protection flights available — manual rebooking required.');
    }
    for (const flag of regulatoryFlags) {
      if (flag.applies) {
        summaryParts.push(`${flag.framework} applies: ${flag.reason}`);
      }
    }
    if (originalRoutingCredit) {
      summaryParts.push('Original routing credit: passenger retains original fare basis.');
    }
  } else if (assessment.missingThreshold) {
    summaryParts.push(
      'TIME_CHANGE assessment requires input.thresholds.time_change_minutes (carrier-specific). Treating as non-involuntary pending input.',
    );
  } else {
    summaryParts.push(
      `Schedule change does not meet involuntary threshold (trigger: ${trigger.replace('_', ' ').toLowerCase()}).`,
    );
  }

  const warnings: string[] = [];
  if (assessment.missingThreshold) {
    warnings.push(
      'DOMAIN_INPUT_REQUIRED: thresholds.time_change_minutes is required for TIME_CHANGE assessment. See @otaip/core domain/types.ts.',
    );
  }
  for (const flag of regulatoryFlags) {
    if (flag.applies && flag.missing_inputs && flag.missing_inputs.length > 0) {
      warnings.push(
        `DOMAIN_INPUT_REQUIRED: ${flag.framework} compensation needs ${flag.missing_inputs.join(', ')}.`,
      );
    }
  }

  const result: InvoluntaryRebookResult = {
    is_involuntary: isInvoluntary,
    trigger,
    is_no_show: isNoShow,
    protection_options: protectionOptions,
    protection_path: isInvoluntary ? protectionPath : 'NONE_AVAILABLE',
    regulatory_flags: regulatoryFlags,
    original_routing_credit: originalRoutingCredit,
    summary: summaryParts.join(' '),
  };

  return warnings.length > 0 ? { result, warnings } : { result };
}
