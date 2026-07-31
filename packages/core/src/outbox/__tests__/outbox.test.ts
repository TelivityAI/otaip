import { describe, it, expect } from 'vitest';
import { InMemoryDurableTimerStore, InMemoryOutboxStore } from '../in-memory-outbox.js';

describe('outbox + durable timers', () => {
  it('claims due outbox messages once', async () => {
    const box = new InMemoryOutboxStore({ idFactory: () => 'm1' });
    await box.enqueue('confirm.timeout', { orderId: 'O1' });
    const due1 = await box.claimDue();
    expect(due1).toHaveLength(1);
    const due2 = await box.claimDue();
    expect(due2).toHaveLength(0);
    await box.markDone('m1');
  });

  it('fires due timers', async () => {
    const timers = new InMemoryDurableTimerStore({ idFactory: () => 't1' });
    const past = new Date(Date.now() - 1000);
    await timers.schedule('ttl', past, { orderId: 'O1' });
    const due = await timers.due();
    expect(due).toHaveLength(1);
    await timers.cancel('t1');
    expect(await timers.due()).toHaveLength(0);
  });
});
