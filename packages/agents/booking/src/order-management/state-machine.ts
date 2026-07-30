/**
 * Payment-to-Confirmation State Machine
 *
 * Agent 3.6: Tracks the lifecycle between payment capture and ticket issuance.
 * Handles timeouts, retries, refunds, late confirmations, and conflicts.
 *
 * Air domain ONLY. "Confirmation" means "ticket issued", NOT "PNR created".
 */

import type {
  OrderState,
  ConfirmationRequest,
  OrderStateEvent,
  OrderStateAuditEntry,
  PaymentStatus,
  ConfirmationStatus,
  ReconciliationStatus,
} from './order-state.js';
import {
  createInitialOrderState,
  validatePaymentTransition,
  validateConfirmationTransition,
  validateReconciliationTransition,
  InvalidStateTransitionError,
} from './order-state.js';

// ---------------------------------------------------------------------------
// Port interfaces for external agent dependencies
// ---------------------------------------------------------------------------

export interface AuditPort {
  record(event: OrderStateEvent): void;
}

export interface MonitoringPort {
  alert(message: string, severity: string, orderId: string): void;
}

// ---------------------------------------------------------------------------
// Internal managed order structure
// ---------------------------------------------------------------------------

export interface ManagedOrder {
  order_id: string;
  passenger_ref: string;
  state: OrderState;
  audit_trail: OrderStateAuditEntry[];
  idempotency_keys: Set<string>;
  refund_initiated: boolean;
  confirmation_request: ConfirmationRequest | null;
  payment_capture_ref: string | null;
  refund_id: string | null;
}

// ---------------------------------------------------------------------------
// Conflict resolution action (used by conflict-resolver.ts)
// ---------------------------------------------------------------------------

export type ConflictResolutionAction =
  | 'KEEP_REFUND_VOID_TICKET'
  | 'VOID_REFUND_KEEP_TICKET'
  | 'MANUAL_INTERVENTION';

export interface ConflictResolution {
  action: ConflictResolutionAction;
  reason: string;
  requires_manual_intervention: boolean;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

const AGENT_ID = '3.6';

export class PaymentConfirmationStateMachine {
  private orders: Map<string, ManagedOrder> = new Map();
  private auditPort: AuditPort | null;
  private monitoringPort: MonitoringPort | null;
  /** Last successful response per idempotency key for replay semantics. */
  private idempotencyReplays: Map<string, OrderState> = new Map();

  constructor(options?: { audit?: AuditPort; monitoring?: MonitoringPort }) {
    this.auditPort = options?.audit ?? null;
    this.monitoringPort = options?.monitoring ?? null;
  }

  /** Persistable snapshot for durable wrappers / crash recovery. */
  exportSnapshot(orderId: string): ManagedOrder | null {
    const order = this.orders.get(orderId);
    if (!order) return null;
    return {
      ...order,
      state: { ...order.state },
      audit_trail: [...order.audit_trail],
      idempotency_keys: new Set(order.idempotency_keys),
      confirmation_request: order.confirmation_request
        ? { ...order.confirmation_request }
        : null,
    };
  }

  /** Restore a previously exported snapshot (idempotent if already loaded). */
  restoreFromSnapshot(snapshot: ManagedOrder): void {
    if (this.orders.has(snapshot.order_id)) return;
    this.orders.set(snapshot.order_id, {
      ...snapshot,
      state: { ...snapshot.state },
      audit_trail: [...snapshot.audit_trail],
      idempotency_keys: new Set(snapshot.idempotency_keys),
      confirmation_request: snapshot.confirmation_request
        ? { ...snapshot.confirmation_request }
        : null,
    });
  }

  // -------------------------------------------------------------------------
  // Order lifecycle
  // -------------------------------------------------------------------------

