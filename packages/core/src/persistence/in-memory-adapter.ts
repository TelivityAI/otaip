import type {
  CompareAndSwapPersistenceAdapter,
  VersionedAggregate,
  VersionedAggregateStore,
} from './types.js';

interface StoredEntry<T> {
  value: T;
  expiresAt: number | null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * InMemoryPersistenceAdapter — Map-backed persistence with CAS helpers.
 *
 * Suitable for single-process usage and testing.
 * Live/production mode must refuse irreversible ops when this is the only store
 * (see LiveSafetyMode).
 */
export class InMemoryPersistenceAdapter implements CompareAndSwapPersistenceAdapter {
  private readonly store = new Map<string, StoredEntry<unknown>>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs !== undefined ? Date.now() + ttlMs : null;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async list(prefix: string): Promise<string[]> {
    const now = Date.now();
    const keys: string[] = [];
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.store.delete(key);
        continue;
      }
      if (key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    return keys;
  }

  async compareAndSet<T>(
    key: string,
    expected: T | undefined,
    value: T,
    ttlMs?: number,
  ): Promise<boolean> {
    // Synchronous check+write for single-thread atomicity under concurrent async callers.
    this.pruneExpired();
    const entry = this.store.get(key);
    const current = entry ? (entry.value as T) : undefined;
    if (expected === undefined) {
      if (current !== undefined) return false;
    } else if (!deepEqual(current, expected)) {
      return false;
    }
    const expiresAt = ttlMs !== undefined ? Date.now() + ttlMs : null;
    this.store.set(key, { value, expiresAt });
    return true;
  }

  async setIfAbsent<T>(key: string, value: T, ttlMs?: number): Promise<boolean> {
    // No await between check and write — keeps create-only atomic in the JS event loop.
    this.pruneExpired();
    const entry = this.store.get(key);
    if (entry) return false;
    const expiresAt = ttlMs !== undefined ? Date.now() + ttlMs : null;
    this.store.set(key, { value, expiresAt });
    return true;
  }

  /** Number of non-expired entries. Useful for testing. */
  get size(): number {
    this.pruneExpired();
    return this.store.size;
  }

  /** Remove all entries. */
  clear(): void {
    this.store.clear();
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * In-memory versioned aggregate store built on CAS persistence.
 */
export class InMemoryVersionedAggregateStore implements VersionedAggregateStore {
  constructor(
    private readonly persistence: CompareAndSwapPersistenceAdapter,
    private readonly keyPrefix = 'aggregate:',
  ) {}

  private key(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  async get<T>(aggregateId: string): Promise<VersionedAggregate<T> | null> {
    return this.persistence.get<VersionedAggregate<T>>(this.key(aggregateId));
  }

  async create<T>(aggregateId: string, data: T): Promise<boolean> {
    const row: VersionedAggregate<T> = { version: 1, data };
    return this.persistence.setIfAbsent(this.key(aggregateId), row);
  }

  async update<T>(aggregateId: string, expectedVersion: number, data: T): Promise<boolean> {
    const key = this.key(aggregateId);
    const current = await this.persistence.get<VersionedAggregate<T>>(key);
    if (!current || current.version !== expectedVersion) return false;
    const next: VersionedAggregate<T> = { version: expectedVersion + 1, data };
    return this.persistence.compareAndSet(key, current, next);
  }
}
