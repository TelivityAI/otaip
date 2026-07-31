/**
 * GuardedConnectAdapter — default money-path enforcement for ConnectAdapter.
 *
 * createBooking / requestTicketing / cancelBooking always go through
 * MutationExecutor (ledger + kill switch + live safety). Callers cannot
 * bypass by invoking the raw supplier methods when using createAdapter().
 */

import {
  MoneyPathError,
  OutcomeUnknownError,
  type MoneyPathExecutorConfig,
} from '@otaip/core';
import type {
  BookingResult,
  BookingStatusResult,
  ConnectAdapter,
  CreateBookingInput,
  PassengerCount,
  PricedItinerary,
  SearchFlightsInput,
  FlightOffer,
} from './types.js';
import { MutationExecutor } from './mutation-executor.js';
import { ConnectError } from './base-adapter.js';

export interface GuardedConnectAdapterOptions extends MoneyPathExecutorConfig {
  /** Underlying supplier adapter (unguarded). */
  readonly adapter: ConnectAdapter;
}

function unwrapOrThrow<T>(
  outcome: Awaited<ReturnType<MutationExecutor['execute']>>,
): T {
  if (outcome.kind === 'succeeded') return outcome.value as T;
  if (outcome.kind === 'unknown') {
    throw new OutcomeUnknownError(
      'Mutation outcome unknown — reconcile via getBookingStatus before retry',
      {
        idempotencyKey: outcome.idempotencyKey,
        reconcileHint: outcome.reconcileHint,
        cause: outcome.error,
      },
    );
  }
  if (outcome.error instanceof Error) throw outcome.error;
  throw new MoneyPathError(String(outcome.error));
}

/**
 * Wraps a ConnectAdapter so money mutations are ledger-backed and non-retrying.
 */
export class GuardedConnectAdapter implements ConnectAdapter {
  readonly supplierId: string;
  readonly supplierName: string;
  private readonly inner: ConnectAdapter;
  private readonly executor: MutationExecutor;

  constructor(options: GuardedConnectAdapterOptions) {
    const { adapter, ...execConfig } = options;
    this.inner = adapter;
    this.supplierId = adapter.supplierId;
    this.supplierName = adapter.supplierName;
    this.executor = new MutationExecutor(execConfig);
  }

  get mutationExecutor(): MutationExecutor {
    return this.executor;
  }

  get unguarded(): ConnectAdapter {
    return this.inner;
  }

  async searchFlights(input: SearchFlightsInput): Promise<FlightOffer[]> {
    return this.inner.searchFlights(input);
  }

  async priceItinerary(
    offerId: string,
    passengers: PassengerCount,
  ): Promise<PricedItinerary> {
    return this.inner.priceItinerary(offerId, passengers);
  }

  async createBooking(input: CreateBookingInput): Promise<BookingResult> {
    const key = input.idempotencyKey?.trim();
    if (!key) {
      throw new MoneyPathError(
        'createBooking requires idempotencyKey on GuardedConnectAdapter (DoD 1/2)',
      );
    }
    const outcome = await this.executor.execute({
      operation: 'createBooking',
      idempotencyKey: key,
      request: input,
      supplierId: this.supplierId,
      fn: () => this.inner.createBooking(input),
    });
    return unwrapOrThrow<BookingResult>(outcome);
  }

  async getBookingStatus(bookingId: string): Promise<BookingStatusResult> {
    return this.inner.getBookingStatus(bookingId);
  }

  async requestTicketing(bookingId: string): Promise<BookingStatusResult> {
    if (!this.inner.requestTicketing) {
      throw new ConnectError(
        'requestTicketing not supported',
        this.supplierId,
        'requestTicketing',
        false,
      );
    }
    const ticketing = this.inner.requestTicketing.bind(this.inner);
    const outcome = await this.executor.execute({
      operation: 'requestTicketing',
      idempotencyKey: `ticket:${bookingId}`,
      request: { bookingId },
      supplierId: this.supplierId,
      fn: () => ticketing(bookingId),
    });
    return unwrapOrThrow<BookingStatusResult>(outcome);
  }

  async cancelBooking(
    bookingId: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.inner.cancelBooking) {
      throw new ConnectError(
        'cancelBooking not supported',
        this.supplierId,
        'cancelBooking',
        false,
      );
    }
    const cancel = this.inner.cancelBooking.bind(this.inner);
    const outcome = await this.executor.execute({
      operation: 'cancelBooking',
      idempotencyKey: `cancel:${bookingId}`,
      request: { bookingId },
      supplierId: this.supplierId,
      fn: () => cancel(bookingId),
    });
    return unwrapOrThrow<{ success: boolean; message: string }>(outcome);
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    return this.inner.healthCheck();
  }
}

/** Wrap an adapter with money-path enforcement. */
export function guardAdapter(
  adapter: ConnectAdapter,
  config?: Omit<GuardedConnectAdapterOptions, 'adapter'>,
): GuardedConnectAdapter {
  return new GuardedConnectAdapter({ adapter, ...config });
}
