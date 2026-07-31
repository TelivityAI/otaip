/**
 * Reversal saga — cancel through MutationExecutor ledger rules (DoD 7).
 *
 * void/refund fail closed unless the adapter declares the capability.
 * They must NOT silently alias to cancelBooking.
 *
 * Callers must pass a shared MutationExecutor (typically from GuardedConnectAdapter).
 * There is no silent liveMode:false + fresh-ledger default.
 */

import type { ConnectAdapter } from './types.js';
import { MutationExecutor, type MutationOutcome } from './mutation-executor.js';
import { MoneyPathError } from '@otaip/core';

export type ReversalKind = 'cancel' | 'void' | 'refund';

export interface ReversalCapabilities {
  readonly cancel?: boolean;
  readonly void?: boolean;
  readonly refund?: boolean;
}

export interface ReversalRequest {
  readonly kind: ReversalKind;
  readonly bookingId: string;
  readonly idempotencyKey: string;
  readonly amount?: string;
  readonly currency?: string;
}

export interface ReversalResult {
  readonly success: boolean;
  readonly bookingId: string;
  readonly message: string;
  readonly kind: ReversalKind;
}

export class UnsupportedReversalError extends MoneyPathError {
  readonly kind: ReversalKind;

  constructor(kind: ReversalKind, message: string) {
    super(message);
    this.name = 'UnsupportedReversalError';
    this.kind = kind;
  }
}

/**
 * Execute a reversal using a caller-supplied ledger-backed MutationExecutor.
 * Does not auto-retry after ambiguous failure.
 *
 * - cancel: requires adapter.cancelBooking
 * - void / refund: require explicit capability flag — otherwise fail closed
 * - executor: required — omit refuses (no weak liveMode:false fresh-ledger default)
 */
export async function executeReversal(
  adapter: ConnectAdapter,
  request: ReversalRequest,
  executor?: MutationExecutor,
  capabilities: ReversalCapabilities = { cancel: true },
): Promise<MutationOutcome<ReversalResult>> {
  if (!executor) {
    return {
      kind: 'failed',
      error: new MoneyPathError(
        'executeReversal requires a shared MutationExecutor (e.g. from GuardedConnectAdapter). ' +
          'Refusing silent liveMode:false + fresh-ledger default.',
      ),
      replayed: false,
    };
  }

  if (request.kind === 'void' && !capabilities.void) {
    return {
      kind: 'failed',
      error: new UnsupportedReversalError(
        'void',
        'void is not supported on this adapter — do not alias to cancelBooking',
      ),
      replayed: false,
    };
  }
  if (request.kind === 'refund' && !capabilities.refund) {
    return {
      kind: 'failed',
      error: new UnsupportedReversalError(
        'refund',
        'refund is not supported on this adapter — do not alias to cancelBooking',
      ),
      replayed: false,
    };
  }
  if (request.kind !== 'cancel' && request.kind !== 'void' && request.kind !== 'refund') {
    return {
      kind: 'failed',
      error: new UnsupportedReversalError(
        request.kind,
        `Unknown reversal kind: ${String(request.kind)}`,
      ),
      replayed: false,
    };
  }

  // Only cancel is implemented via cancelBooking today.
  // void/refund with capability=true still need supplier-specific APIs —
  // until those exist, capability must stay false (fail closed above).
  if (request.kind !== 'cancel') {
    return {
      kind: 'failed',
      error: new UnsupportedReversalError(
        request.kind,
        `${request.kind} capability declared but no supplier API wired — refusing to alias cancel`,
      ),
      replayed: false,
    };
  }

  return executor.execute({
    operation: 'cancelBooking',
    idempotencyKey: request.idempotencyKey,
    request,
    supplierId: adapter.supplierId,
    fn: async () => {
      if (!adapter.cancelBooking) {
        return {
          success: false,
          bookingId: request.bookingId,
          message: 'Adapter does not support cancelBooking',
          kind: request.kind,
        };
      }
      const result = await adapter.cancelBooking(request.bookingId);
      return {
        success: result.success,
        bookingId: request.bookingId,
        message: result.message,
        kind: request.kind,
      };
    },
  });
}