  initializeOrder(orderId: string, passengerRef: string): OrderState {
    if (this.orders.has(orderId)) {
      throw new InvalidStateTransitionError(AGENT_ID, 'order', 'EXISTS', 'INITIALIZE');
    }
    const state = createInitialOrderState();
    this.orders.set(orderId, {
      order_id: orderId,
      passenger_ref: passengerRef,
      state,
      audit_trail: [],
      idempotency_keys: new Set(),
      refund_initiated: false,
      confirmation_request: null,
      payment_capture_ref: null,
      refund_id: null,
    });
    return { ...state };
  }

  // -------------------------------------------------------------------------
  // Payment transitions
  // -------------------------------------------------------------------------

  capturePayment(orderId: string, captureRef: string): OrderState {
    const order = this.getOrder(orderId);
    this.transitionPayment(order, 'CAPTURED', 'capturePayment', null);
    order.payment_capture_ref = captureRef;
    return this.cloneState(order.state);
  }

  initiateRefund(orderId: string, refundId: string): OrderState {
    const order = this.getOrder(orderId);

    // Guard: confirmation must be FAILED before refunding
    if (order.state.confirmation_status !== 'FAILED') {
      throw new InvalidStateTransitionError(
        AGENT_ID,
        'payment_status',
        order.state.payment_status,
        'REFUND_INITIATED',
      );
    }

    // Guard: double-refund prevention
    if (order.refund_initiated) {
      throw new InvalidStateTransitionError(
        AGENT_ID,
        'payment_status',
        'REFUND_INITIATED',
        'REFUND_INITIATED',
      );
    }

    this.transitionPayment(order, 'REFUND_INITIATED', 'initiateRefund', null);
    order.refund_initiated = true;
    order.refund_id = refundId;

    this.emitEvent(order, 'ORDER_REFUND_INITIATED', {
      refund_id: refundId,
      payment_capture_ref: order.payment_capture_ref,
    });

    return this.cloneState(order.state);
  }

  completeRefund(orderId: string): OrderState {
    const order = this.getOrder(orderId);
    this.transitionPayment(order, 'REFUNDED', 'completeRefund', null);
    return this.cloneState(order.state);
  }

  reverseRefund(orderId: string): OrderState {
    const order = this.getOrder(orderId);
    this.transitionPayment(order, 'REFUND_REVERSED', 'reverseRefund', null);
    return this.cloneState(order.state);
  }

  // -------------------------------------------------------------------------
  // Confirmation transitions
  // -------------------------------------------------------------------------

  initiateConfirmation(orderId: string, request: ConfirmationRequest): OrderState {
    const order = this.getOrder(orderId);

    // Replay prior result for the same idempotency key (DoD 2).
    if (order.idempotency_keys.has(request.idempotency_key)) {
      const replay = this.idempotencyReplays.get(`${orderId}:${request.idempotency_key}`);
      if (replay) return this.cloneState(replay);
      return this.cloneState(order.state);
    }

    // Guard: payment must be captured before requesting confirmation
    if (order.state.payment_status !== 'CAPTURED') {
      throw new InvalidStateTransitionError(
        AGENT_ID,
        'confirmation_status',
        order.state.confirmation_status,
        'AWAITING',
      );
    }

    // Track idempotency key
    order.idempotency_keys.add(request.idempotency_key);
    order.confirmation_request = { ...request };

    this.transitionConfirmation(order, 'AWAITING', 'initiateConfirmation', request.idempotency_key);
    const state = this.cloneState(order.state);
    this.idempotencyReplays.set(`${orderId}:${request.idempotency_key}`, state);
    return state;
  }

  handleConfirmationSuccess(orderId: string, _ticketRef: string): OrderState {
    const order = this.getOrder(orderId);

    // Valid from AWAITING or RETRY
    if (
      order.state.confirmation_status !== 'AWAITING' &&
      order.state.confirmation_status !== 'RETRY'
    ) {
      throw new InvalidStateTransitionError(
        AGENT_ID,
        'confirmation_status',
        order.state.confirmation_status,
        'CONFIRMED',
      );
    }

    this.transitionConfirmation(order, 'CONFIRMED', 'confirmationSuccess', null);
    return this.cloneState(order.state);
  }

