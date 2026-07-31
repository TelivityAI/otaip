/**
 * File-backed CAS persistence — reference durable store for local/single-host use.
 *
 * Single-host multi-process safe via exclusive lockfile around RMW.
 * Not a distributed multi-writer store — deployers needing multi-node CAS
 * must inject their own CompareAndSwapPersistenceAdapter.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  constants,
} from 'node:fs';
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

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Exclusive lockfile (O_CREAT|O_EXCL) for single-host multi-process serialization.
 */
function withExclusiveLockfile<T>(lockPath: string, fn: () => T): T {
  const maxAttempts = 200;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let fd: number | undefined;
    try {
      fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      writeFileSync(fd, String(process.pid));
      try {
        return fn();
      } finally {
        closeSync(fd);
        fd = undefined;
        try {
          unlinkSync(lockPath);
        } catch {
          // ignore unlock races
        }
      }
    } catch (err: unknown) {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          // ignore
        }
      }
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        sleepMs(5);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`FileCompareAndSwapPersistenceAdapter lock timeout: ${lockPath}`);
}

export class FileCompareAndSwapPersistenceAdapter implements CompareAndSwapPersistenceAdapter {
  readonly durability = 'durable' as const;
  private readonly path: string;
  private readonly lockPath: string;
  /** In-process async mutex chain. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(filePath: string) {
    this.path = filePath;
    this.lockPath = `${filePath}.lock`;
    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      withExclusiveLockfile(this.lockPath, () => {
        if (!existsSync(filePath)) {
          this.writeDbUnlocked({ entries: {} });
        }
      });
    }
  }

  private readDbUnlocked(): FileDb {
    const raw = readFileSync(this.path, 'utf8');
    try {
      return JSON.parse(raw) as FileDb;
    } catch {
      return { entries: {} };
    }
  }

  private writeDbUnlocked(db: FileDb): void {
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

  private async withLock<T>(fn: () => T): Promise<T> {
    const run = this.chain.then(() => withExclusiveLockfile(this.lockPath, fn));
    // Prevent unhandled rejection on the chain if a caller abandons.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async get<T>(key: string): Promise<T | null> {
    return this.withLock(() => {
      const db = this.readDbUnlocked();
      this.prune(db);
      const entry = db.entries[key];
      if (!entry) return null;
      return entry.value as T;
    });
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    await this.withLock(() => {
      const db = this.readDbUnlocked();
      this.prune(db);
      db.entries[key] = {
        value,
        expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : null,
      };
      this.writeDbUnlocked(db);
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.withLock(() => {
      const db = this.readDbUnlocked();
      this.prune(db);
      const existed = key in db.entries;
      delete db.entries[key];
      this.writeDbUnlocked(db);
      return existed;
    });
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  async list(prefix: string): Promise<string[]> {
    return this.withLock(() => {
      const db = this.readDbUnlocked();
      this.prune(db);
      return Object.keys(db.entries).filter((k) => k.startsWith(prefix));
    });
  }

  async compareAndSet<T>(
    key: string,
    expected: T | undefined,
    value: T,
    ttlMs?: number,
  ): Promise<boolean> {
    return this.withLock(() => {
      const db = this.readDbUnlocked();
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
      this.writeDbUnlocked(db);
      return true;
    });
  }

  async setIfAbsent<T>(key: string, value: T, ttlMs?: number): Promise<boolean> {
    return this.withLock(() => {
      const db = this.readDbUnlocked();
      this.prune(db);
      if (key in db.entries) return false;
      db.entries[key] = {
        value,
        expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : null,
      };
      this.writeDbUnlocked(db);
      return true;
    });
  }
}
