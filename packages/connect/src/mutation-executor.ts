/**
 * MutationExecutor — Connect-shaped facade over core MoneyPathExecutor
 * (DoD 1 / 2 / 8). Prefer GuardedConnectAdapter so callers cannot bypass this.
 */

import {
  MoneyPathExecutor,
  type MoneyPathExecutorConfig,
  type MoneyPathOutcome,
  type EffectLedger,
  type MutationKillSwitch,
  type LiveSafetyModeConfig,
} from '@otaip/core';
import type { BookingStatusResult, ConnectAdapter } from './types.js';
import { ConnectError } from './base-adapter.js';
import { isUnsafeAdapterOperation } from './operation-class.js';

export type MutationOutcome<T> = MoneyPathOutcome<T>;

export type MutationExecutorConfig = MoneyPathExecutorConfig;

export class MutationExecutor {
  private readonly inner: MoneyPathExecutor;

  constructor(config?: MutationExecutorConfig) {
    this.inner = new MoneyPathExecutor(config);
  }

  get effectLedger(): EffectLedger {
    return this.inner.effectLedger;
  }

  get mutationKillSwitch(): MutationKillSwitch {
    return this.inner.mutationKillSwitch;
  }

  get safetyConfig(): LiveSafetyModeConfig {
    return this.inner.safetyConfig;
  }

  get moneyPath(): MoneyPathExecutor {
    return this.inner;
  }

  /**
   * Execute an unsafe adapter mutation exactly once per idempotency key.
   * Safe ops pass through without ledger.
   */
  async execute<T>(params: {
    operation: string;
    idempotencyKey: string;
    request: unknown;
    supplierId: string;
    fn: () => Promise<T>;
  }): Promise<MutationOutcome<T>> {
    if (!isUnsafeAdapterOperation(params.operation)) {
      try {
        return { kind: 'succeeded', value: await params.fn(), replayed: false };
      } catch (error) {
        return { kind: 'failed', error, replayed: false };
      }
    }

    return this.inner.executeUnsafe(params);
  }

  /**
   * Reconcile an unknown booking mutation via getBookingStatus.
   * Callers must not recreate the booking when a supplier record exists.
   */
  async reconcileBooking(
    adapter: ConnectAdapter,
    bookingId: string,
    idempotencyKey: string,
  ): Promise<BookingStatusResult> {
    const status = await adapter.getBookingStatus(bookingId);
    if (status.status === 'ticketed' || status.status === 'confirmed' || status.pnr) {
      await this.inner.effectLedger.resolve(
        idempotencyKey,
        'succeeded',
        status as unknown,
        status.bookingId,
      );
    } else if (status.status === 'cancelled' || status.status === 'failed') {
      await this.inner.effectLedger.resolve(
        idempotencyKey,
        'failed',
        status as unknown,
        status.bookingId,
      );
    }
    return status;
  }
}

export { ConnectError };
