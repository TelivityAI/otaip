import type { CompareAndSwapPersistenceAdapter } from '../persistence/types.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import type {
  CommandRecord,
  CommandStatus,
  CommandStore,
  ReserveCommandInput,
  ReserveCommandResult,
} from './types.js';

function commandKey(scope: string, idempotencyKey: string): string {
  return `command:${scope}:${idempotencyKey}`;
}

/**
 * Command store backed by a CAS persistence adapter (in-memory by default).
 */
export class InMemoryCommandStore implements CommandStore {
  private readonly persistence: CompareAndSwapPersistenceAdapter;
  private readonly now: () => Date;

  constructor(options?: {
    persistence?: CompareAndSwapPersistenceAdapter;
    now?: () => Date;
  }) {
    this.persistence = options?.persistence ?? new InMemoryPersistenceAdapter();
    this.now = options?.now ?? (() => new Date());
  }

  async reserve<TResponse = unknown>(
    input: ReserveCommandInput,
  ): Promise<ReserveCommandResult<TResponse>> {
    const key = commandKey(input.scope, input.idempotencyKey);
    const existing = await this.persistence.get<CommandRecord<TResponse>>(key);
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
    const record: CommandRecord<TResponse> = {
      commandId: input.commandId,
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
      effectType: input.effectType,
      requestHash: input.requestHash,
      status: 'reserved',
      createdAt: ts,
      updatedAt: ts,
    };

    const created = await this.persistence.setIfAbsent(key, record);
    if (!created) {
      const raced = await this.persistence.get<CommandRecord<TResponse>>(key);
      if (!raced) {
        throw new Error('CommandStore reserve race: key missing after setIfAbsent failure');
      }
      if (raced.requestHash !== input.requestHash) {
        return {
          kind: 'conflict',
          record: raced,
          reason: 'idempotency key reused with different request hash',
        };
      }
      return { kind: 'replay', record: raced };
    }

    return { kind: 'reserved', record };
  }

  async complete<TResponse = unknown>(
    scope: string,
    idempotencyKey: string,
    status: Exclude<CommandStatus, 'reserved'>,
    response?: TResponse,
    externalRef?: string,
  ): Promise<CommandRecord<TResponse> | null> {
    const key = commandKey(scope, idempotencyKey);
    const current = await this.persistence.get<CommandRecord<TResponse>>(key);
    if (!current) return null;

    const next: CommandRecord<TResponse> = {
      ...current,
      status,
      ...(response !== undefined ? { response } : {}),
      ...(externalRef !== undefined ? { externalRef } : {}),
      updatedAt: this.now().toISOString(),
    };

    const ok = await this.persistence.compareAndSet(key, current, next);
    if (!ok) {
      return this.persistence.get<CommandRecord<TResponse>>(key);
    }
    return next;
  }

  async get<TResponse = unknown>(
    scope: string,
    idempotencyKey: string,
  ): Promise<CommandRecord<TResponse> | null> {
    return this.persistence.get<CommandRecord<TResponse>>(commandKey(scope, idempotencyKey));
  }
}
