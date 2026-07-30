import { describe, it, expect } from 'vitest';
import { MutationOpsCollector } from '../mutation-ops.js';

describe('MutationOpsCollector', () => {
  it('aggregates failures by stage and records irreversible audits', () => {
    const ops = new MutationOpsCollector(() => new Date('2026-01-01T00:00:00Z'));
    ops.recordFailure({ stage: 'book', code: '503' });
    ops.recordFailure({ stage: 'book', code: 'timeout' });
    ops.recordFailure({ stage: 'ticket', code: 'fail' });
    ops.recordIrreversible({
      actionId: 'a1',
      effectType: 'ticket',
      payloadHash: 'abc',
      externalRef: 'TKT1',
    });
    const byStage = ops.failuresByStage();
    expect(byStage.get('book')).toBe(2);
    expect(byStage.get('ticket')).toBe(1);
    expect(ops.listAudits()).toHaveLength(1);
  });
});
