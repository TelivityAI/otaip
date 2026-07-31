/**
 * EffectLedger — durable record of external money-path side effects.
 *
 * Every book/pay/ticket/void/refund/cancel goes through the ledger so crashes
 * and client retries replay the stored outcome instead of re-issuing.
 */

import type { MutationEffectType } from '../command-store/types.js';
import type { StoreDurability } from '../safety/live-safety-mode.js';

export type EffectOutcome = 'pending' | 'succeeded' | 'failed' | 'unknown';

export interface EffectRecord<TResponse = unknown> {
  readonly effectId: string;
  readonly effectType: MutationEffectType;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly outcome: EffectOutcome;
  readonly response?: TResponse;
  readonly externalRef?: string;
  readonly supplierId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BeginEffectInput {
  readonly effectId: string;
  readonly effectType: MutationEffectType;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly supplierId?: string;
}

export type BeginEffectResult<TResponse = unknown> =
  | { readonly kind: 'begun'; readonly record: EffectRecord<TResponse> }
  | { readonly kind: 'replay'; readonly record: EffectRecord<TResponse> }
  | { readonly kind: 'conflict'; readonly record: EffectRecord<TResponse>; readonly reason: string };

export interface EffectLedger {
  /**
   * Store-declared durability. MoneyPathExecutor reads this — callers cannot
   * upgrade an ephemeral ledger to durable via config.
   */
  readonly durability: StoreDurability;

  begin<TResponse = unknown>(input: BeginEffectInput): Promise<BeginEffectResult<TResponse>>;

  resolve<TResponse = unknown>(
    idempotencyKey: string,
    outcome: Exclude<EffectOutcome, 'pending'>,
    response?: TResponse,
    externalRef?: string,
  ): Promise<EffectRecord<TResponse> | null>;

  get<TResponse = unknown>(idempotencyKey: string): Promise<EffectRecord<TResponse> | null>;

  /**
   * List unresolved effects (outcome `unknown` or crash-left `pending`)
   * older than the given age threshold.
   */
  listUnresolved(olderThanMs?: number): Promise<readonly EffectRecord[]>;

  /** @deprecated Prefer {@link listUnresolved} — includes aged pending. */
  listUnknown(olderThanMs?: number): Promise<readonly EffectRecord[]>;
}
