/**
 * Hotelbeds Activities — wire-to-canonical mapping.
 *
 * Per CLAUDE.md, no domain logic is invented. Semantics closed from official
 * Hotelbeds docs are applied in `docs/knowledge-base/activities.md`.
 * Remaining open items (DQ-A4 voucher access) stay pass-through.
 */

import Decimal from 'decimal.js';

import type {
  ActivityBookResponse,
  ActivityBookingStatus,
  ActivityCancellationPenalty,
  ActivityCancellationPolicy,
  ActivityModality,
  ActivityOffer,
  HotelbedsActivitiesAvailabilityResponse,
  HotelbedsActivitiesBookingResponse,
  HotelbedsActivitiesCancellationResponse,
  HotelbedsActivity,
  HotelbedsActivityCancellationPolicy,
  HotelbedsActivityModality,
} from './activities-types.js';
import type { Money } from './shared-types.js';

const KNOWN_CANCELLATION_POLICIES: ReadonlySet<ActivityCancellationPolicy> = new Set([
  'NOR',
  'NRF',
]);

const KNOWN_BOOKING_STATUSES: ReadonlySet<ActivityBookingStatus> = new Set([
  'CONFIRMED',
  'PRECONFIRMED',
  'CANCELLED',
]);

/**
 * Narrow Hotelbeds `rateClass` / brief `cancellationPolicy` into NOR|NRF.
 * Unknown values default to NRF — safer when uncertain (DQ-A5 CLOSED for the
 * documented NOR/NRF + stepped array; unknown codes still default NRF).
 */
function normalizeCancellationPolicy(raw: string | undefined): ActivityCancellationPolicy {
  if (raw && KNOWN_CANCELLATION_POLICIES.has(raw as ActivityCancellationPolicy)) {
    return raw as ActivityCancellationPolicy;
  }
  return 'NRF';
}

