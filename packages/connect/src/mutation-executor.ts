/**
 * Mutation executor — ledger-backed unsafe adapter operations with
 * OUTCOME_UNKNOWN + reconcile-first semantics (DoD 1 / 2).
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  InMemoryEffectLedger,
  MutationKillSwitch,
  assertIrreversibleAllowed,
  type EffectLedger,
  type LiveSafetyModeConfig,
  type MutationEffectType,
} from '@otaip/core';
import type { BookingStatusResult, ConnectAdapter } from './types.js';
import { ConnectError } from './base-adapter.js';
import { isUnsafeAdapterOperation } from './operation-class.js';

export type MutationOutcome<T> =
  | { readonly kind: 'succeeded'; readonly value: T; readonly replayed: boolean }
  | { readonly kind: 'failed'; readonly error: unknown; readonly replayed: boolean }
  | {
      readonly kind: 'unknown';
      readonly error: unknown;
      readonly idempotencyKey: string;
      readonly reconcileHint: 'getBookingStatus';
    };

export interface MutationExecutorConfig {
  readonly ledger?: EffectLedger;
  readonly killSwitch?: MutationKillSwitch;
  readonly safety?: LiveSafetyModeConfig;
  readonly idFactory?: () => string;
}

function requestHash(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function mapEffectType(operation: string): MutationEffectType {
  if (operation.startsWith('createBooking')) return 'book';
  if (operation.startsWith('requestTicketing')) return 'ticket';
  if (operation.startsWith('cancelBooking')) return 'cancel';
  if (operation.includes('void')) return 'void';
  if (operation.includes('refund')) return 'refund';
  if (operation.includes('pay')) return 'pay';
  return 'book';
}

function isAmbiguousError(error: unknown): boolean {
  if (error instanceof ConnectError) {
    return error.retryable;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('fetch failed') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('network') ||
      msg.includes('aborted') ||
      msg.includes('timeout') ||
      /\b5\d\d\b/.test(msg)
    );
  }
  return false;
}

export class MutationExecutor {
  private readonly ledger: EffectLedger;
  private readonly killSwitch: MutationKillSwitch;
  private readonly safety: LiveSafetyModeConfig | undefined;
  private readonly idFactory: () => string;
  /** Single-process coalescing for concurrent identical idempotency keys. */
  private readonly inFlight = new Map<string, Promise<MutationOutcome<unknown>>>();

  constructor(config?: MutationExecutorConfig) {
    this.ledger = config?.ledger ?? new InMemoryEffectLedger();
    this.killSwitch = config?.killSwitch ?? new MutationKillSwitch();
    this.safety = config?.safety;
    this.idFactory = config?.idFactory ?? ((): string => randomUUID());
  }

  get effectLedger(): EffectLedger {
    return this.ledger;
  }

  get mutationKillSwitch(): MutationKillSwitch {
    return this.killSwitch;
  }

  /**
   * Execute an unsafe adapter mutation exactly once per idempotency key.
   * On ambiguous failure, records OUTCOME_UNKNOWN and does not auto-retry.
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

    const existing = this.inFlight.get(params.idempotencyKey);
    if (existing) {
      return existing as Promise<MutationOutcome<T>>;
    }

    const run = this.executeUnsafe<T>(params).finally(() => {
      this.inFlight.delete(params.idempotencyKey);
    });
    this.inFlight.set(params.idempotencyKey, run as Promise<MutationOutcome<unknown>>);
    return run;
  }

  private async executeUnsafe<T>(params: {
    operation: string;
    idempotencyKey: string;
    request: unknown;
    supplierId: string;
    fn: () => Promise<T>;
  }): Promise<MutationOutcome<T>> {
    this.killSwitch.assertMutationsAllowed();
    if (this.safety) {
      assertIrreversibleAllowed(this.safety);
    }

    const hash = requestHash(params.request);
    const begun = await this.ledger.begin<T>({
      effectId: this.idFactory(),
      effectType: mapEffectType(params.operation),
      idempotencyKey: params.idempotencyKey,
      requestHash: hash,
      supplierId: params.supplierId,
    });

    if (begun.kind === 'conflict') {
      return {
        kind: 'failed',
        error: new ConnectError(
          begun.reason,
          params.supplierId,
          params.operation,
          false,
        ),
        replayed: false,
      };
    }

    if (begun.kind === 'replay') {
      if (begun.record.outcome === 'succeeded' && begun.record.response !== undefined) {
        return { kind: 'succeeded', value: begun.record.response, replayed: true };
      }
      if (begun.record.outcome === 'failed') {
        return {
          kind: 'failed',
          error: new ConnectError(
            'Replayed failed mutation',
            params.supplierId,
            params.operation,
            false,
          ),
          replayed: true,
        };
      }
      if (begun.record.outcome === 'unknown' || begun.record.outcome === 'pending') {
        return {
          kind: 'unknown',
          error: new ConnectError(
            'Prior mutation outcome unknown — reconcile before retry',
            params.supplierId,
            params.operation,
            false,
          ),
          idempotencyKey: params.idempotencyKey,
          reconcileHint: 'getBookingStatus',
        };
      }
    }

    try {
      const value = await params.fn();
      await this.ledger.resolve(params.idempotencyKey, 'succeeded', value);
      return { kind: 'succeeded', value, replayed: false };
    } catch (error) {
      if (isAmbiguousError(error)) {
        await this.ledger.resolve(params.idempotencyKey, 'unknown');
        return {
          kind: 'unknown',
          error,
          idempotencyKey: params.idempotencyKey,
          reconcileHint: 'getBookingStatus',
        };
      }
      await this.ledger.resolve(params.idempotencyKey, 'failed');
      return { kind: 'failed', error, replayed: false };
    }
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
      await this.ledger.resolve(idempotencyKey, 'succeeded', status as unknown, status.bookingId);
    } else if (status.status === 'cancelled' || status.status === 'failed') {
      await this.ledger.resolve(idempotencyKey, 'failed', status as unknown, status.bookingId);
    }
    return status;
  }
}
