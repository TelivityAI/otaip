import { describe, it, expect, vi } from 'vitest';
import { InMemoryEffectLedger, MutationKillSwitch } from '@otaip/core';
import { MutationExecutor } from '../mutation-executor.js';
import { ConnectError } from '../base-adapter.js';
import { executeReversal } from '../reversal-saga.js';
import type { ConnectAdapter, BookingStatusResult } from '../types.js';
import { classifyAdapterOperation } from '../operation-class.js';

describe('operation classification', () => {
  it('marks book/ticket/cancel unsafe and search safe', () => {
    expect(classifyAdapterOperation('createBooking')).toBe('unsafe');
    expect(classifyAdapterOperation('requestTicketing')).toBe('unsafe');
    expect(classifyAdapterOperation('cancelBooking')).toBe('unsafe');
    expect(classifyAdapterOperation('searchFlights')).toBe('safe');
    expect(classifyAdapterOperation('getBookingStatus')).toBe('safe');
  });
});

describe('MutationExecutor', () => {
  it('does not auto-retry; marks unknown on ambiguous failure', async () => {
    const ledger = new InMemoryEffectLedger();
    const exec = new MutationExecutor({ ledger });
    let calls = 0;
    const outcome = await exec.execute({
      operation: 'createBooking',
      idempotencyKey: 'idem-a',
      request: { offerId: 'o1' },
      supplierId: 'test',
      fn: async () => {
        calls += 1;
        throw new ConnectError('createBooking failed: 503', 'test', 'createBooking', true);
      },
    });
    expect(calls).toBe(1);
    expect(outcome.kind).toBe('unknown');
    const record = await ledger.get('idem-a');
    expect(record?.outcome).toBe('unknown');
  });

  it('replays succeeded effect without re-invoking fn', async () => {
    const ledger = new InMemoryEffectLedger();
    const exec = new MutationExecutor({ ledger });
    let calls = 0;
    const first = await exec.execute({
      operation: 'createBooking',
      idempotencyKey: 'idem-b',
      request: { offerId: 'o1' },
      supplierId: 'test',
      fn: async () => {
        calls += 1;
        return { bookingId: 'B1' };
      },
    });
    const second = await exec.execute({
      operation: 'createBooking',
      idempotencyKey: 'idem-b',
      request: { offerId: 'o1' },
      supplierId: 'test',
      fn: async () => {
        calls += 1;
        return { bookingId: 'B2' };
      },
    });
    expect(first.kind).toBe('succeeded');
    expect(second.kind).toBe('succeeded');
    if (second.kind === 'succeeded') {
      expect(second.replayed).toBe(true);
      expect(second.value).toEqual({ bookingId: 'B1' });
    }
    expect(calls).toBe(1);
  });

  it('100 concurrent executes produce one supplier call', async () => {
    const ledger = new InMemoryEffectLedger();
    const exec = new MutationExecutor({ ledger });
    let calls = 0;
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        exec.execute({
          operation: 'createBooking',
          idempotencyKey: 'concurrent',
          request: { offerId: 'o1' },
          supplierId: 'test',
          fn: async () => {
            calls += 1;
            await new Promise((r) => setTimeout(r, 5));
            return { bookingId: 'ONLY' };
          },
        }),
      ),
    );
    expect(calls).toBe(1);
    expect(results.every((r) => r.kind === 'succeeded')).toBe(true);
  });

  it('respects kill switch', async () => {
    const killSwitch = new MutationKillSwitch();
    killSwitch.engage('test');
    const exec = new MutationExecutor({ killSwitch });
    await expect(
      exec.execute({
        operation: 'createBooking',
        idempotencyKey: 'k',
        request: {},
        supplierId: 't',
        fn: async () => ({ ok: true }),
      }),
    ).rejects.toThrow(/kill switch/i);
  });

  it('reconciles via getBookingStatus', async () => {
    const exec = new MutationExecutor();
    const status: BookingStatusResult = {
      bookingId: 'B1',
      supplier: 'test',
      status: 'confirmed',
      pnr: 'ABC123',
      segments: [],
      passengers: [],
      totalPrice: { amount: '1', currency: 'USD' },
    };
    const adapter = {
      supplierId: 'test',
      getBookingStatus: vi.fn(async () => status),
    } as unknown as ConnectAdapter;
    const result = await exec.reconcileBooking(adapter, 'B1', 'idem-r');
    expect(result.pnr).toBe('ABC123');
  });
});

describe('executeReversal', () => {
  it('runs cancel through ledger', async () => {
    const adapter = {
      supplierId: 'test',
      cancelBooking: vi.fn(async () => ({ success: true, message: 'ok' })),
    } as unknown as ConnectAdapter;
    const outcome = await executeReversal(adapter, {
      kind: 'cancel',
      bookingId: 'B1',
      idempotencyKey: 'rev-1',
    });
    expect(outcome.kind).toBe('succeeded');
    expect(adapter.cancelBooking).toHaveBeenCalledOnce();
  });
});
