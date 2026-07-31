import type { CompareAndSwapPersistenceAdapter } from '../persistence/types.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import type {
  BeginEffectInput,
  BeginEffectResult,
  EffectLedger,
  EffectOutcome,
  EffectRecord,
} from './types.js';

const KEY_PREFIX = 'effect:';

export class InMemoryEffectLedger implements EffectLedger {
  private readonly persistence: CompareAndSwapPersistenceAdapter;
  private readonly now: () => Date;

  constructor(options?: {
    persistence?: CompareAndSwapPersistenceAdapter;
    now?: () => Date;
  }) {
    this.persistence = options?.persistence ?? new InMemoryPersistenceAdapter();
    this.now = options?.now ?? ((): Date => new Date());
  }

  async begin<TResponse = unknown>(
    input: BeginEffectInput,
  ): Promise<BeginEffectResult<TResponse>> {
    const key = `${KEY_PREFIX}${input.idempotencyKey}`;
    const existing = await this.persistence.get<EffectRecord<TResponse>>(key);
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        return {
          kind: 'conflict',
          record: existing,
          reason: 'idempotency key reused with different request hash',
        };
      }
      return { kind: 'replay', record: existing };
    }

    const ts = this.now().toISOString();
    const record: EffectRecord<TResponse> = {
      effectId: input.effectId,
      effectType: input.effectType,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      outcome: 'pending',
      ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
      createdAt: ts,
      updatedAt: ts,
    };

    const created = await this.persistence.setIfAbsent(key, record);
    if (!created) {
      const raced = await this.persistence.get<EffectRecord<TResponse>>(key);
      if (!raced) throw new Error('EffectLedger begin race: missing record');
      if (raced.requestHash !== input.requestHash) {
        return {
          kind: 'conflict',
          record: raced,
          reason: 'idempotency key reused with different request hash',
        };
      }
      return { kind: 'replay', record: raced };
    }

    return { kind: 'begun', record };
  }

  async resolve<TResponse = unknown>(
    idempotencyKey: string,
    outcome: Exclude<EffectOutcome, 'pending'>,
    response?: TResponse,
    externalRef?: string,
  ): Promise<EffectRecord<TResponse> | null> {
    const key = `${KEY_PREFIX}${idempotencyKey}`;
    const current = await this.persistence.get<EffectRecord<TResponse>>(key);
    if (!current) return null;

    // Terminal outcomes are immutable — replay returns stored record.
    if (current.outcome !== 'pending' && current.outcome !== 'unknown') {
      return current;
    }

    const next: EffectRecord<TResponse> = {
      ...current,
      outcome,
      ...(response !== undefined ? { response } : {}),
      ...(externalRef !== undefined ? { externalRef } : {}),
      updatedAt: this.now().toISOString(),
    };

    const ok = await this.persistence.compareAndSet(key, current, next);
    if (!ok) return this.persistence.get<EffectRecord<TResponse>>(key);
    return next;
  }

  async get<TResponse = unknown>(
    idempotencyKey: string,
  ): Promise<EffectRecord<TResponse> | null> {
    return this.persistence.get<EffectRecord<TResponse>>(`${KEY_PREFIX}${idempotencyKey}`);
  }

  async listUnknown(olderThanMs = 0): Promise<readonly EffectRecord[]> {
    const keys = await this.persistence.list(KEY_PREFIX);
    const now = this.now().getTime();
    const out: EffectRecord[] = [];
    for (const key of keys) {
      const record = await this.persistence.get<EffectRecord>(key);
      if (!record || record.outcome !== 'unknown') continue;
      const age = now - Date.parse(record.updatedAt);
      if (age >= olderThanMs) out.push(record);
    }
    return out;
  }
}
