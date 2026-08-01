/**
 * FileEffectLedger: unresolved effects survive a fresh ledger instance (crash visibility).
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileEffectLedger } from '../file-effect-ledger.js';

describe('FileEffectLedger crash visibility', () => {
  it('fresh instance on same file sees prior unresolved pending/unknown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'otaip-ledger-'));
    const filePath = join(dir, 'effects.json');

    const ledgerA = new FileEffectLedger({ filePath });
    const begin = await ledgerA.begin({
      effectId: 'e-crash-1',
      effectType: 'book',
      idempotencyKey: 'crash-key-1',
      requestHash: 'hash-1',
      supplierId: 'test',
    });
    expect(begin.kind).toBe('begun');

    await ledgerA.resolve('crash-key-1', 'unknown');

    const ledgerB = new FileEffectLedger({ filePath });
    const unresolved = await ledgerB.listUnresolved();
    expect(unresolved.some((r) => r.idempotencyKey === 'crash-key-1')).toBe(true);
    const unknown = await ledgerB.listUnknown();
    expect(unknown.some((r) => r.idempotencyKey === 'crash-key-1')).toBe(true);
  });
});
