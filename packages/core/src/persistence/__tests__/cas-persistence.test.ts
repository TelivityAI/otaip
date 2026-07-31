import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InMemoryPersistenceAdapter,
  InMemoryVersionedAggregateStore,
} from '../in-memory-adapter.js';
import { FileCompareAndSwapPersistenceAdapter } from '../file-cas-adapter.js';
import { InMemoryCommandStore } from '../../command-store/in-memory-command-store.js';
import { InMemoryEffectLedger } from '../../effect-ledger/in-memory-effect-ledger.js';

describe('CAS persistence', () => {
  let adapter: InMemoryPersistenceAdapter;

  beforeEach(() => {
    adapter = new InMemoryPersistenceAdapter();
  });

  it('compareAndSet succeeds when expected matches', async () => {
    await adapter.set('k', { v: 1 });
    const ok = await adapter.compareAndSet('k', { v: 1 }, { v: 2 });
    expect(ok).toBe(true);
    expect(await adapter.get('k')).toEqual({ v: 2 });
  });

  it('compareAndSet fails on mismatch', async () => {
    await adapter.set('k', { v: 1 });
    const ok = await adapter.compareAndSet('k', { v: 99 }, { v: 2 });
    expect(ok).toBe(false);
    expect(await adapter.get('k')).toEqual({ v: 1 });
  });

  it('setIfAbsent is create-only', async () => {
    expect(await adapter.setIfAbsent('n', 1)).toBe(true);
    expect(await adapter.setIfAbsent('n', 2)).toBe(false);
    expect(await adapter.get('n')).toBe(1);
  });

  it('versioned aggregate OCC', async () => {
    const store = new InMemoryVersionedAggregateStore(adapter);
    expect(await store.create('o1', { a: 1 })).toBe(true);
    expect(await store.create('o1', { a: 2 })).toBe(false);
    expect(await store.update('o1', 1, { a: 3 })).toBe(true);
    expect(await store.update('o1', 1, { a: 4 })).toBe(false);
    const row = await store.get<{ a: number }>('o1');
    expect(row?.version).toBe(2);
    expect(row?.data.a).toBe(3);
  });
});

describe('CommandStore + EffectLedger idempotency', () => {
  it('replays reserved commands', async () => {
    const store = new InMemoryCommandStore();
    const r1 = await store.reserve({
      commandId: 'c1',
      scope: 'book',
      idempotencyKey: 'idem-1',
      effectType: 'book',
      requestHash: 'h1',
    });
    expect(r1.kind).toBe('reserved');
    await store.complete('book', 'idem-1', 'succeeded', { bookingId: 'B1' });
    const r2 = await store.reserve({
      commandId: 'c2',
      scope: 'book',
      idempotencyKey: 'idem-1',
      effectType: 'book',
      requestHash: 'h1',
    });
    expect(r2.kind).toBe('replay');
    if (r2.kind === 'replay') {
      expect(r2.record.response).toEqual({ bookingId: 'B1' });
    }
  });

  it('100 concurrent reserves yield one reserved and rest replays', async () => {
    const store = new InMemoryCommandStore();
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        store.reserve({
          commandId: `c-${i}`,
          scope: 'book',
          idempotencyKey: 'same',
          effectType: 'book',
          requestHash: 'hash',
        }),
      ),
    );
    const reserved = results.filter((r) => r.kind === 'reserved');
    const replays = results.filter((r) => r.kind === 'replay');
    expect(reserved.length).toBe(1);
    expect(replays.length).toBe(99);
  });

  it('effect ledger marks unknown and lists it', async () => {
    const ledger = new InMemoryEffectLedger();
    await ledger.begin({
      effectId: 'e1',
      effectType: 'book',
      idempotencyKey: 'k1',
      requestHash: 'h',
      supplierId: 'sabre',
    });
    await ledger.resolve('k1', 'unknown');
    const unknown = await ledger.listUnknown(0);
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.outcome).toBe('unknown');
  });
});

describe('FileCompareAndSwapPersistenceAdapter flock', () => {
  it('concurrent setIfAbsent yields a single create', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'otaip-filecas-'));
    const adapter = new FileCompareAndSwapPersistenceAdapter(join(dir, 'db.json'));
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => adapter.setIfAbsent('k', i)),
    );
    expect(results.filter(Boolean).length).toBe(1);
    expect(await adapter.get('k')).toBe(0);
  });

  it('compareAndSet is serialized under lock', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'otaip-filecas-'));
    const adapter = new FileCompareAndSwapPersistenceAdapter(join(dir, 'db.json'));
    await adapter.set('counter', 0);
    await Promise.all(
      Array.from({ length: 20 }, async () => {
        for (;;) {
          const cur = await adapter.get<number>('counter');
          if (cur === null) throw new Error('missing');
          const ok = await adapter.compareAndSet('counter', cur, cur + 1);
          if (ok) break;
        }
      }),
    );
    expect(await adapter.get('counter')).toBe(20);
  });
});

