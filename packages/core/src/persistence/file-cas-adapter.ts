/**
 * File-backed CAS persistence — reference durable store for local/test use.
 * Not multi-writer safe across processes; suitable for single-node drills.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CompareAndSwapPersistenceAdapter } from './types.js';

interface FileEntry {
  value: unknown;
  expiresAt: number | null;
}

interface FileDb {
  entries: Record<string, FileEntry>;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export class FileCompareAndSwapPersistenceAdapter implements CompareAndSwapPersistenceAdapter {
  readonly durability = 'durable' as const;
  private readonly path: string;

  constructor(filePath: string) {
    this.path = filePath;
    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      this.writeDb({ entries: {} });
    }
  }

  private readDb(): FileDb {
    const raw = readFileSync(this.path, 'utf8');
    try {
      return JSON.parse(raw) as FileDb;
    } catch {
      return { entries: {} };
    }
  }

  private writeDb(db: FileDb): void {
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(db), 'utf8');
    renameSync(tmp, this.path);
  }

  private prune(db: FileDb): void {
    const now = Date.now();
    for (const [key, entry] of Object.entries(db.entries)) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        delete db.entries[key];
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const db = this.readDb();
    this.prune(db);
    const entry = db.entries[key];
    if (!entry) return null;
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const db = this.readDb();
    this.prune(db);
    db.entries[key] = {
      value,
      expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : null,
    };
    this.writeDb(db);
  }

  async delete(key: string): Promise<boolean> {
    const db = this.readDb();
    this.prune(db);
    const existed = key in db.entries;
    delete db.entries[key];
    this.writeDb(db);
    return existed;
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async list(prefix: string): Promise<string[]> {
    const db = this.readDb();
    this.prune(db);
    return Object.keys(db.entries).filter((k) => k.startsWith(prefix));
  }

  async compareAndSet<T>(
    key: string,
    expected: T | undefined,
    value: T,
    ttlMs?: number,
  ): Promise<boolean> {
    const db = this.readDb();
    this.prune(db);
    const current = db.entries[key]?.value as T | undefined;
    if (expected === undefined) {
      if (current !== undefined) return false;
    } else if (!deepEqual(current, expected)) {
      return false;
    }
    db.entries[key] = {
      value,
      expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : null,
    };
    this.writeDb(db);
    return true;
  }

  async setIfAbsent<T>(key: string, value: T, ttlMs?: number): Promise<boolean> {
    const db = this.readDb();
    this.prune(db);
    if (key in db.entries) return false;
    db.entries[key] = {
      value,
      expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : null,
    };
    this.writeDb(db);
    return true;
  }
}
