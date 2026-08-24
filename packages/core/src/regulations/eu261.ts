/**
 * EU Regulation 261/2004 — passenger compensation for delays, cancellations,
 * and denied boarding on flights departing from the EU/EEA, or operated by
 * an EU/EEA carrier into the EU/EEA.
 *
 * Source: Regulation (EC) No 261/2004 of the European Parliament and Council
 * (11 February 2004). Articles referenced: 5 (cancellation), 6 (delay),
 * 7 (right to compensation), 8 (right to refund/rerouting), 9 (right to care).
 *
 * Constants below are PUBLISHED LAW. They are stable and intentionally
 * hardcoded. Do not adjust without a regulatory amendment citation.
 */

import Decimal from 'decimal.js';

/** Distance bands and compensation amounts (Article 7). */
export const EU261_BANDS = [
  { maxDistanceKm: 1500, compensationEur: 250, careDelayHours: 2 },
  { maxDistanceKm: 3500, compensationEur: 400, careDelayHours: 3 },
  { maxDistanceKm: Number.POSITIVE_INFINITY, compensationEur: 600, careDelayHours: 4 },
] as const;

/** Arrival delay (in hours) at the final destination that triggers compensation (Sturgeon line). */
export const EU261_DELAY_TRIGGER_HOURS = 3;

/**
 * For flights >3500 km whose arrival delay is between 3 and 4 hours, the
 * carrier may reduce compensation by 50% (Article 7(2)(c)).
 */
export const EU261_LONGHAUL_PARTIAL_REDUCTION = {
  distanceKm: 3500,
  delayHoursMin: 3,
  delayHoursMax: 4,
  reductionPct: 50,
} as const;

/** Cancellation compensation is owed when notice was given less than 14 days before departure. */
export const EU261_CANCELLATION_NOTICE_DAYS = 14;

/** Above this delay the passenger may choose a full refund instead of rerouting (Article 6(1)(iii)). */
export const EU261_REFUND_CHOICE_DELAY_HOURS = 5;

export interface EU261Input {
  /** Great-circle distance between origin and final destination (kilometres). */
  distanceKm: number;
  /** Arrival delay at the FINAL destination, in hours. */
  arrivalDelayHours: number;
  /** Whether the carrier invokes the "extraordinary circumstances" exemption (weather, ATC, security). */
  extraordinaryCircumstances: boolean;
  /** Was the flight cancelled? */
  flightCancelled: boolean;
  /** For cancellations: how many days before scheduled departure was the passenger notified? */
  noticeDaysBeforeDeparture?: number;
  /**
   * Article 7(2) rerouting reduction inputs. When the carrier offers
   * rerouting whose arrival exceeds the originally scheduled arrival by
   * no more than the band threshold (2h ≤1500km, 3h 1500-3500km,
   * 4h >3500km), compensation may be reduced by 50%.
   */
  reroutingOffered?: boolean;
  /** Hours by which the rerouted arrival exceeds the original scheduled arrival. */
  reroutingArrivalLatenessHours?: number;
}

export interface EU261Result {
  eligible: boolean;
  /** Compensation per passenger, in EUR (Decimal-safe string). */
  compensationEur: string;
  /** Reduction percentage applied (0 or 50). */
  reductionPercent: number;
  /** Right-to-care threshold (hours) for the applicable distance band. */
  careDelayHours: number;
  /** Whether the passenger may opt for a full refund (>=5h delay). */
  refundChoiceAvailable: boolean;
  /** Plain-English explanation. */
  reason: string;
}

function bandFor(distanceKm: number): (typeof EU261_BANDS)[number] {
  for (const band of EU261_BANDS) {
    if (distanceKm <= band.maxDistanceKm) return band;
  }
  // Unreachable — last band is +Infinity.
  return EU261_BANDS[EU261_BANDS.length - 1]!;
}

/**
 * Apply EU261/2004 to a single passenger journey.
 *
 * Pure function: callers are responsible for determining EU jurisdiction
 * (Art.3(1): departure from EU/EEA, or Community carrier inbound to EU/EEA).
 *
 * Distance inputs MUST be great-circle kilometres (Art.7(4)) — never TPM/MPM.
 */
