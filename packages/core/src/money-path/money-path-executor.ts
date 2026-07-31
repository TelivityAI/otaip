/**
 * MoneyPathExecutor — default-enforced ledger + kill switch + live safety + ops
 * for irreversible supplier mutations (DoD 1/2/3/8).
 */

import { randomUUID } from 'node:crypto';
import { InMemoryEffectLedger } from '../effect-ledger/in-memory-effect-ledger.js';
import type { EffectLedger } from '../effect-ledger/types.js';
import type { MutationEffectType } from '../command-store/types.js';
import {
  getProcessMutationOpsCollector,
  MutationOpsCollector,
  type BookingFailureStage,
} from '../ops/mutation-ops.js';
import {
  assertIrreversibleAllowed,
  isLiveModeFromEnv,
  LiveSafetyError,
  type LiveSafetyModeConfig,
  type StoreDurability,
} from '../safety/live-safety-mode.js';
import {
  MutationKillSwitch,
  MutationKillSwitchError,
} from '../safety/mutation-kill-switch.js';
import { canonicalJson } from '../util/canonical-json.js';
import { createHash } from 'node:crypto';
import { isAmbiguousMutationError } from './ambiguity.js';
import {
  MoneyPathError,
  OutcomeUnknownError,
  type MoneyPathOutcome,
} from './types.js';

export interface MoneyPathExecutorConfig {
  readonly ledger?: EffectLedger;
  readonly killSwitch?: MutationKillSwitch;
  readonly ops?: MutationOpsCollector;
  /**
   * Optional durability override. May only equal or be stricter-as-ephemeral
   * relative to the ledger — never upgrade ephemeral → durable.
   * Default: ledger.durability.
   */
  readonly storeDurability?: StoreDurability;
  /** When true, mock adapters / synthetic ticketing are in use. */
  readonly mockAdapters?: boolean;
  /**
   * Override live detection. Default: `isLiveModeFromEnv()`.
   * Live + ephemeral/mock → refuse irreversible ops (not opt-in).
   */
  readonly liveMode?: boolean;
  readonly idFactory?: () => string;
  /** Override reconcile hint label for unknown outcomes. */
  readonly reconcileHint?: 'getBookingStatus' | 'getOrder';
}

