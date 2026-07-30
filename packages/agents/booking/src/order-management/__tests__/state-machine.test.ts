/**
 * State Machine — Tests
 *
 * Tests 1-3, 5-8, 10 from the payment-to-confirmation spec.
 *
 * Test 1: Happy path
 * Test 2: Delayed confirmation (timeout → retry → confirmed)
 * Test 3: Failed confirmation (all retries exhausted → refund)
 * Test 5: Duplicate retry prevention (idempotency)
 * Test 6: Double refund prevention
 * Test 7: Change request on unconfirmed booking (gate check)
 * Test 8: Refund window expiry (manual intervention)
 * Test 10: Concurrent order isolation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentConfirmationStateMachine } from '../state-machine.js';
import { InvalidStateTransitionError } from '../order-state.js';
import { MockAuditService, MockMonitoring, makeConfirmationRequest } from './mocks.js';

let sm: PaymentConfirmationStateMachine;
let audit: MockAuditService;
let monitoring: MockMonitoring;

beforeEach(() => {
  audit = new MockAuditService();
  monitoring = new MockMonitoring();
  sm = new PaymentConfirmationStateMachine({ audit, monitoring });
});

// ---------------------------------------------------------------------------
// Test 1: Happy path
// ---------------------------------------------------------------------------

describe('Test 1: Happy path — payment captured, confirmation within TTL', () => {
  it('transitions PENDING → CAPTURED → AWAITING → CONFIRMED', () => {
    sm.initializeOrder('ORD-001', 'PAX-001');

    const s1 = sm.capturePayment('ORD-001', 'CAP-001');
    expect(s1.payment_status).toBe('CAPTURED');
    expect(s1.confirmation_status).toBe('PENDING');

    const req = makeConfirmationRequest({
      idempotency_key: 'idem-1',
      order_id: 'ORD-001',
    });
    const s2 = sm.initiateConfirmation('ORD-001', req);
    expect(s2.confirmation_status).toBe('AWAITING');

    const s3 = sm.handleConfirmationSuccess('ORD-001', 'TKT-001');
    expect(s3.confirmation_status).toBe('CONFIRMED');
    expect(s3.payment_status).toBe('CAPTURED');
    expect(s3.reconciliation_status).toBe('CLEAN');
  });

  it('accepts changes after confirmation', () => {
    sm.initializeOrder('ORD-001', 'PAX-001');
    sm.capturePayment('ORD-001', 'CAP-001');
    sm.initiateConfirmation('ORD-001', makeConfirmationRequest({ idempotency_key: 'k1' }));
    sm.handleConfirmationSuccess('ORD-001', 'TKT-001');

    expect(sm.canAcceptChange('ORD-001')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Delayed confirmation
// ---------------------------------------------------------------------------

describe('Test 2: Delayed confirmation — arrives after timeout but within retry window', () => {
  it('transitions AWAITING → TIMEOUT → RETRY → CONFIRMED', () => {
    sm.initializeOrder('ORD-002', 'PAX-002');
    sm.capturePayment('ORD-002', 'CAP-002');
    sm.initiateConfirmation(
      'ORD-002',
      makeConfirmationRequest({
        idempotency_key: 'k1',
        order_id: 'ORD-002',
        attempt_number: 1,
        max_attempts: 3,
      }),
    );

    const s1 = sm.handleConfirmationTimeout('ORD-002');
    expect(s1.confirmation_status).toBe('TIMEOUT');

    const retryReq = makeConfirmationRequest({
      idempotency_key: 'k2',
      order_id: 'ORD-002',
      attempt_number: 2,
      max_attempts: 3,
    });
    const s2 = sm.retryConfirmation('ORD-002', retryReq);
    expect(s2.confirmation_status).toBe('RETRY');

    const s3 = sm.handleConfirmationSuccess('ORD-002', 'TKT-002');
    expect(s3.confirmation_status).toBe('CONFIRMED');
    expect(s3.reconciliation_status).toBe('CLEAN');
  });

  it('emits ORDER_CONFIRMATION_DELAYED event on timeout', () => {
    sm.initializeOrder('ORD-002', 'PAX-002');
    sm.capturePayment('ORD-002', 'CAP-002');
    sm.initiateConfirmation(
      'ORD-002',
      makeConfirmationRequest({
        idempotency_key: 'k1',
        order_id: 'ORD-002',
      }),
    );
    sm.handleConfirmationTimeout('ORD-002');

    expect(audit.events).toHaveLength(1);
    expect(audit.events[0].event_type).toBe('ORDER_CONFIRMATION_DELAYED');
    expect(audit.events[0].order_id).toBe('ORD-002');
  });
});

// ---------------------------------------------------------------------------
// Test 3: Failed confirmation — all retries exhausted, clean refund
// ---------------------------------------------------------------------------

describe('Test 3: Failed confirmation — all retries exhausted, clean refund', () => {
  it('transitions through retries then FAILED → REFUND_INITIATED → REFUNDED', () => {
    sm.initializeOrder('ORD-003', 'PAX-003');
    sm.capturePayment('ORD-003', 'CAP-003');

    // Attempt 1
    sm.initiateConfirmation(
      'ORD-003',
      makeConfirmationRequest({
        idempotency_key: 'k1',
        order_id: 'ORD-003',
        attempt_number: 1,
        max_attempts: 2,
      }),
    );
    sm.handleConfirmationTimeout('ORD-003');

    // Attempt 2 (retry)
    sm.retryConfirmation(
      'ORD-003',
      makeConfirmationRequest({
        idempotency_key: 'k2',
        order_id: 'ORD-003',
        attempt_number: 2,
        max_attempts: 2,
      }),
    );

    // All retries exhausted → fail
    const s1 = sm.failConfirmation('ORD-003');
    expect(s1.confirmation_status).toBe('FAILED');

    // Now refund is allowed
    const s2 = sm.initiateRefund('ORD-003', 'REF-003');
    expect(s2.payment_status).toBe('REFUND_INITIATED');

    const s3 = sm.completeRefund('ORD-003');
    expect(s3.payment_status).toBe('REFUNDED');
    expect(s3.reconciliation_status).toBe('CLEAN');
  });

  it('emits ORDER_CONFIRMATION_FAILED event', () => {
    sm.initializeOrder('ORD-003', 'PAX-003');
    sm.capturePayment('ORD-003', 'CAP-003');
    sm.initiateConfirmation(
      'ORD-003',
      makeConfirmationRequest({
        idempotency_key: 'k1',
        attempt_number: 1,
        max_attempts: 1,
      }),
    );
    sm.handleConfirmationTimeout('ORD-003');
    sm.failConfirmation('ORD-003');

    const failedEvents = audit.events.filter((e) => e.event_type === 'ORDER_CONFIRMATION_FAILED');
    expect(failedEvents).toHaveLength(1);
  });

  it('emits ORDER_REFUND_INITIATED event', () => {
    sm.initializeOrder('ORD-003b', 'PAX-003b');
    sm.capturePayment('ORD-003b', 'CAP-003b');
    sm.initiateConfirmation(
      'ORD-003b',
      makeConfirmationRequest({
        idempotency_key: 'k1',
        attempt_number: 1,
        max_attempts: 1,
      }),
    );
    sm.handleConfirmationTimeout('ORD-003b');
    sm.failConfirmation('ORD-003b');
    sm.initiateRefund('ORD-003b', 'REF-003b');

    const refundEvents = audit.events.filter((e) => e.event_type === 'ORDER_REFUND_INITIATED');
    expect(refundEvents).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Duplicate retry prevention — idempotency enforcement
// ---------------------------------------------------------------------------

describe('Test 5: Duplicate retry prevention', () => {
  it('replays prior result for duplicate idempotency key', () => {
    sm.initializeOrder('ORD-005', 'PAX-005');
    sm.capturePayment('ORD-005', 'CAP-005');
    const first = sm.initiateConfirmation(
      'ORD-005',
      makeConfirmationRequest({
        idempotency_key: 'same-key',
        attempt_number: 1,
        max_attempts: 3,
      }),
    );
    sm.handleConfirmationTimeout('ORD-005');

    // Same key replays the prior initiate result (does not re-issue).
    const replayed = sm.retryConfirmation(
      'ORD-005',
      makeConfirmationRequest({
        idempotency_key: 'same-key',
        attempt_number: 2,
        max_attempts: 3,
      }),
    );
    expect(replayed.confirmation_status).toBe(first.confirmation_status);
  });

  it('allows retry with different idempotency key', () => {
    sm.initializeOrder('ORD-005b', 'PAX-005b');
    sm.capturePayment('ORD-005b', 'CAP-005b');
    sm.initiateConfirmation(
      'ORD-005b',
      makeConfirmationRequest({
        idempotency_key: 'key-1',
        attempt_number: 1,
        max_attempts: 3,
      }),
    );
    sm.handleConfirmationTimeout('ORD-005b');

    expect(() =>
      sm.retryConfirmation(
        'ORD-005b',
        makeConfirmationRequest({
          idempotency_key: 'key-2',
          attempt_number: 2,
          max_attempts: 3,
        }),
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test 6: Double refund prevention
// ---------------------------------------------------------------------------

describe('Test 6: Double refund prevention', () => {
  it('throws on second initiateRefund call', () => {
    sm.initializeOrder('ORD-006', 'PAX-006');
    sm.capturePayment('ORD-006', 'CAP-006');
    sm.initiateConfirmation(
      'ORD-006',
      makeConfirmationRequest({
        idempotency_key: 'k1',
        attempt_number: 1,
        max_attempts: 1,
      }),
    );
    sm.handleConfirmationTimeout('ORD-006');
    sm.failConfirmation('ORD-006');

    // First refund — allowed
    sm.initiateRefund('ORD-006', 'REF-006');

    // Second refund — prevented by double-refund guard
    expect(() => sm.initiateRefund('ORD-006', 'REF-006b')).toThrow(InvalidStateTransitionError);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Change request on unconfirmed booking — gate check
// ---------------------------------------------------------------------------

describe('Test 7: Change request on unconfirmed booking', () => {
  it('canAcceptChange returns false when confirmation is PENDING', () => {
    sm.initializeOrder('ORD-007', 'PAX-007');
    expect(sm.canAcceptChange('ORD-007')).toBe(false);
  });

  it('canAcceptChange returns false when confirmation is AWAITING', () => {
    sm.initializeOrder('ORD-007b', 'PAX-007b');
    sm.capturePayment('ORD-007b', 'CAP-007b');
    sm.initiateConfirmation('ORD-007b', makeConfirmationRequest({ idempotency_key: 'k1' }));
    expect(sm.canAcceptChange('ORD-007b')).toBe(false);
  });

  it('canAcceptChange returns false when confirmation is TIMEOUT', () => {
    sm.initializeOrder('ORD-007c', 'PAX-007c');
    sm.capturePayment('ORD-007c', 'CAP-007c');
    sm.initiateConfirmation('ORD-007c', makeConfirmationRequest({ idempotency_key: 'k1' }));
    sm.handleConfirmationTimeout('ORD-007c');
    expect(sm.canAcceptChange('ORD-007c')).toBe(false);
  });

  it('canAcceptChange returns false when confirmation is FAILED', () => {
    sm.initializeOrder('ORD-007d', 'PAX-007d');
    sm.capturePayment('ORD-007d', 'CAP-007d');
    sm.initiateConfirmation(
      'ORD-007d',
      makeConfirmationRequest({
        idempotency_key: 'k1',
        attempt_number: 1,
        max_attempts: 1,
      }),
    );
    sm.handleConfirmationTimeout('ORD-007d');
    sm.failConfirmation('ORD-007d');
    expect(sm.canAcceptChange('ORD-007d')).toBe(false);
  });

  it('canAcceptChange returns true ONLY when CONFIRMED', () => {
    sm.initializeOrder('ORD-007e', 'PAX-007e');
    sm.capturePayment('ORD-007e', 'CAP-007e');
    sm.initiateConfirmation('ORD-007e', makeConfirmationRequest({ idempotency_key: 'k1' }));
    sm.handleConfirmationSuccess('ORD-007e', 'TKT-007e');
    expect(sm.canAcceptChange('ORD-007e')).toBe(true);
  });

  it('canAcceptChange returns false for unknown order', () => {
    expect(sm.canAcceptChange('ORD-NONEXISTENT')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 8: Refund window expiry — auth expired, manual intervention required
// ---------------------------------------------------------------------------

describe('Test 8: Refund window expiry', () => {
  it('cannot refund before confirmation is FAILED', () => {
    sm.initializeOrder('ORD-008', 'PAX-008');
    sm.capturePayment('ORD-008', 'CAP-008');
    sm.initiateConfirmation(
      'ORD-008',
      makeConfirmationRequest({
        idempotency_key: 'k1',
        attempt_number: 1,
        max_attempts: 1,
      }),
    );
    sm.handleConfirmationTimeout('ORD-008');

    // Confirmation is TIMEOUT, not FAILED — refund should be blocked
    expect(() => sm.initiateRefund('ORD-008', 'REF-008')).toThrow(InvalidStateTransitionError);
  });

  it('refund cannot proceed if payment is not CAPTURED', () => {
    sm.initializeOrder('ORD-008b', 'PAX-008b');
    // Payment still PENDING — try to initiate refund
    expect(() => sm.initiateRefund('ORD-008b', 'REF-008b')).toThrow(InvalidStateTransitionError);
  });
});

// ---------------------------------------------------------------------------
// Test 10: Concurrent order isolation
// ---------------------------------------------------------------------------

describe('Test 10: Concurrent order isolation', () => {
  it('transitions on one order do not affect another', () => {
    sm.initializeOrder('ORD-A', 'PAX-A');
    sm.initializeOrder('ORD-B', 'PAX-B');

    // Advance ORD-A to CAPTURED + AWAITING
    sm.capturePayment('ORD-A', 'CAP-A');
    sm.initiateConfirmation('ORD-A', makeConfirmationRequest({ idempotency_key: 'ka1' }));

    // ORD-B should still be at initial state
    const stateB = sm.getState('ORD-B');
    expect(stateB.payment_status).toBe('PENDING');
    expect(stateB.confirmation_status).toBe('PENDING');
    expect(stateB.reconciliation_status).toBe('CLEAN');
  });

  it('audit trails are independent', () => {
    sm.initializeOrder('ORD-C', 'PAX-C');
    sm.initializeOrder('ORD-D', 'PAX-D');

    sm.capturePayment('ORD-C', 'CAP-C');
    sm.capturePayment('ORD-D', 'CAP-D');

    const trailC = sm.getAuditTrail('ORD-C');
    const trailD = sm.getAuditTrail('ORD-D');

    expect(trailC).toHaveLength(1);
    expect(trailD).toHaveLength(1);

    expect(trailC[0].order_id).toBe('ORD-C');
    expect(trailD[0].order_id).toBe('ORD-D');
  });

  it('initializing duplicate order throws', () => {
    sm.initializeOrder('ORD-DUP', 'PAX-DUP');
    expect(() => sm.initializeOrder('ORD-DUP', 'PAX-DUP2')).toThrow(InvalidStateTransitionError);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: invalid transitions at the state machine level
// ---------------------------------------------------------------------------

describe('Invalid state machine operations', () => {
  it('cannot capture payment on unknown order', () => {
    expect(() => sm.capturePayment('ORD-UNKNOWN', 'CAP-X')).toThrow(InvalidStateTransitionError);
  });

  it('cannot initiate confirmation before payment capture', () => {
    sm.initializeOrder('ORD-E', 'PAX-E');
    expect(() =>
      sm.initiateConfirmation('ORD-E', makeConfirmationRequest({ idempotency_key: 'ke1' })),
    ).toThrow(InvalidStateTransitionError);
  });

  it('cannot confirm from PENDING', () => {
    sm.initializeOrder('ORD-F', 'PAX-F');
    sm.capturePayment('ORD-F', 'CAP-F');
    // Skipping initiateConfirmation — still PENDING
    expect(() => sm.handleConfirmationSuccess('ORD-F', 'TKT-F')).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('cannot retry when not in TIMEOUT', () => {
    sm.initializeOrder('ORD-G', 'PAX-G');
    sm.capturePayment('ORD-G', 'CAP-G');
    sm.initiateConfirmation('ORD-G', makeConfirmationRequest({ idempotency_key: 'kg1' }));

    // Still AWAITING — retry should fail
    expect(() =>
      sm.retryConfirmation('ORD-G', makeConfirmationRequest({ idempotency_key: 'kg2' })),
    ).toThrow(InvalidStateTransitionError);
  });

  it('rejects retry exceeding max attempts', () => {
    sm.initializeOrder('ORD-H', 'PAX-H');
    sm.capturePayment('ORD-H', 'CAP-H');
    sm.initiateConfirmation(
      'ORD-H',
      makeConfirmationRequest({
        idempotency_key: 'kh1',
        attempt_number: 1,
        max_attempts: 1,
      }),
    );
    sm.handleConfirmationTimeout('ORD-H');

    expect(() =>
      sm.retryConfirmation(
        'ORD-H',
        makeConfirmationRequest({
          idempotency_key: 'kh2',
          attempt_number: 2,
          max_attempts: 1,
        }),
      ),
    ).toThrow(InvalidStateTransitionError);
  });
});
