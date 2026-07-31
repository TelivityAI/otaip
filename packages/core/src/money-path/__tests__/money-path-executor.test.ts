import { describe, it, expect } from 'vitest';
import { InMemoryEffectLedger } from '../../effect-ledger/in-memory-effect-ledger.js';
import { FileCompareAndSwapPersistenceAdapter } from '../../persistence/file-cas-adapter.js';
import { MutationKillSwitch } from '../../safety/mutation-kill-switch.js';
import { LiveSafetyError } from '../../safety/live-safety-mode.js';
import { MoneyPathExecutor } from '../money-path-executor.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  it('refuses live mode with ephemeral stores by default', async () => {
    const exec = new MoneyPathExecutor({ liveMode: true });
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

  it('allows live mode with durable file-backed ledger', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'otaip-mp-'));
    const persistence = new FileCompareAndSwapPersistenceAdapter(join(dir, 'ledger.json'));
    const ledger = new InMemoryEffectLedger({ persistence });
    const exec = new MoneyPathExecutor({
      ledger,
      storeDurability: 'durable',
      liveMode: true,
    });
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
    const exec = new MoneyPathExecutor({ liveMode: false });
    await exec.executeUnsafe({
      operation: 'book',
      idempotencyKey: 'ops-1',
      request: { x: 1 },
      supplierId: 'x',
      fn: async () => ({ ok: true }),
    });
    expect(exec.opsCollector.listAudits().length).toBe(1);
  });
});
