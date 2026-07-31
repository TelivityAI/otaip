/**
 * Reversal saga — cancel/void/refund through the same MutationExecutor
 * ledger/idempotency rules as book (DoD 7).
 */

import type { ConnectAdapter } from './types.js';
import { MutationExecutor, type MutationOutcome } from './mutation-executor.js';

export type ReversalKind = 'cancel' | 'void' | 'refund';

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

/**
 * Execute a reversal using ledger-backed MutationExecutor.
 * Does not auto-retry after ambiguous failure.
 */
export async function executeReversal(
  adapter: ConnectAdapter,
  request: ReversalRequest,
  executor: MutationExecutor = new MutationExecutor(),
): Promise<MutationOutcome<ReversalResult>> {
  const operation =
    request.kind === 'cancel'
      ? 'cancelBooking'
      : request.kind === 'void'
        ? 'cancelBooking'
        : 'cancelBooking';

  return executor.execute({
    operation,
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
