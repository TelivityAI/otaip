import { randomUUID } from 'node:crypto';
import type { CompareAndSwapPersistenceAdapter } from '../persistence/types.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import type {
  DurableTimer,
  DurableTimerStore,
  OutboxMessage,
  OutboxStore,
} from './types.js';

const OUTBOX_PREFIX = 'outbox:';
const TIMER_PREFIX = 'timer:';

export class InMemoryOutboxStore implements OutboxStore {
  private readonly persistence: CompareAndSwapPersistenceAdapter;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options?: {
    persistence?: CompareAndSwapPersistenceAdapter;
    now?: () => Date;
    idFactory?: () => string;
  }) {
    this.persistence = options?.persistence ?? new InMemoryPersistenceAdapter();
    this.now = options?.now ?? (() => new Date());
    this.idFactory = options?.idFactory ?? (() => randomUUID());
  }

  async enqueue<TPayload = unknown>(
    kind: string,
    payload: TPayload,
    availableAt?: Date,
  ): Promise<OutboxMessage<TPayload>> {
    const ts = this.now().toISOString();
    const msg: OutboxMessage<TPayload> = {
      id: this.idFactory(),
      kind,
      payload,
      availableAt: (availableAt ?? this.now()).toISOString(),
      status: 'pending',
      attempts: 0,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.persistence.set(`${OUTBOX_PREFIX}${msg.id}`, msg);
    return msg;
  }

  async claimDue(limit = 10): Promise<readonly OutboxMessage[]> {
    const nowIso = this.now().toISOString();
    const keys = await this.persistence.list(OUTBOX_PREFIX);
    const claimed: OutboxMessage[] = [];

    for (const key of keys) {
      if (claimed.length >= limit) break;
      const msg = await this.persistence.get<OutboxMessage>(key);
      if (!msg || msg.status !== 'pending') continue;
      if (msg.availableAt > nowIso) continue;

      const next: OutboxMessage = {
        ...msg,
        status: 'processing',
        attempts: msg.attempts + 1,
        updatedAt: this.now().toISOString(),
      };
      const ok = await this.persistence.compareAndSet(key, msg, next);
      if (ok) claimed.push(next);
    }

    return claimed;
  }

  async markDone(id: string): Promise<void> {
    await this.setStatus(id, 'done');
  }

  async markFailed(id: string): Promise<void> {
    await this.setStatus(id, 'failed');
  }

  private async setStatus(id: string, status: 'done' | 'failed'): Promise<void> {
    const key = `${OUTBOX_PREFIX}${id}`;
    const current = await this.persistence.get<OutboxMessage>(key);
    if (!current) return;
    const next: OutboxMessage = {
      ...current,
      status,
      updatedAt: this.now().toISOString(),
    };
    await this.persistence.compareAndSet(key, current, next);
  }
}

export class InMemoryDurableTimerStore implements DurableTimerStore {
  private readonly persistence: CompareAndSwapPersistenceAdapter;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options?: {
    persistence?: CompareAndSwapPersistenceAdapter;
    now?: () => Date;
    idFactory?: () => string;
  }) {
    this.persistence = options?.persistence ?? new InMemoryPersistenceAdapter();
    this.now = options?.now ?? (() => new Date());
    this.idFactory = options?.idFactory ?? (() => randomUUID());
  }

  async schedule(kind: string, fireAt: Date, payload: unknown): Promise<DurableTimer> {
    const timer: DurableTimer = {
      id: this.idFactory(),
      kind,
      fireAt: fireAt.toISOString(),
      payload,
      cancelled: false,
      createdAt: this.now().toISOString(),
    };
    await this.persistence.set(`${TIMER_PREFIX}${timer.id}`, timer);
    return timer;
  }

  async cancel(id: string): Promise<boolean> {
    const key = `${TIMER_PREFIX}${id}`;
    const current = await this.persistence.get<DurableTimer>(key);
    if (!current || current.cancelled) return false;
    const next: DurableTimer = { ...current, cancelled: true };
    return this.persistence.compareAndSet(key, current, next);
  }

  async due(now?: Date): Promise<readonly DurableTimer[]> {
    const cutoff = (now ?? this.now()).toISOString();
    const keys = await this.persistence.list(TIMER_PREFIX);
    const out: DurableTimer[] = [];
    for (const key of keys) {
      const timer = await this.persistence.get<DurableTimer>(key);
      if (!timer || timer.cancelled) continue;
      if (timer.fireAt <= cutoff) out.push(timer);
    }
    return out;
  }
}
