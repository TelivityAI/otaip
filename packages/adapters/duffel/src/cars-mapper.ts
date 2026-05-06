/**
 * Duffel Cars — wire-to-canonical mapping.
 *
 * Per CLAUDE.md, no domain logic is invented. Behavioral semantics that
 * the brief leaves open (refund computation, ACRISS code parsing,
 * privacy-policy consent flow) are passed through verbatim. See
 * `docs/knowledge-base/cars.md` for outstanding DOMAIN_QUESTIONs.
 */

import Decimal from 'decimal.js';

import type {
  CarBookResponse,
  CarBookingStatus,
  CarCancelResponse,
  CarCharge,
  CarCondition,
  CarDetails,
  CarLocation,
  CarMileage,
  CarPaymentType,
  CarQuote,
  CarRate,
  CarSearchResult,
  CarSupplier,
  CarTransmission,
  DuffelCarWire,
  DuffelCarsBookingResponse,
  DuffelCarsBookingWire,
  DuffelCarsCancelResponse,
  DuffelCarsLocationWire,
  DuffelCarsQuoteResponse,
  DuffelCarsQuoteWire,
  DuffelCarsRateWire,
  DuffelCarsSearchResponse,
  Money,
} from './cars-types.js';

const KNOWN_PAYMENT_TYPES: ReadonlySet<CarPaymentType> = new Set([
  'guarantee',
  'prepaid',
  'postpaid',
]);

const KNOWN_TRANSMISSIONS: ReadonlySet<CarTransmission> = new Set([
  'automatic',
  'manual',
]);

const KNOWN_BOOKING_STATUSES: ReadonlySet<CarBookingStatus> = new Set([
  'confirmed',
  'cancelled',
]);

function toMoney(amount: string | undefined, currency: string | undefined): Money {
  // Run through Decimal to normalize "10" / "10.00" / "10.0".
  const amt = amount && amount.trim().length > 0 ? new Decimal(amount).toFixed(2) : '0.00';
  return { amount: amt, currency: currency ?? 'USD' };
}

function toLocation(raw: DuffelCarsLocationWire | undefined): CarLocation {
  const coords = raw?.geographic_coordinates;
  const result: CarLocation = {
    address: raw?.address ?? '',
    latitude: typeof coords?.latitude === 'number' ? coords.latitude : 0,
    longitude: typeof coords?.longitude === 'number' ? coords.longitude : 0,
  };
  if (raw?.phone) result.phone = raw.phone;
  if (raw?.opening_hours) result.openingHours = raw.opening_hours;
  return result;
}

function mapImages(raw: DuffelCarWire['images']): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item.url === 'string') out.push(item.url);
  }
  return out;
}

function toCarDetails(raw: DuffelCarWire | undefined): CarDetails {
  const transmission =
    raw?.transmission && KNOWN_TRANSMISSIONS.has(raw.transmission as CarTransmission)
      ? (raw.transmission as CarTransmission)
      : 'automatic';
  return {
    name: raw?.name ?? '',
    // Pass the supplier value through; consumers can switch on the
    // documented enum and still see unknown values verbatim. DQ-C3.
    category: raw?.category ?? '',
    type: raw?.type ?? '',
    transmission,
    fuel: raw?.fuel ?? '',
    acrissCode: raw?.code ?? '',
    maxPassengers: typeof raw?.max_passengers === 'number' ? raw.max_passengers : 0,
    baggage: {
      small: typeof raw?.baggage?.small === 'number' ? raw.baggage.small : 0,
      large: typeof raw?.baggage?.large === 'number' ? raw.baggage.large : 0,
    },
    airConditioning: Boolean(raw?.air_conditioning),
    images: mapImages(raw?.images),
  };
}

function toSupplier(raw: { name?: string; logo_url?: string } | undefined): CarSupplier {
  const out: CarSupplier = { name: raw?.name ?? '' };
  if (raw?.logo_url) out.logoUrl = raw.logo_url;
  return out;
}

function normalizePaymentType(raw: string | undefined): CarPaymentType {
  if (raw && KNOWN_PAYMENT_TYPES.has(raw as CarPaymentType)) {
    return raw as CarPaymentType;
  }
  // TODO: DOMAIN_QUESTION (DQ-C3 adjacent): unknown payment_type values.
  // Defaulting to 'postpaid' avoids mis-charging the user; pay-at-counter
  // is the safer assumption when the supplier intent is unclear.
  return 'postpaid';
}

