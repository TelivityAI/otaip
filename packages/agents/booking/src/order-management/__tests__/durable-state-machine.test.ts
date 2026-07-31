import { describe, it, expect } from 'vitest';
import { InMemoryPersistenceAdapter } from '@otaip/core';
import { DurablePaymentConfirmationStateMachine } from '../durable-state-machine.js';

describe('DurablePaymentConfirmationStateMachine', () => {
  it('survives process restart via persistence', async () => {
    const persistence = new InMemoryPersistenceAdapter();
    const sm1 = new DurablePaymentConfirmationStateMachine({ persistence });
    await sm1.initializeOrder('ORD-D1', 'PAX-1');
    await sm1.capturePayment('ORD-D1', 'CAP-1');
    await sm1.initiateConfirmation('ORD-D1', {
      idempotency_key: 'k1',
      order_id: 'ORD-D1',
      payment_capture_ref: 'CAP-1',
      attempt_number: 1,
      max_attempts: 3,
      channel: 'GDS',
    });

    // New instance = "crash recovery"
    const sm2 = new DurablePaymentConfirmationStateMachine({ persistence });
    expect(await sm2.hasOrder('ORD-D1')).toBe(true);
    const state = await sm2.getState('ORD-D1');
    expect(state?.payment_status).toBe('CAPTURED');
    expect(state?.confirmation_status).toBe('AWAITING');
  });
});
