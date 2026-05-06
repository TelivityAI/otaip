/**
 * Hotelbeds Activities — wire-to-canonical mapping.
 *
 * Per CLAUDE.md, no domain logic is invented. Behavioral semantics that
 * the brief leaves open (cancellation policy details, on-request flow,
 * voucher access) are NOT collapsed here — fields are passed through
 * verbatim. See `docs/knowledge-base/activities.md` for open DOMAIN_QUESTIONs.
 */

import Decimal from 'decimal.js';

import type {
  ActivityBookResponse,
  ActivityCancellationPolicy,
  ActivityModality,
  ActivityOffer,
  HotelbedsActivitiesAvailabilityResponse,
  HotelbedsActivitiesBookingResponse,
  HotelbedsActivitiesCancellationResponse,
  HotelbedsActivity,
  HotelbedsActivityModality,
} from './activities-types.js';
import type { Money } from './shared-types.js';

const KNOWN_CANCELLATION_POLICIES: ReadonlySet<ActivityCancellationPolicy> = new Set([
  'NOR',
  'NRF',
]);

/**
 * Narrow Hotelbeds' free-form `cancellationPolicy` string into the
 * documented enum. Unknown values default to non-refundable — the safer
 * assumption when uncertain. See DQ-A5 in the KB.
 */
function normalizeCancellationPolicy(raw: string | undefined): ActivityCancellationPolicy {
  if (raw && KNOWN_CANCELLATION_POLICIES.has(raw as ActivityCancellationPolicy)) {
    return raw as ActivityCancellationPolicy;
  }
  // TODO: DOMAIN_QUESTION: confirm Hotelbeds Activities cancellation policy
  // values beyond NOR/NRF. Defaulting unknown values to NRF avoids
  // silently treating non-refundable rates as refundable.
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

function toMoney(amount: string | undefined, currency: string | undefined): Money {
  // Run through Decimal to normalize "10" / "10.00" / "10.0" trailing zeros.
  const amt = amount && amount.trim().length > 0 ? new Decimal(amount).toFixed(2) : '0.00';
  return { amount: amt, currency: currency ?? 'EUR' };
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
  // Best-effort modality currency — first modality with a currency wins.
  const currency = raw.modalities?.find((m) => m.currency)?.currency ?? 'EUR';

  return {
    activityCode: raw.code,
    name: raw.name ?? raw.code,
    description: raw.description ?? '',
    duration: raw.duration ?? '',
    location: { latitude: lat, longitude: lng },
    images: mapImages(raw.images),
    cancellationPolicy: normalizeCancellationPolicy(raw.cancellationPolicy),
    modalities: (raw.modalities ?? []).map((m) => mapModality(m, currency)),
  };
}

export function mapActivityAvailability(
  response: HotelbedsActivitiesAvailabilityResponse,
): ActivityOffer[] {
  return (response.activities ?? []).map(mapActivity);
}

export function mapActivityBookingResponse(
  response: HotelbedsActivitiesBookingResponse,
): ActivityBookResponse {
  const booking = response.booking;
  if (!booking) {
    throw new Error('Hotelbeds Activities booking returned no booking object');
  }
  const status = booking.status === 'ON_REQUEST' ? 'ON_REQUEST' : 'CONFIRMED';
  const result: ActivityBookResponse = {
    bookingReference: booking.reference,
    status,
    clientReference: booking.clientReference ?? '',
  };
  if (booking.voucherUrl) result.voucherUrl = booking.voucherUrl;
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
