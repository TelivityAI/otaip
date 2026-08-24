/**
 * Hotelbeds Transfers — wire-to-canonical mapping.
 *
 * Per CLAUDE.md, no domain logic is invented. See
 * `docs/knowledge-base/transfers.md` for CLOSED / open DOMAIN_QUESTIONs.
 */

import Decimal from 'decimal.js';

import type {
  HotelbedsTransfer,
  HotelbedsTransferCancellationPolicy,
  HotelbedsTransfersAvailabilityResponse,
  HotelbedsTransfersBookingResponse,
  HotelbedsTransfersCancellationResponse,
  TransferBookResponse,
  TransferBookingStatus,
  TransferCancellationPenalty,
  TransferOffer,
  TransferType,
} from './transfers-types.js';
import type { Money } from './shared-types.js';

const KNOWN_TRANSFER_TYPES: ReadonlySet<TransferType> = new Set(['PRIVATE', 'SHARED', 'LUXURY']);

const KNOWN_BOOKING_STATUSES: ReadonlySet<TransferBookingStatus> = new Set([
  'CONFIRMED',
  'CANCELLED',
  'MODIFIED',
  'ON_REQUEST',
]);

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
  raw: HotelbedsTransferCancellationPolicy[] | undefined,
): TransferCancellationPenalty[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  const out: TransferCancellationPenalty[] = [];
  for (const p of raw) {
    if (!p.from) continue;
    const penalty: TransferCancellationPenalty = {
      amount: toMoney(p.amount, p.currencyId).amount,
      from: p.from,
    };
    if (p.currencyId) penalty.currencyId = p.currencyId;
    if (p.utcOffset) penalty.utcOffset = p.utcOffset;
    out.push(penalty);
  }
  return out.length > 0 ? out : undefined;
}

function pickupLocation(raw: HotelbedsTransfer): string {
  const pickup = raw.pickupInformation?.pickup;
  if (pickup?.location) return pickup.location;
  if (pickup?.description) return pickup.description;
  const from = raw.pickupInformation?.from;
  if (from?.description) return from.description;
  if (from?.code) return from.code;
  return '';
}

function pickupTime(raw: HotelbedsTransfer): string {
  return raw.pickupInformation?.pickup?.time ?? raw.pickupInformation?.time ?? '';
}

function dropoffLocation(raw: HotelbedsTransfer): string {
  const dropoff = raw.pickupInformation?.dropoff;
  if (dropoff?.location) return dropoff.location;
  const to = raw.pickupInformation?.to;
  if (to?.description) return to.description;
  if (to?.code) return to.code;
  return '';
}

export function mapTransfer(raw: HotelbedsTransfer): TransferOffer {
  const transferType: TransferType | string =
    raw.transferType && KNOWN_TRANSFER_TYPES.has(raw.transferType as TransferType)
      ? (raw.transferType as TransferType)
      : (raw.transferType ?? 'PRIVATE');

  const currency = raw.price?.currencyId ?? raw.currency ?? 'EUR';
  // DQ-T7: prefer netAmount; fall back to totalAmount / brief amount.
  const netRaw = raw.price?.netAmount;
  const totalRaw = raw.price?.totalAmount;
  const hasNet = netRaw !== null && netRaw !== undefined && String(netRaw).trim() !== '';
  const hasTotal = totalRaw !== null && totalRaw !== undefined && String(totalRaw).trim() !== '';
  const price = hasNet
    ? toMoney(netRaw, currency)
    : hasTotal
      ? toMoney(totalRaw, currency)
      : toMoney(raw.amount, currency);

  const maxPassengers =
    typeof raw.maxPassengers === 'number'
      ? raw.maxPassengers
      : typeof raw.maxPaxCapacity === 'number'
        ? raw.maxPaxCapacity
        : 0;

  const cancellationPolicies = mapPenalties(raw.cancellationPolicies);

  const offer: TransferOffer = {
    transferCode: raw.transferCode ?? raw.rateKey ?? '',
    transferType,
    vehicleType: raw.vehicleType ?? raw.vehicle?.name ?? '',
    maxPassengers,
    price,
    pickupInfo: {
      location: pickupLocation(raw),
      time: pickupTime(raw),
    },
    dropoffInfo: {
      location: dropoffLocation(raw),
      estimatedTime: raw.pickupInformation?.dropoff?.estimatedTime ?? '',
    },
    cancellationPolicy: raw.cancellationPolicy ?? '',
  };

  if (hasNet && hasTotal) {
    offer.totalPrice = toMoney(totalRaw, currency);
  }
  if (cancellationPolicies) offer.cancellationPolicies = cancellationPolicies;
  return offer;
}

export function mapTransferAvailability(
  response: HotelbedsTransfersAvailabilityResponse,
): TransferOffer[] {
  const list = response.transfers ?? response.services ?? [];
  return list.map(mapTransfer);
}

function normalizeTransferBookingStatus(raw: string | undefined): TransferBookingStatus {
  if (raw && KNOWN_BOOKING_STATUSES.has(raw as TransferBookingStatus)) {
    return raw as TransferBookingStatus;
  }
  // DQ-T6 OPEN: do not invent Transfers ON_REQUEST semantics from Activities docs.
  // Unknown values fall back to CONFIRMED (prior adapter behavior).
  return 'CONFIRMED';
}

export function mapTransferBookingResponse(
  response: HotelbedsTransfersBookingResponse,
): TransferBookResponse {
  const booking = response.booking;
  if (!booking) {
    throw new Error('Hotelbeds Transfers booking returned no booking object');
  }
  const status = normalizeTransferBookingStatus(booking.status);
  const pickup = booking.pickup ?? {};
  const result: TransferBookResponse = {
    bookingReference: booking.reference,
    status,
    clientReference: booking.clientReference ?? '',
    pickupDetails: {
      location: pickup.location ?? '',
      time: pickup.time ?? '',
    },
  };
  if (pickup.instructions) result.pickupDetails.instructions = pickup.instructions;
  return result;
}

export function mapTransferCancellation(
  response: HotelbedsTransfersCancellationResponse,
): { status: 'CANCELLED'; cancellationReference: string } {
  if (response.booking) {
    return {
      status: 'CANCELLED',
      cancellationReference:
        response.booking.cancellationReference ?? response.booking.reference,
    };
  }
  const fromList = response.bookings?.[0];
  if (fromList?.reference) {
    return {
      status: 'CANCELLED',
      cancellationReference: fromList.reference,
    };
  }
  throw new Error('Hotelbeds Transfers cancellation returned no booking object');
}