export function applyEU261(input: EU261Input): EU261Result {
  const band = bandFor(input.distanceKm);

  if (input.extraordinaryCircumstances) {
    return {
      eligible: false,
      compensationEur: '0.00',
      reductionPercent: 0,
      careDelayHours: band.careDelayHours,
      refundChoiceAvailable: input.arrivalDelayHours >= EU261_REFUND_CHOICE_DELAY_HOURS,
      reason:
        'Extraordinary circumstances exemption (Article 5(3)): weather, ATC, security, or other event outside the carrier\'s control.',
    };
  }

  // Cancellation path: compensation owed when notice < 14 days.
  if (input.flightCancelled) {
    const notice = input.noticeDaysBeforeDeparture ?? 0;
    if (notice >= EU261_CANCELLATION_NOTICE_DAYS) {
      return {
        eligible: false,
        compensationEur: '0.00',
        reductionPercent: 0,
        careDelayHours: band.careDelayHours,
        refundChoiceAvailable: true,
        reason: `Cancellation notified ${notice} days before departure — no compensation owed (Article 5(1)(c) safe harbour ≥${EU261_CANCELLATION_NOTICE_DAYS} days).`,
      };
    }
    let amount = new Decimal(band.compensationEur);
    const reduction = computeReroutingReduction(input, band);
    let reasonExtra = '';
    if (reduction > 0) {
      amount = amount.mul(100 - reduction).div(100);
      reasonExtra = ` Reduced by ${reduction}% under Article 7(2) (rerouting offered within band threshold).`;
    }
    return {
      eligible: true,
      compensationEur: amount.toFixed(2),
      reductionPercent: reduction,
      careDelayHours: band.careDelayHours,
      refundChoiceAvailable: true,
      reason: `Cancellation notified ${notice} days before departure — €${band.compensationEur} per passenger (distance band ≤${band.maxDistanceKm}km).${reasonExtra}`,
    };
  }

  // Delay path: arrival delay must reach the trigger.
  if (input.arrivalDelayHours < EU261_DELAY_TRIGGER_HOURS) {
    return {
      eligible: false,
      compensationEur: '0.00',
      reductionPercent: 0,
      careDelayHours: band.careDelayHours,
      refundChoiceAvailable: input.arrivalDelayHours >= EU261_REFUND_CHOICE_DELAY_HOURS,
      reason: `Arrival delay ${input.arrivalDelayHours}h is below the ${EU261_DELAY_TRIGGER_HOURS}h compensation trigger.`,
    };
  }

  return buildDelayResult(input, band);
}

/**
 * Build the eligible delay/cancellation compensation result, applying
 * Article 7(2) rerouting reduction when applicable.
 */
function buildDelayResult(
  input: EU261Input,
  band: (typeof EU261_BANDS)[number],
): EU261Result {
  let amount = new Decimal(band.compensationEur);
  const reduction = computeReroutingReduction(input, band);
  let reasonExtra = '';
  if (reduction > 0) {
    amount = amount.mul(100 - reduction).div(100);
    reasonExtra = ` Reduced by ${reduction}% under Article 7(2) (rerouting offered within band threshold).`;
  }
  return {
    eligible: true,
    compensationEur: amount.toFixed(2),
    reductionPercent: reduction,
    careDelayHours: band.careDelayHours,
    refundChoiceAvailable: input.arrivalDelayHours >= EU261_REFUND_CHOICE_DELAY_HOURS,
    reason: `Arrival delay ${input.arrivalDelayHours}h ≥ ${EU261_DELAY_TRIGGER_HOURS}h trigger; distance band ≤${band.maxDistanceKm}km → €${band.compensationEur}.${reasonExtra}`,
  };
}

/**
 * Article 7(2) rerouting reduction: 50% if the carrier offers re-routing
 * whose arrival is within the band-specific threshold of the original
 * scheduled arrival.
 */
function computeReroutingReduction(
  input: EU261Input,
  band: (typeof EU261_BANDS)[number],
): number {
  if (!input.reroutingOffered) return 0;
  const lateness = input.reroutingArrivalLatenessHours;
  if (lateness === undefined) return 0;
  if (lateness <= band.careDelayHours) {
    return EU261_LONGHAUL_PARTIAL_REDUCTION.reductionPct;
  }
  return 0;
}

/**
 * Great-circle distance in kilometres between two lat/lon points (haversine).
 * Pure geometry — used to compute the EU261 distance band.
 */
export function greatCircleDistanceKm(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number },
): number {
  const R = 6371; // mean Earth radius in km
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(destination.latitude - origin.latitude);
  const dLon = toRad(destination.longitude - origin.longitude);
  const lat1 = toRad(origin.latitude);
  const lat2 = toRad(destination.latitude);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
