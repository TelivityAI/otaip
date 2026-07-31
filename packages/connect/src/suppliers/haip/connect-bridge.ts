/**
 * ConnectAdapter bridge for HAIP lodging — createAdapter('haip') returns this
 * without GuardedConnectAdapter (HaipAdapter already owns MoneyPathExecutor).
 * Flight search/price/book are unsupported; cancel/status/health delegate to HaipAdapter.
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
import { HaipAdapter, type HaipAdapterOptions } from './index.js';

export interface HaipConnectBridgeOptions {
  readonly liveMode?: boolean;
  readonly moneyPath?: HaipAdapterOptions['moneyPath'];
  readonly storeDurability?: HaipAdapterOptions['storeDurability'];
}

export class HaipConnectBridge implements ConnectAdapter {
  readonly supplierId = 'haip';
  readonly supplierName = 'HAIP PMS';
  private readonly haip: HaipAdapter;

  constructor(config: unknown, options?: HaipConnectBridgeOptions) {
    this.haip = new HaipAdapter(config, {
      ...(options?.liveMode !== undefined ? { liveMode: options.liveMode } : {}),
      ...(options?.moneyPath !== undefined ? { moneyPath: options.moneyPath } : {}),
      ...(options?.storeDurability !== undefined
        ? { storeDurability: options.storeDurability }
        : {}),
    });
  }

  get moneyPathExecutor() {
    return this.haip.moneyPathExecutor;
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
    // Ledger + RL+CB owned by HaipAdapter (no GuardedConnectAdapter double-wrap).
    const result = await this.haip.cancelBooking(bookingId, {
      idempotencyKey: `cancel:${bookingId}`,
    });
    return {
      success: result.status === 'cancelled',
      message: result.message ?? 'cancelled',
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    return this.haip.healthCheck();
  }
}