  handleConfirmationTimeout(orderId: string): OrderState {
    const order = this.getOrder(orderId);

    // Valid from AWAITING or RETRY
    if (
      order.state.confirmation_status !== 'AWAITING' &&
      order.state.confirmation_status !== 'RETRY'
    ) {
      throw new InvalidStateTransitionError(
        AGENT_ID,
        'confirmation_status',
        order.state.confirmation_status,
        'TIMEOUT',
      );
    }

    this.transitionConfirmation(order, 'TIMEOUT', 'confirmationTimeout', null);

    this.emitEvent(order, 'ORDER_CONFIRMATION_DELAYED', {
      attempt_number: order.confirmation_request?.attempt_number ?? 0,
      max_attempts: order.confirmation_request?.max_attempts ?? 0,
    });

    return this.cloneState(order.state);
  }

  retryConfirmation(orderId: string, request: ConfirmationRequest): OrderState {
    const order = this.getOrder(orderId);

    // Guard: must be in TIMEOUT to retry
    if (order.state.confirmation_status !== 'TIMEOUT') {
      throw new InvalidStateTransitionError(
        AGENT_ID,
        'confirmation_status',
        order.state.confirmation_status,
        'RETRY',
      );
    }

    // Guard: idempotency — replay prior result for duplicate keys (DoD 2)
    if (order.idempotency_keys.has(request.idempotency_key)) {
      const replay = this.idempotencyReplays.get(`${orderId}:${request.idempotency_key}`);
      if (replay) return this.cloneState(replay);
      return this.cloneState(order.state);
    }

    // Guard: max retries not exceeded
    if (request.attempt_number > request.max_attempts) {
      throw new InvalidStateTransitionError(
        AGENT_ID,
        'attempt_number',
        String(request.attempt_number),
        String(request.max_attempts),
      );
    }

    order.idempotency_keys.add(request.idempotency_key);
    order.confirmation_request = { ...request };

    this.transitionConfirmation(order, 'RETRY', 'retryConfirmation', request.idempotency_key);
    const state = this.cloneState(order.state);
    this.idempotencyReplays.set(`${orderId}:${request.idempotency_key}`, state);
    return state;
  }

  failConfirmation(orderId: string): OrderState {
    const order = this.getOrder(orderId);

    // Guard: must be in TIMEOUT or RETRY (all retries exhausted)
    if (
      order.state.confirmation_status !== 'TIMEOUT' &&
      order.state.confirmation_status !== 'RETRY'
    ) {
      throw new InvalidStateTransitionError(
        AGENT_ID,
        'confirmation_status',
        order.state.confirmation_status,
        'FAILED',
      );
    }

    // Transition through TIMEOUT first if currently in RETRY
    if (order.state.confirmation_status === 'RETRY') {
      this.transitionConfirmation(order, 'TIMEOUT', 'retryTimeout', null);
    }

    this.transitionConfirmation(order, 'FAILED', 'failConfirmation', null);

    this.emitEvent(order, 'ORDER_CONFIRMATION_FAILED', {
      total_attempts: order.confirmation_request?.attempt_number ?? 0,
      channel: order.confirmation_request?.channel ?? 'UNKNOWN',
    });

    return this.cloneState(order.state);
  }

  // -------------------------------------------------------------------------
  // Conflict detection — late confirmation during refund
  // -------------------------------------------------------------------------

  handleLateConfirmation(orderId: string, ticketRef: string): OrderState {
    const order = this.getOrder(orderId);

    const paymentInRefundFlow =
      order.state.payment_status === 'REFUND_INITIATED' ||
      order.state.payment_status === 'REFUNDED';

    if (!paymentInRefundFlow) {
      throw new InvalidStateTransitionError(
        AGENT_ID,
        'reconciliation_status',
        order.state.reconciliation_status,
        'CONFLICT',
      );
    }

    // Mark confirmation as received (even though it's late)
    order.state.confirmation_status = 'CONFIRMED';
    this.recordAudit(order, 'confirmation_status', 'FAILED', 'CONFIRMED', 'lateConfirmation', null);

    // Set reconciliation to CONFLICT
    this.transitionReconciliation(order, 'CONFLICT', 'lateConfirmation', null);

    this.emitEvent(order, 'ORDER_CONFLICT_DETECTED', {
      ticket_ref: ticketRef,
      payment_status: order.state.payment_status,
      refund_id: order.refund_id,
    });

    return this.cloneState(order.state);
  }

