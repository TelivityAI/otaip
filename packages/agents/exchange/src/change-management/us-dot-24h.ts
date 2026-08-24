/**
 * US DOT 14 CFR §259.5(b)(4) — 24-hour reservation requirement.
 *
 * Hold OR cancel (carrier chooses — not both). Only when booked one week
 * or more prior to departure. Obligation is on covered air carriers.
 *
 * Knowledge base: docs/knowledge-base/us-dot-24-hour-reservation.md
 * Authority: https://www.govinfo.gov/content/pkg/CFR-2025-title14-vol4/pdf/CFR-2025-title14-vol4-part259.pdf
 *
 * This is NOT Cat 31 free change. Never set is_free_change from this module.
 */

import carrierRemedyJson from './data/us-dot-24h-carrier-remedy.json';
import type {
  ChangeManagementInput,
  UsDot24HourAssessment,
  UsDot24HourEntitlement,
  UsDot24HourIneligibilityReason,
  UsDot24HourRemedy,
  UsDot24HourCarrierRemedyRow,
} from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const DOT_WINDOW_HOURS = 24;

interface CarrierRemedyFile {
  carriers: UsDot24HourCarrierRemedyRow[];
}

const remedyByCarrier = new Map<string, UsDot24HourCarrierRemedyRow>();
for (const row of (carrierRemedyJson as CarrierRemedyFile).carriers) {
  remedyByCarrier.set(row.carrier_code, row);
}

export function lookupCarrierRemedy(carrierCode: string): UsDot24HourCarrierRemedyRow {
  const known = remedyByCarrier.get(carrierCode);
  if (known) return known;
  return {
    carrier_code: carrierCode,
    remedy: 'unknown',
    last_verified: null,
    source_url: null,
    notes: 'Carrier not in KB matrix — default unknown. Do not invent cancel vs hold.',
  };
}

function entitlementFor(remedy: UsDot24HourRemedy, eligible: boolean): UsDot24HourEntitlement {
  if (!eligible) return 'none';
  if (remedy === 'cancel') return 'penalty_free_cancel';
  if (remedy === 'hold') return 'unpaid_fare_hold';
  return 'unknown';
}

/**
 * Days from booking instant to departure instant, in whole 24h periods
 * (floor of millisecond delta / day). Null if either date missing/invalid.
 *
 * // TODO: DOMAIN_QUESTION: timezone when departure is date-only vs local scheduled time.
 */
export function daysBookingToDeparture(
  bookingIso: string | undefined,
  departureIso: string | undefined,
): number | null {
  if (!bookingIso || !departureIso) return null;
  const booking = new Date(bookingIso);
  const departure = new Date(departureIso);
  if (Number.isNaN(booking.getTime()) || Number.isNaN(departure.getTime())) return null;
  return Math.floor((departure.getTime() - booking.getTime()) / MS_PER_DAY);
}

export function meetsSevenDayAdvance(
  bookingIso: string | undefined,
  departureIso: string | undefined,
): boolean | null {
  if (!bookingIso || !departureIso) return null;
  const booking = new Date(bookingIso);
  const departure = new Date(departureIso);
  if (Number.isNaN(booking.getTime()) || Number.isNaN(departure.getTime())) return null;
  return departure.getTime() - booking.getTime() >= MS_PER_WEEK;
}

export function hoursSinceBooking(
  bookingIso: string | undefined,
  now: Date,
): number | null {
  if (!bookingIso) return null;
  const booking = new Date(bookingIso);
  if (Number.isNaN(booking.getTime())) return null;
  return (now.getTime() - booking.getTime()) / (1000 * 60 * 60);
}

/**
 * Assess DOT 24h entitlement. Independent of Cat 31 change fees.
 */
export function assessUsDot24Hour(
  input: ChangeManagementInput,
  now: Date,
): UsDot24HourAssessment {
  const orig = input.original_ticket;
  const ctx = input.us_dot_24h;
  const reasons: UsDot24HourIneligibilityReason[] = [];

  const row = lookupCarrierRemedy(orig.issuing_carrier);
  const carrierRemedy: UsDot24HourRemedy = row.remedy;

  const bookingDate = orig.booking_date;
  const departureDate = orig.original_departure_date;
  const days = daysBookingToDeparture(bookingDate, departureDate);
  const hours = hoursSinceBooking(bookingDate, now);
  const sevenDay = meetsSevenDayAdvance(bookingDate, departureDate);

  const part259 = ctx?.part_259_applicable;
  const channel = ctx?.booking_channel ?? 'unknown';

  if (part259 === undefined) {
    reasons.push('insufficient_inputs');
  } else if (part259 === false) {
    reasons.push('geography_not_applicable');
  }

  if (!bookingDate || !departureDate) {
    reasons.push('insufficient_inputs');
  }

  if (channel === 'unknown') {
    reasons.push('insufficient_inputs');
  } else if (channel === 'third_party') {
    reasons.push('third_party_booking');
  }

  if (sevenDay === false) {
    reasons.push('departure_within_7_days');
  }

  if (hours !== null && hours > DOT_WINDOW_HOURS) {
    reasons.push('outside_24_hour_window');
  } else if (hours === null && bookingDate === undefined) {
    // already covered by insufficient_inputs when booking missing
  }

  if (carrierRemedy === 'unknown') {
    reasons.push('carrier_remedy_unknown');
  }

  // Hold is a pre-payment fare hold — not a post-purchase change waiver.
  // Post-booking change assessment never treats hold as free change.
  if (carrierRemedy === 'hold') {
    reasons.push('hold_not_post_purchase_change');
  }

  const uniqueReasons = [...new Set(reasons)];

  // Eligible only when Part 259 applies, airline-direct, ≥7 days, within 24h,
  // remedy is cancel (hold is not a post-purchase change entitlement).
  const eligible =
    part259 === true &&
    channel === 'airline_direct' &&
    sevenDay === true &&
    hours !== null &&
    hours <= DOT_WINDOW_HOURS &&
    carrierRemedy === 'cancel';

  const noteParts: string[] = [
    '14 CFR §259.5(b)(4): hold OR cancel (carrier chooses), booked ≥7 days before departure. Not free change.',
  ];
  if (row.notes) noteParts.push(row.notes);
  if (eligible) {
    noteParts.push('DOT cancel entitlement appears available — does not waive Cat 31 change fees or enable free reissue.');
  }

  return {
    regulation: '14_CFR_259_5_b_4',
    carrier_remedy: carrierRemedy,
    carrier_remedy_last_verified: row.last_verified,
    eligible,
    ineligibility_reasons: uniqueReasons,
    days_booking_to_departure: days,
    hours_since_booking: hours === null ? null : Math.round(hours * 100) / 100,
    entitlement: entitlementFor(carrierRemedy, eligible),
    notes: noteParts.join(' '),
  };
}