function requestHash(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

function mapEffectType(operation: string): MutationEffectType {
  const op = operation.toLowerCase();
  if (op.includes('ticket')) return 'ticket';
  if (op.includes('void')) return 'void';
  if (op.includes('refund')) return 'refund';
  if (op.includes('cancel')) return 'cancel';
  if (op.includes('pay')) return 'pay';
  if (op.includes('book') || op.includes('order') || op.includes('modify')) {
    return 'book';
  }
  return 'book';
}

function effectTypeToStage(effectType: MutationEffectType): BookingFailureStage {
  switch (effectType) {
    case 'book':
      return 'book';
    case 'pay':
      return 'pay';
    case 'ticket':
      return 'ticket';
    case 'void':
      return 'void';
    case 'refund':
      return 'refund';
    case 'cancel':
      return 'cancel';
    case 'exchange':
      return 'unknown';
    default: {
      const _exhaustive: never = effectType;
      return _exhaustive;
    }
  }
}

/** Shared process kill switch — env engage at import time. */
const processKillSwitch = new MutationKillSwitch();
if ((process.env['OTAIP_MUTATION_KILL_SWITCH'] ?? '').trim() === '1') {
  processKillSwitch.engage('OTAIP_MUTATION_KILL_SWITCH=1');
}

export function getProcessMutationKillSwitch(): MutationKillSwitch {
  return processKillSwitch;
}

export class MoneyPathExecutor {
  private readonly ledger: EffectLedger;
  private readonly killSwitch: MutationKillSwitch;
  private readonly ops: MutationOpsCollector;
  private readonly storeDurability: StoreDurability;
  private readonly mockAdapters: boolean;
  private readonly liveMode: boolean;
  private readonly idFactory: () => string;
  private readonly reconcileHint: 'getBookingStatus' | 'getOrder';
  private readonly inFlight = new Map<string, Promise<MoneyPathOutcome<unknown>>>();

  constructor(config?: MoneyPathExecutorConfig) {
    this.ledger = config?.ledger ?? new InMemoryEffectLedger();
    this.killSwitch = config?.killSwitch ?? processKillSwitch;
    this.ops = config?.ops ?? getProcessMutationOpsCollector();

    const ledgerDurability = this.ledger.durability;
    if (config?.storeDurability === 'durable' && ledgerDurability === 'ephemeral') {
      throw new LiveSafetyError(
        'Cannot upgrade ephemeral EffectLedger to durable via storeDurability. ' +
          'Use FileEffectLedger (or another store-declared durable ledger).',
      );
    }
    this.storeDurability = config?.storeDurability ?? ledgerDurability;

    this.mockAdapters = config?.mockAdapters ?? false;
    this.liveMode = config?.liveMode ?? isLiveModeFromEnv();
    this.idFactory = config?.idFactory ?? ((): string => randomUUID());
    this.reconcileHint = config?.reconcileHint ?? 'getBookingStatus';
  }

  get effectLedger(): EffectLedger {
    return this.ledger;
  }

  get mutationKillSwitch(): MutationKillSwitch {
    return this.killSwitch;
  }

  get opsCollector(): MutationOpsCollector {
    return this.ops;
  }

  get safetyConfig(): LiveSafetyModeConfig {
    return {
      liveMode: this.liveMode,
      storeDurability: this.storeDurability,
      mockAdapters: this.mockAdapters,
    };
  }

  /**
   * Execute an unsafe mutation exactly once per idempotency key.
   * On ambiguous failure, records OUTCOME_UNKNOWN and does not auto-retry.
   */
  async executeUnsafe<T>(params: {
    operation: string;
    idempotencyKey: string;
    request: unknown;
    supplierId: string;
    agentId?: string;
    sessionId?: string;
    fn: () => Promise<T>;
  }): Promise<MoneyPathOutcome<T>> {
    if (!params.idempotencyKey || params.idempotencyKey.trim().length === 0) {
      throw new MoneyPathError(
        `Money-path operation '${params.operation}' requires a non-empty idempotencyKey`,
      );
    }

    const existing = this.inFlight.get(params.idempotencyKey);
    if (existing) {
      return existing as Promise<MoneyPathOutcome<T>>;
    }

    const run = this.runUnsafe<T>(params).finally(() => {
      this.inFlight.delete(params.idempotencyKey);
    });
    this.inFlight.set(params.idempotencyKey, run as Promise<MoneyPathOutcome<unknown>>);
    return run;
  }

  /**
   * Same as executeUnsafe but throws OutcomeUnknownError / original error
   * instead of returning a discriminated union (handy for adapter wrappers).
   */
  async executeUnsafeOrThrow<T>(params: {
    operation: string;
    idempotencyKey: string;
    request: unknown;
    supplierId: string;
    agentId?: string;
    sessionId?: string;
    fn: () => Promise<T>;
  }): Promise<T> {
    const outcome = await this.executeUnsafe(params);
    if (outcome.kind === 'succeeded') return outcome.value;
    if (outcome.kind === 'unknown') {
      throw new OutcomeUnknownError(
        'Prior mutation outcome unknown — reconcile before retry',
        {
          idempotencyKey: outcome.idempotencyKey,
          reconcileHint: outcome.reconcileHint,
          cause: outcome.error,
        },
      );
    }
    throw outcome.error instanceof Error
      ? outcome.error
      : new MoneyPathError(String(outcome.error));
  }

  private async runUnsafe<T>(params: {
    operation: string;
    idempotencyKey: string;
    request: unknown;
    supplierId: string;
    agentId?: string;
    sessionId?: string;
    fn: () => Promise<T>;
  }): Promise<MoneyPathOutcome<T>> {
    this.killSwitch.assertMutationsAllowed();
    assertIrreversibleAllowed(this.safetyConfig);

    const hash = requestHash(params.request);
    const effectType = mapEffectType(params.operation);
    const stage = effectTypeToStage(effectType);

    this.ops.recordIrreversible({
      actionId: this.idFactory(),
      effectType,
      payloadHash: hash,
      ...(params.agentId !== undefined ? { agentId: params.agentId } : {}),
      ...(params.sessionId !== undefined ? { sessionId: params.sessionId } : {}),
    });

    const begun = await this.ledger.begin<T>({
      effectId: this.idFactory(),
      effectType,
      idempotencyKey: params.idempotencyKey,
      requestHash: hash,
      supplierId: params.supplierId,
    });

    if (begun.kind === 'conflict') {
      this.ops.recordFailure({
        stage,
        code: 'IDEMPOTENCY_CONFLICT',
        supplierId: params.supplierId,
      });
      return {
        kind: 'failed',
        error: new MoneyPathError(begun.reason),
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
          error: new MoneyPathError('Replayed failed mutation'),
          replayed: true,
        };
      }
      if (begun.record.outcome === 'unknown' || begun.record.outcome === 'pending') {
        return {
          kind: 'unknown',
          error: new MoneyPathError(
            'Prior mutation outcome unknown — reconcile before retry',
          ),
          idempotencyKey: params.idempotencyKey,
          reconcileHint: this.reconcileHint,
        };
      }
    }

    try {
      const value = await params.fn();
      await this.ledger.resolve(params.idempotencyKey, 'succeeded', value);
      return { kind: 'succeeded', value, replayed: false };
    } catch (error) {
      if (error instanceof MutationKillSwitchError) {
        throw error;
      }
      if (isAmbiguousMutationError(error)) {
        await this.ledger.resolve(params.idempotencyKey, 'unknown');
        this.ops.recordFailure({
          stage,
          code: 'OUTCOME_UNKNOWN',
          supplierId: params.supplierId,
        });
        return {
          kind: 'unknown',
          error,
          idempotencyKey: params.idempotencyKey,
          reconcileHint: this.reconcileHint,
        };
      }
      await this.ledger.resolve(params.idempotencyKey, 'failed');
      this.ops.recordFailure({
        stage,
        code: 'MUTATION_FAILED',
        supplierId: params.supplierId,
      });
      return { kind: 'failed', error, replayed: false };
    }
  }
}
