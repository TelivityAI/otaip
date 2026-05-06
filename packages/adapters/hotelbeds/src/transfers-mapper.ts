/**
 * Hotelbeds Transfers — wire-to-canonical mapping.
 *
 * Per CLAUDE.md, no domain logic is invented. See
 * `docs/knowledge-base/transfers.md` for outstanding DOMAIN_QUESTIONs
 * (location code formats, timezone semantics, vehicle taxonomy).
 */

import Decimal from 'decimal.js';

import type {
  HotelbedsTransfer,
  HotelbedsTransfersAvailabilityResponse,
  HotelbedsTransfersBookingResponse,
  HotelbedsTransfersCancellationResponse,
  TransferBookResponse,
  TransferOffer,
  TransferType,
} from './transfers-types.js';
import type { Money } from './shared-types.js';

const KNOWN_TRANSFER_TYPES: ReadonlySet<TransferType> = new Set(['PRIVATE', 'SHARED', 'LUXURY']);

function toMoney(amount: string | undefined, currency: string | undefined): Money {
  const amt = amount && amount.trim().length > 0 ? new Decimal(amount).toFixed(2) : '0.00';
  return { amount: amt, currency: currency ?? 'EUR' };
}

export function mapTransfer(raw: HotelbedsTransfer): TransferOffer {
  // Pass the raw transferType through unchanged when not in the documented
  // set — preserves fidelity at the cost of a slightly wider TS type.
  const transferType: TransferType | string =
    raw.transferType && KNOWN_TRANSFER_TYPES.has(raw.transferType as TransferType)
      ? (raw.transferType as TransferType)
      : (raw.transferType ?? 'PRIVATE');

  const pickup = raw.pickupInformation?.pickup;
  const dropoff = raw.pickupInformation?.dropoff;

  return {
    transferCode: raw.transferCode ?? '',
    transferType,
    vehicleType: raw.vehicleType ?? '',
    maxPassengers: typeof raw.maxPassengers === 'number' ? raw.maxPassengers : 0,
    price: toMoney(raw.amount, raw.currency),
    pickupInfo: {
      location: pickup?.location ?? '',
      time: pickup?.time ?? '',
    },
    dropoffInfo: {
      location: dropoff?.location ?? '',
      estimatedTime: dropoff?.estimatedTime ?? '',
    },
    cancellationPolicy: raw.cancellationPolicy ?? '',
  };
}

export function mapTransferAvailability(
  response: HotelbedsTransfersAvailabilityResponse,
): TransferOffer[] {
  return (response.transfers ?? []).map(mapTransfer);
}

export function mapTransferBookingResponse(
  response: HotelbedsTransfersBookingResponse,
): TransferBookResponse {
  const booking = response.booking;
  if (!booking) {
    throw new Error('Hotelbeds Transfers booking returned no booking object');
  }
  const status = booking.status === 'ON_REQUEST' ? 'ON_REQUEST' : 'CONFIRMED';
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
  const booking = response.booking;
  if (!booking) {
    throw new Error('Hotelbeds Transfers cancellation returned no booking object');
  }
  return {
    status: 'CANCELLED',
    cancellationReference: booking.cancellationReference ?? booking.reference,
  };
}
