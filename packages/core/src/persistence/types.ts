/**
 * PersistenceAdapter — injectable key-value store for stateful agents.
 *
 * Default implementation is in-memory (InMemoryPersistenceAdapter).
 * Consumers can inject Redis, PostgreSQL, or any other backend.
 *
 * For money-path durability, prefer {@link CompareAndSwapPersistenceAdapter}
 * (CAS / conditional write). Plain get/set alone cannot safely implement
 * multi-instance idempotency.
 */

import type { StoreDurability } from '../safety/live-safety-mode.js';

export interface PersistenceAdapter {
  /**
   * Store-declared durability. Never self-asserted by callers —
   * live money paths read this from the concrete store.
   */
  readonly durability: StoreDurability;

  /** Retrieve a value by key. Returns null if not found or expired. */
  get<T>(key: string): Promise<T | null>;

  /** Store a value. Optional TTL in milliseconds — after which the key expires. */
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;

  /** Delete a key. Returns true if the key existed. */
  delete(key: string): Promise<boolean>;

  /** Check if a key exists (and is not expired). */
  has(key: string): Promise<boolean>;

  /** List all keys matching a prefix. */
  list(prefix: string): Promise<string[]>;
}

/**
 * Compare-and-swap / conditional-write capabilities required for
 * multi-instance money-path state (idempotency, OCC).
 */
export interface CompareAndSwapPersistenceAdapter extends PersistenceAdapter {
  /**
   * Atomically set `key` to `value` only if the current stored value deep-equals
   * `expected` (or the key is absent when `expected` is `undefined`).
   * Returns true if the write succeeded.
   */
  compareAndSet<T>(key: string, expected: T | undefined, value: T, ttlMs?: number): Promise<boolean>;

  /**
   * Set `key` only if it does not already exist. Returns true if created.
   */
  setIfAbsent<T>(key: string, value: T, ttlMs?: number): Promise<boolean>;
}

/** Versioned aggregate row used with optimistic concurrency. */
export interface VersionedAggregate<T> {
  readonly version: number;
  readonly data: T;
}

/**
 * Optimistic-concurrency store for versioned aggregates (orders, pay-confirm).
 */
export interface VersionedAggregateStore {
  get<T>(aggregateId: string): Promise<VersionedAggregate<T> | null>;

  /**
   * Create aggregate at version 1 if absent. Returns false if already exists.
   */
  create<T>(aggregateId: string, data: T): Promise<boolean>;

  /**
   * Update only when `expectedVersion` matches. On success, version becomes
   * expectedVersion + 1. Returns false on conflict or missing aggregate.
   */
  update<T>(aggregateId: string, expectedVersion: number, data: T): Promise<boolean>;
}