function toNumeric(value: unknown, fallback: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function toMoney(amount: string | number | undefined | null, currency: string | undefined): Money {
  const raw =
    amount === null || amount === undefined
      ? ''
      : typeof amount === 'number'
        ? String(amount)
        : amount;
  const amt = raw.trim().length > 0 ? new Decimal(raw).toFixed(2) : '0.00';
  return { amount: amt, currency: currency ?? 'EUR' };
}

function mapPenalties(
  raw: HotelbedsActivityCancellationPolicy[] | undefined,
  fallbackCurrency: string,
): ActivityCancellationPenalty[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const out: ActivityCancellationPenalty[] = [];
  for (const p of raw) {
    if (!p.dateFrom) continue;
    const penalty: ActivityCancellationPenalty = {
      dateFrom: p.dateFrom,
      amount: toMoney(p.amount, p.currency ?? fallbackCurrency).amount,
    };
    if (p.currency) penalty.currency = p.currency;
    out.push(penalty);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Collect rateClass + cancellationPolicies from official nested rates when
 * the brief-shape top-level fields are absent.
 */
function extractRateClassAndPolicies(raw: HotelbedsActivity): {
  rateClass: string | undefined;
  policies: HotelbedsActivityCancellationPolicy[] | undefined;
} {
  if (raw.cancellationPolicy || (raw.cancellationPolicies && raw.cancellationPolicies.length > 0)) {
    return {
      rateClass: raw.cancellationPolicy,
      policies: raw.cancellationPolicies,
    };
  }

  let rateClass: string | undefined;
  const policies: HotelbedsActivityCancellationPolicy[] = [];
  for (const modality of raw.modalities ?? []) {
    for (const rate of modality.rates ?? []) {
      if (!rateClass && rate.rateClass) rateClass = rate.rateClass;
      for (const detail of rate.rateDetails ?? []) {
        for (const op of detail.operationDates ?? []) {
          if (op.cancellationPolicies) policies.push(...op.cancellationPolicies);
        }
      }
    }
  }
  return {
    rateClass,
    policies: policies.length > 0 ? policies : undefined,
  };
}

function mapModality(raw: HotelbedsActivityModality, currency: string): ActivityModality {
  const modality: ActivityModality = {
    code: raw.code,
    name: raw.name ?? raw.code,
    price: toMoney(raw.amount, raw.currency ?? currency),
    maxPax: typeof raw.maxPax === 'number' ? raw.maxPax : 0,
  };
  if (raw.childAmount !== undefined) {
    modality.childPrice = toMoney(raw.childAmount, raw.currency ?? currency);
  }
  if (raw.boxOfficeAmount !== undefined) {
    modality.boxOfficePrice = toMoney(raw.boxOfficeAmount, raw.currency ?? currency);
  }
  if (raw.schedule && raw.schedule.length > 0) {
    modality.schedule = [...raw.schedule];
  }
  return modality;
}

function mapImages(images: HotelbedsActivity['images']): string[] {
  if (!images) return [];
  const out: string[] = [];
  for (const item of images) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item.url === 'string') out.push(item.url);
  }
  return out;
}

export function mapActivity(raw: HotelbedsActivity): ActivityOffer {
  const lat = toNumeric(raw.location?.latitude, 0);
  const lng = toNumeric(raw.location?.longitude, 0);
  const currency = raw.modalities?.find((m) => m.currency)?.currency ?? 'EUR';
  const { rateClass, policies } = extractRateClassAndPolicies(raw);
  const cancellationPolicies = mapPenalties(policies, currency);

  const offer: ActivityOffer = {
    activityCode: raw.code,
    name: raw.name ?? raw.code,
    description: raw.description ?? '',
    duration: raw.duration ?? '',
    location: { latitude: lat, longitude: lng },
    images: mapImages(raw.images),
    cancellationPolicy: normalizeCancellationPolicy(rateClass),
    modalities: (raw.modalities ?? []).map((m) => mapModality(m, currency)),
  };
  if (cancellationPolicies) offer.cancellationPolicies = cancellationPolicies;
  return offer;
}

export function mapActivityAvailability(
  response: HotelbedsActivitiesAvailabilityResponse,
): ActivityOffer[] {
  return (response.activities ?? []).map(mapActivity);
}

function normalizeActivityBookingStatus(raw: string | undefined): ActivityBookingStatus {
  if (raw && KNOWN_BOOKING_STATUSES.has(raw as ActivityBookingStatus)) {
    return raw as ActivityBookingStatus;
  }
  // DQ-A3 CLOSED: official confirm has no ON_REQUEST. PRECONFIRMED ≠ ON_REQUEST.
  // Unknown / legacy ON_REQUEST values are not silently coerced to CONFIRMED.
  throw new Error(
    `Hotelbeds Activities booking returned unsupported status ${JSON.stringify(raw)}. ` +
      'Official confirm statuses are CONFIRMED | CANCELLED; PRECONFIRMED is the ' +
      'preconfirm hold (not ON_REQUEST). See docs/knowledge-base/activities.md DQ-A3.',
  );
}

export function mapActivityBookingResponse(
  response: HotelbedsActivitiesBookingResponse,
): ActivityBookResponse {
  const booking = response.booking;
  if (!booking) {
    throw new Error('Hotelbeds Activities booking returned no booking object');
  }
  const status = normalizeActivityBookingStatus(booking.status);
  const result: ActivityBookResponse = {
    bookingReference: booking.reference,
    status,
    clientReference: booking.clientReference ?? '',
  };
  // Prefer brief voucherUrl; else first activity voucher URL from official shape.
  const voucherFromArray = booking.activities
    ?.flatMap((a) => a.vouchers ?? [])
    .find((v) => typeof v.url === 'string' && v.url.length > 0)?.url;
  if (booking.voucherUrl) result.voucherUrl = booking.voucherUrl;
  else if (voucherFromArray) result.voucherUrl = voucherFromArray;
  return result;
}

export function mapActivityCancellation(
  response: HotelbedsActivitiesCancellationResponse,
): { status: 'CANCELLED'; cancellationReference: string } {
  const booking = response.booking;
  if (!booking) {
    throw new Error('Hotelbeds Activities cancellation returned no booking object');
  }
  return {
    status: 'CANCELLED',
    cancellationReference: booking.cancellationReference ?? booking.reference,
  };
}