export function mapRate(raw: DuffelCarsRateWire, searchId: string): CarRate {
  return {
    rateId: raw.id,
    searchId,
    car: toCarDetails(raw.car),
    supplier: toSupplier(raw.supplier),
    pickupLocation: toLocation(raw.pickup_location),
    dropoffLocation: toLocation(raw.dropoff_location),
    baseAmount: toMoney(raw.base_amount, raw.base_currency),
    totalAmount: toMoney(raw.total_amount, raw.total_currency),
    paymentType: normalizePaymentType(raw.payment_type),
  };
}

export function mapSearchResponse(response: DuffelCarsSearchResponse): CarSearchResult {
  const data = response.data;
  if (!data?.id) {
    throw new Error('Duffel Cars search response missing data.id');
  }
  const rates = (data.rates ?? []).map((r) => mapRate(r, data.id));
  return { searchId: data.id, rates };
}

function mapConditions(raw: DuffelCarsQuoteWire['conditions']): CarCondition[] {
  return (raw ?? []).map((c) => ({ title: c?.title ?? '', text: c?.text ?? '' }));
}

function mapCharges(raw: DuffelCarsQuoteWire['charges']): CarCharge[] {
  return (raw ?? []).map((c) => ({
    amount: c?.amount ? new Decimal(c.amount).toFixed(2) : '0.00',
    currency: c?.currency ?? 'USD',
    description: c?.description ?? '',
  }));
}

function mapMileage(raw: DuffelCarsQuoteWire['mileage']): CarMileage | undefined {
  if (!raw) return undefined;
  const out: CarMileage = { unlimited: Boolean(raw.unlimited) };
  if (typeof raw.included === 'number') out.included = raw.included;
  if (raw.unit) out.unit = raw.unit;
  return out;
}

function mapPrivacyPolicies(raw: DuffelCarsQuoteWire['privacy_policies']): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item.text === 'string') out.push(item.text);
    else if (item && typeof item.url === 'string') out.push(item.url);
  }
  return out;
}

export function mapQuoteResponse(response: DuffelCarsQuoteResponse): CarQuote {
  const data = response.data;
  if (!data?.id) {
    throw new Error('Duffel Cars quote response missing data.id');
  }
  return {
    quoteId: data.id,
    rateId: data.rate_id ?? data.id,
    searchId: data.search_id ?? '',
    car: toCarDetails(data.car),
    supplier: toSupplier(data.supplier),
    pickupLocation: toLocation(data.pickup_location),
    dropoffLocation: toLocation(data.dropoff_location),
    totalAmount: toMoney(data.total_amount, data.total_currency),
    conditions: mapConditions(data.conditions),
    charges: mapCharges(data.charges),
    ...(data.mileage ? { mileage: mapMileage(data.mileage) } : {}),
    privacyPolicies: mapPrivacyPolicies(data.privacy_policies),
  };
}

function normalizeBookingStatus(raw: string | undefined): CarBookingStatus {
  if (raw && KNOWN_BOOKING_STATUSES.has(raw as CarBookingStatus)) {
    return raw as CarBookingStatus;
  }
  // Unknown status — default to 'confirmed' for a successful book/get
  // response. Cancellation is handled by a dedicated endpoint and
  // mapper, so we never see 'cancelled' here unintentionally.
  return 'confirmed';
}

function mapBookingWire(raw: DuffelCarsBookingWire): CarBookResponse {
  return {
    bookingId: raw.id,
    status: normalizeBookingStatus(raw.status),
    reference: raw.reference ?? '',
    confirmedAt: raw.confirmed_at ?? '',
    car: toCarDetails(raw.car),
    supplier: toSupplier(raw.supplier),
    pickupLocation: toLocation(raw.pickup_location),
    dropoffLocation: toLocation(raw.dropoff_location),
    totalAmount: toMoney(raw.total_amount, raw.total_currency),
  };
}

export function mapBookingResponse(response: DuffelCarsBookingResponse): CarBookResponse {
  const data = response.data;
  if (!data?.id) {
    throw new Error('Duffel Cars booking response missing data.id');
  }
  return mapBookingWire(data);
}

export function mapCancelResponse(response: DuffelCarsCancelResponse): CarCancelResponse {
  const data = response.data;
  return {
    status: 'cancelled',
    cancelledAt: data?.cancelled_at ?? '',
  };
}
