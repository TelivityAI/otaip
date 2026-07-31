import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileEffectLedger } from '../../effect-ledger/file-effect-ledger.js';
import { InMemoryEffectLedger } from '../../effect-ledger/in-memory-effect-ledger.js';
import { MutationOpsCollector } from '../../ops/mutation-ops.js';
import { MutationKillSwitch } from '../../safety/mutation-kill-switch.js';
import { LiveSafetyError } from '../../safety/live-safety-mode.js';
import { MoneyPathExecutor } from '../money-path-executor.js';

describe('MoneyPathExecutor', () => {
  it('marks ambiguous 503 as unknown and does not re-invoke on replay', async () => {
    const ledger = new InMemoryEffectLedger();
    const exec = new MoneyPathExecutor({ ledger, liveMode: false });
    let calls = 0;
    const first = await exec.executeUnsafe({
      operation: 'book',
      idempotencyKey: 'k1',
      request: { offer: 'o1' },
      supplierId: 'duffel',
      fn: async () => {
        calls += 1;
        throw new Error('Duffel API error 503: unavailable');
      },
    });
    expect(first.kind).toBe('unknown');
    const second = await exec.executeUnsafe({
      operation: 'book',
      idempotencyKey: 'k1',
      request: { offer: 'o1' },
      supplierId: 'duffel',
      fn: async () => {
        calls += 1;
        return { id: 'should-not' };
      },
    });
    expect(second.kind).toBe('unknown');
    expect(calls).toBe(1);
  });

  it('refuses live mode with ephemeral InMemoryEffectLedger', async () => {
    expect(
      () => new MoneyPathExecutor({ ledger: new InMemoryEffectLedger(), liveMode: true }),
    ).not.toThrow();
    const exec = new MoneyPathExecutor({
      ledger: new InMemoryEffectLedger(),
      liveMode: true,
    });
    await expect(
      exec.executeUnsafe({
        operation: 'book',
        idempotencyKey: 'live-1',
        request: {},
        supplierId: 'x',
        fn: async () => ({ ok: true }),
      }),
    ).rejects.toBeInstanceOf(LiveSafetyError);
  });

  it('rejects storeDurability upgrade of ephemeral ledger', () => {
    expect(
      () =>
        new MoneyPathExecutor({
          ledger: new InMemoryEffectLedger(),
          storeDurability: 'durable',
          liveMode: true,
        }),
    ).toThrow(LiveSafetyError);
  });

  it('allows live mode with FileEffectLedger (store-declared durable)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'otaip-mp-'));
    const ledger = new FileEffectLedger({ filePath: join(dir, 'ledger.json') });
    const exec = new MoneyPathExecutor({
      ledger,
      liveMode: true,
    });
    expect(exec.safetyConfig.storeDurability).toBe('durable');
    const outcome = await exec.executeUnsafe({
      operation: 'book',
      idempotencyKey: 'live-ok',
      request: { a: 1 },
      supplierId: 'x',
      fn: async () => ({ bookingId: 'B1' }),
    });
    expect(outcome.kind).toBe('succeeded');
  });

  it('respects kill switch', async () => {
    const kill = new MutationKillSwitch();
    kill.engage('test');
    const exec = new MoneyPathExecutor({ killSwitch: kill, liveMode: false });
    await expect(
      exec.executeUnsafe({
        operation: 'book',
        idempotencyKey: 'k',
        request: {},
        supplierId: 'x',
        fn: async () => ({ ok: true }),
      }),
    ).rejects.toThrow(/kill switch/i);
  });

  it('records ops audits on mutation', async () => {
    const ops = new MutationOpsCollector();
    const exec = new MoneyPathExecutor({ liveMode: false, ops });
    await exec.executeUnsafe({
      operation: 'book',
      idempotencyKey: 'ops-1',
      request: { x: 1 },
      supplierId: 'x',
      fn: async () => ({ ok: true }),
    });
    expect(ops.listAudits().length).toBe(1);
  });

  it('maps refund failures to refund stage', async () => {
    const ops = new MutationOpsCollector();
    const exec = new MoneyPathExecutor({ liveMode: false, ops });
    await exec.executeUnsafe({
      operation: 'refund',
      idempotencyKey: 'refund-1',
      request: {},
      supplierId: 'x',
      fn: async () => {
        throw new Error('refund failed hard');
      },
    });
    expect(ops.failuresByStage().get('refund')).toBe(1);
  });

  it('listUnresolved includes aged pending left by crash', async () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const ledger = new InMemoryEffectLedger({ now: () => now });
    await ledger.begin({
      effectId: 'e1',
      effectType: 'book',
      idempotencyKey: 'crash-pending',
      requestHash: 'abc',
      supplierId: 'x',
    });
    now = new Date('2026-01-01T00:05:00.000Z');
    const unresolved = await ledger.listUnresolved(60_000);
    expect(unresolved.some((r) => r.idempotencyKey === 'crash-pending')).toBe(true);
    expect(unresolved[0]?.outcome).toBe('pending');
  });
});
