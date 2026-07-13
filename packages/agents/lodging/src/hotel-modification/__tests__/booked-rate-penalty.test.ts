/**
 * Verifies cancellation/no-show penalties are computed against the BOOKED
 * nightly rate passed in the input (not a hardcoded or current rate), and the
 * fallback when `nightlyRate` is omitted (Agent 20.6, issue #19).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HotelModificationAgent } from '../index.js';
import type { ModificationInput } from '../types.js';
import type { CancellationPolicy } from '../../types/hotel-common.js';

const refundablePolicy: CancellationPolicy = {
  refundable: true,
  deadlines: [{ hoursBeforeCheckin: 24, penaltyType: 'nights', penaltyValue: 1 }],
  freeCancel24hrBooking: true,
};

// Past the 24hr deadline (check-in 12h away) and past the California 24hr
// booking window (booked 48h ago) → a real 1-night penalty applies.
function pastDeadlineDates() {
  const now = new Date();
  return {
    checkInDate: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
    bookedAt: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
  };
}

function cancelInput(nightlyRate?: ModificationInput['nightlyRate']): ModificationInput {
  const { checkInDate, bookedAt } = pastDeadlineDates();
  const base: ModificationInput = {
    operation: 'cancel',
    bookingId: 'HB-0001',
    cancellationPolicy: refundablePolicy,
    checkInDate,
    bookedAt,
  };
  return nightlyRate ? { ...base, nightlyRate } : base;
}

let agent: HotelModificationAgent;
beforeAll(async () => {
  agent = new HotelModificationAgent();
  await agent.initialize();
});
afterAll(() => agent.destroy());

describe('penalty is calculated against the booked rate', () => {
  it('uses the booked nightly rate from the input (299)', async () => {
    const res = await agent.execute({
      data: cancelInput({ amount: '299.00', currency: 'USD' }),
    });
    expect(res.data.penalty?.isWithinFreeWindow).toBe(false);
    expect(res.data.penalty?.penaltyAmount.amount).toBe('299.00');
    expect(res.data.penalty?.penaltyAmount.currency).toBe('USD');
  });

  it('reflects a different booked rate (450) — proves it is not hardcoded', async () => {
    const res = await agent.execute({
      data: cancelInput({ amount: '450.00', currency: 'USD' }),
    });
    expect(res.data.penalty?.penaltyAmount.amount).toBe('450.00');
  });

  it('honors the booked currency (EUR)', async () => {
    const res = await agent.execute({
      data: cancelInput({ amount: '200.00', currency: 'EUR' }),
    });
    expect(res.data.penalty?.penaltyAmount.currency).toBe('EUR');
  });

  it('no-show penalty (one night) also uses the booked rate', async () => {
    const res = await agent.execute({
      data: { operation: 'process_no_show', bookingId: 'HB-0002', nightlyRate: { amount: '350.00', currency: 'USD' } },
    });
    expect(res.data.penalty?.penaltyType).toBe('one_night');
    expect(res.data.penalty?.penaltyAmount.amount).toBe('350.00');
  });
});

describe('fallback when nightlyRate is omitted', () => {
  it('cancellation falls back to 0.00 USD when no booked rate is supplied', async () => {
    const res = await agent.execute({ data: cancelInput() });
    expect(res.data.penalty?.penaltyAmount.amount).toBe('0.00');
    expect(res.data.penalty?.penaltyAmount.currency).toBe('USD');
  });

  it('no-show falls back to 0.00 USD when no booked rate is supplied', async () => {
    const res = await agent.execute({
      data: { operation: 'process_no_show', bookingId: 'HB-0003' },
    });
    expect(res.data.penalty?.penaltyAmount.amount).toBe('0.00');
    expect(res.data.penalty?.penaltyAmount.currency).toBe('USD');
  });
});
