/**
 * Durable outbox + timer records for confirmation TTL / payment poll work.
 */

export type OutboxStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface OutboxMessage<TPayload = unknown> {
  readonly id: string;
  readonly kind: string;
  readonly payload: TPayload;
  readonly availableAt: string;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DurableTimer {
  readonly id: string;
  readonly kind: string;
  readonly fireAt: string;
  readonly payload: unknown;
  readonly cancelled: boolean;
  readonly createdAt: string;
}

export interface OutboxStore {
  enqueue<TPayload = unknown>(
    kind: string,
    payload: TPayload,
    availableAt?: Date,
  ): Promise<OutboxMessage<TPayload>>;

  claimDue(limit?: number): Promise<readonly OutboxMessage[]>;

  markDone(id: string): Promise<void>;

  markFailed(id: string): Promise<void>;
}

export interface DurableTimerStore {
  schedule(kind: string, fireAt: Date, payload: unknown): Promise<DurableTimer>;

  cancel(id: string): Promise<boolean>;

  due(now?: Date): Promise<readonly DurableTimer[]>;
}