  resolveConflict(orderId: string, resolution: ConflictResolution): OrderState {
    const order = this.getOrder(orderId);
    this.transitionReconciliation(order, 'RESOLVED', `resolveConflict:${resolution.action}`, null);
    return this.cloneState(order.state);
  }

  // -------------------------------------------------------------------------
  // Query methods
  // -------------------------------------------------------------------------

  getState(orderId: string): OrderState {
    const order = this.getOrder(orderId);
    return this.cloneState(order.state);
  }

  getAuditTrail(orderId: string): readonly OrderStateAuditEntry[] {
    const order = this.getOrder(orderId);
    return [...order.audit_trail];
  }

  getRefundId(orderId: string): string | null {
    const order = this.getOrder(orderId);
    return order.refund_id;
  }

  getPaymentCaptureRef(orderId: string): string | null {
    const order = this.getOrder(orderId);
    return order.payment_capture_ref;
  }

  /**
   * Gate check for Agent 5.1 (Change Management).
   * Changes can only be accepted when the booking is confirmed (ticket issued).
   */
  canAcceptChange(orderId: string): boolean {
    const order = this.orders.get(orderId);
    if (!order) return false;
    return order.state.confirmation_status === 'CONFIRMED';
  }

  hasOrder(orderId: string): boolean {
    return this.orders.has(orderId);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private getOrder(orderId: string): ManagedOrder {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new InvalidStateTransitionError(AGENT_ID, 'order', 'NOT_FOUND', orderId);
    }
    return order;
  }

  private transitionPayment(
    order: ManagedOrder,
    to: PaymentStatus,
    trigger: string,
    idempotencyKey: string | null,
  ): void {
    const from = order.state.payment_status;
    validatePaymentTransition(from, to, AGENT_ID);
    order.state.payment_status = to;
    this.recordAudit(order, 'payment_status', from, to, trigger, idempotencyKey);
  }

  private transitionConfirmation(
    order: ManagedOrder,
    to: ConfirmationStatus,
    trigger: string,
    idempotencyKey: string | null,
  ): void {
    const from = order.state.confirmation_status;
    validateConfirmationTransition(from, to, AGENT_ID);
    order.state.confirmation_status = to;
    this.recordAudit(order, 'confirmation_status', from, to, trigger, idempotencyKey);
  }

  private transitionReconciliation(
    order: ManagedOrder,
    to: ReconciliationStatus,
    trigger: string,
    idempotencyKey: string | null,
  ): void {
    const from = order.state.reconciliation_status;
    validateReconciliationTransition(from, to, AGENT_ID);
    order.state.reconciliation_status = to;
    this.recordAudit(order, 'reconciliation_status', from, to, trigger, idempotencyKey);
  }

  private recordAudit(
    order: ManagedOrder,
    field: OrderStateAuditEntry['field'],
    from: string,
    to: string,
    trigger: string,
    idempotencyKey: string | null,
  ): void {
    order.audit_trail.push({
      timestamp: new Date().toISOString(),
      field,
      from_value: from,
      to_value: to,
      trigger,
      idempotency_key: idempotencyKey,
      order_id: order.order_id,
    });
  }

  private emitEvent(
    order: ManagedOrder,
    eventType: OrderStateEvent['event_type'],
    details: Record<string, unknown>,
  ): void {
    const event: OrderStateEvent = {
      event_type: eventType,
      order_id: order.order_id,
      passenger_ref: order.passenger_ref,
      timestamp: new Date().toISOString(),
      details,
    };
    this.auditPort?.record(event);
  }

  private cloneState(state: OrderState): OrderState {
    return { ...state };
  }
}
