/**
 * ConnectAdapter bridge for HAIP lodging — enables createAdapter('haip')
 * to return GuardedConnectAdapter. Flight search/price/book are unsupported;
 * cancel/status/health delegate to HaipAdapter once-methods (Guarded owns ledger).
 */

import { MoneyPathError } from '@otaip/core';
import { ConnectError } from '../../base-adapter.js';
import type {
  BookingResult,
  BookingStatusResult,
  ConnectAdapter,
  CreateBookingInput,
  FlightOffer,
  PassengerCount,
  PricedItinerary,
  SearchFlightsInput,
} from '../../types.js';
import { HaipAdapter } from './index.js';

export class HaipConnectBridge implements ConnectAdapter {
  readonly supplierId = 'haip';
  readonly supplierName = 'HAIP PMS';
  private readonly haip: HaipAdapter;

  constructor(config: unknown) {
    this.haip = new HaipAdapter(config, { liveMode: false });
  }

  /** Underlying lodging adapter (money-path enforced on direct use). */
  get lodgingAdapter(): HaipAdapter {
    return this.haip;
  }

  async searchFlights(_input: SearchFlightsInput): Promise<FlightOffer[]> {
    throw new ConnectError(
      'HAIP does not support flight search',
      this.supplierId,
      'searchFlights',
      false,
    );
  }

  async priceItinerary(
    _offerId: string,
    _passengers: PassengerCount,
  ): Promise<PricedItinerary> {
    throw new ConnectError(
      'HAIP does not support flight pricing',
      this.supplierId,
      'priceItinerary',
      false,
    );
  }

  async createBooking(_input: CreateBookingInput): Promise<BookingResult> {
    throw new MoneyPathError(
      'HAIP lodging bookings use HaipAdapter.createBooking with HaipBookingParams, not ConnectAdapter flight createBooking',
    );
  }

  async getBookingStatus(bookingId: string): Promise<BookingStatusResult> {
    const status = await this.haip.getBookingStatus(bookingId);
    const mappedStatus: BookingStatusResult['status'] =
      status.status === 'confirmed'
        ? 'confirmed'
        : status.status === 'cancelled'
          ? 'cancelled'
          : 'held';
    return {
      bookingId,
      supplier: 'haip',
      status: mappedStatus,
      segments: [],
      passengers: [],
      totalPrice: {
        amount: status.totalAmount,
        currency: status.currency,
      },
      raw: status,
    };
  }

  async cancelBooking(
    bookingId: string,
  ): Promise<{ success: boolean; message: string }> {
    // Once-method: GuardedConnectAdapter / MutationExecutor owns the ledger.
    const result = await this.haip.cancelBookingOnce(bookingId);
    return {
      success: result.status === 'cancelled',
      message: result.message ?? 'cancelled',
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    return this.haip.healthCheck();
  }
}
