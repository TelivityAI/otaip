/**
 * File-backed effect ledger — reference durable store for live drills.
 * Built on {@link FileCompareAndSwapPersistenceAdapter}.
 */

import { FileCompareAndSwapPersistenceAdapter } from '../persistence/file-cas-adapter.js';
import type { CompareAndSwapPersistenceAdapter } from '../persistence/types.js';
import { InMemoryEffectLedger } from './in-memory-effect-ledger.js';
import type {
  BeginEffectInput,
  BeginEffectResult,
  EffectLedger,
  EffectOutcome,
  EffectRecord,
} from './types.js';

/**
 * Durable EffectLedger. Declares `durability: 'durable'` so live mode
 * can execute irreversible ops without a caller-asserted durability upgrade.
 */
export class FileEffectLedger implements EffectLedger {
  readonly durability = 'durable' as const;
  private readonly inner: InMemoryEffectLedger;

  constructor(options: {
    /** Path to the JSON file used as the CAS store. */
    filePath: string;
    /** Optional override (must itself be durable). */
    persistence?: CompareAndSwapPersistenceAdapter;
    now?: () => Date;
  }) {
    const persistence =
      options.persistence ?? new FileCompareAndSwapPersistenceAdapter(options.filePath);
    if (persistence.durability !== 'durable') {
      throw new Error(
        'FileEffectLedger requires a durable CompareAndSwapPersistenceAdapter',
      );
    }
    this.inner = new InMemoryEffectLedger({
      persistence,
      ...(options.now !== undefined ? { now: options.now } : {}),
    });
  }

  begin<TResponse = unknown>(
    input: BeginEffectInput,
  ): Promise<BeginEffectResult<TResponse>> {
    return this.inner.begin(input);
  }

  resolve<TResponse = unknown>(
    idempotencyKey: string,
    outcome: Exclude<EffectOutcome, 'pending'>,
    response?: TResponse,
    externalRef?: string,
  ): Promise<EffectRecord<TResponse> | null> {
    return this.inner.resolve(idempotencyKey, outcome, response, externalRef);
  }

  get<TResponse = unknown>(
    idempotencyKey: string,
  ): Promise<EffectRecord<TResponse> | null> {
    return this.inner.get(idempotencyKey);
  }

  listUnresolved(olderThanMs?: number): Promise<readonly EffectRecord[]> {
    return this.inner.listUnresolved(olderThanMs);
  }

  listUnknown(olderThanMs?: number): Promise<readonly EffectRecord[]> {
    return this.inner.listUnknown(olderThanMs);
  }
}
