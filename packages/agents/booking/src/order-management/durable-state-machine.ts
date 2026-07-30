/**
 * Durable wrapper around PaymentConfirmationStateMachine.
 * Persists managed-order snapshots via CompareAndSwapPersistenceAdapter.
 */

import type { CompareAndSwapPersistenceAdapter } from '@otaip/core';
import { InMemoryPersistenceAdapter } from '@otaip/core';
import type { ConfirmationRequest, OrderState, OrderStateAuditEntry } from './order-state.js';
import {
  PaymentConfirmationStateMachine,
  type AuditPort,
  type MonitoringPort,
} from './state-machine.js';

const KEY_PREFIX = 'payconfirm:';

interface PersistedManagedOrder {
  order_id: string;
  passenger_ref: string;
  state: OrderState;
  idempotency_keys: string[];
  refund_initiated: boolean;
  confirmation_request: ConfirmationRequest | null;
  payment_capture_ref: string | null;
  refund_id: string | null;
  audit_trail: OrderStateAuditEntry[];
}

/**
 * Drop-in durable facade: loads/saves after each mutation.
 * Same public transition API as PaymentConfirmationStateMachine.
 */
export class DurablePaymentConfirmationStateMachine {
  private readonly inner: PaymentConfirmationStateMachine;
  private readonly persistence: CompareAndSwapPersistenceAdapter;

  constructor(options?: {
    audit?: AuditPort;
    monitoring?: MonitoringPort;
    persistence?: CompareAndSwapPersistenceAdapter;
  }) {
    this.inner = new PaymentConfirmationStateMachine({
      audit: options?.audit,
      monitoring: options?.monitoring,
    });
    this.persistence = options?.persistence ?? new InMemoryPersistenceAdapter();
  }

  private key(orderId: string): string {
    return `${KEY_PREFIX}${orderId}`;
  }

  private async hydrate(orderId: string): Promise<void> {
    if (this.inner.hasOrder(orderId)) return;
    const snap = await this.persistence.get<PersistedManagedOrder>(this.key(orderId));
    if (!snap) return;
    // Re-initialize and replay state by direct initialize + capturing payment path
    // via restoring through a private rebuild: initialize then apply stored state
    // using a restore helper on the inner machine.
    this.inner.restoreFromSnapshot({
      order_id: snap.order_id,
      passenger_ref: snap.passenger_ref,
      state: snap.state,
      idempotency_keys: new Set(snap.idempotency_keys),
      refund_initiated: snap.refund_initiated,
      confirmation_request: snap.confirmation_request,
      payment_capture_ref: snap.payment_capture_ref,
      refund_id: snap.refund_id,
      audit_trail: [...snap.audit_trail],
    });
  }

  private async persist(orderId: string): Promise<void> {
    const snap = this.inner.exportSnapshot(orderId);
    if (!snap) return;
    const record: PersistedManagedOrder = {
      order_id: snap.order_id,
      passenger_ref: snap.passenger_ref,
      state: snap.state,
      idempotency_keys: [...snap.idempotency_keys],
      refund_initiated: snap.refund_initiated,
      confirmation_request: snap.confirmation_request,
      payment_capture_ref: snap.payment_capture_ref,
      refund_id: snap.refund_id,
      audit_trail: snap.audit_trail,
    };
    await this.persistence.set(this.key(orderId), record);
  }

  async initializeOrder(orderId: string, passengerRef: string): Promise<OrderState> {
    const state = this.inner.initializeOrder(orderId, passengerRef);
    await this.persist(orderId);
    return state;
  }

  async capturePayment(orderId: string, captureRef: string): Promise<OrderState> {
    await this.hydrate(orderId);
    const state = this.inner.capturePayment(orderId, captureRef);
    await this.persist(orderId);
    return state;
  }

  async initiateConfirmation(orderId: string, request: ConfirmationRequest): Promise<OrderState> {
    await this.hydrate(orderId);
    const state = this.inner.initiateConfirmation(orderId, request);
    await this.persist(orderId);
    return state;
  }

  async handleConfirmationSuccess(orderId: string, ticketRef: string): Promise<OrderState> {
    await this.hydrate(orderId);
    const state = this.inner.handleConfirmationSuccess(orderId, ticketRef);
    await this.persist(orderId);
    return state;
  }

  async handleConfirmationTimeout(orderId: string): Promise<OrderState> {
    await this.hydrate(orderId);
    const state = this.inner.handleConfirmationTimeout(orderId);
    await this.persist(orderId);
    return state;
  }

  async retryConfirmation(orderId: string, request: ConfirmationRequest): Promise<OrderState> {
    await this.hydrate(orderId);
    const state = this.inner.retryConfirmation(orderId, request);
    await this.persist(orderId);
    return state;
  }

  async initiateRefund(orderId: string, refundId: string): Promise<OrderState> {
    await this.hydrate(orderId);
    const state = this.inner.initiateRefund(orderId, refundId);
    await this.persist(orderId);
    return state;
  }

  async hasOrder(orderId: string): Promise<boolean> {
    if (this.inner.hasOrder(orderId)) return true;
    return this.persistence.has(this.key(orderId));
  }

  async getState(orderId: string): Promise<OrderState | null> {
    await this.hydrate(orderId);
    if (!this.inner.hasOrder(orderId)) return null;
    return this.inner.getState(orderId);
  }
}
