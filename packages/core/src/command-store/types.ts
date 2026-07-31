/**
 * CommandStore — durable reservation of idempotent commands for money-path mutations.
 *
 * reserve() creates a unique (scope, idempotencyKey) record. Replaying the same
 * key returns the stored response instead of re-executing the side effect.
 */

export type CommandStatus = 'reserved' | 'succeeded' | 'failed' | 'unknown';

export type MutationEffectType =
  | 'book'
  | 'pay'
  | 'ticket'
  | 'void'
  | 'refund'
  | 'cancel'
  | 'exchange';

export interface CommandRecord<TResponse = unknown> {
  readonly commandId: string;
  readonly scope: string;
  readonly idempotencyKey: string;
  readonly effectType: MutationEffectType;
  readonly requestHash: string;
  readonly status: CommandStatus;
  readonly response?: TResponse;
  readonly externalRef?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReserveCommandInput {
  readonly commandId: string;
  readonly scope: string;
  readonly idempotencyKey: string;
  readonly effectType: MutationEffectType;
  readonly requestHash: string;
}

export type ReserveCommandResult<TResponse = unknown> =
  | { readonly kind: 'reserved'; readonly record: CommandRecord<TResponse> }
  | { readonly kind: 'replay'; readonly record: CommandRecord<TResponse> }
  | { readonly kind: 'conflict'; readonly record: CommandRecord<TResponse>; readonly reason: string };

export interface CommandStore {
  reserve<TResponse = unknown>(
    input: ReserveCommandInput,
  ): Promise<ReserveCommandResult<TResponse>>;

  complete<TResponse = unknown>(
    scope: string,
    idempotencyKey: string,
    status: Exclude<CommandStatus, 'reserved'>,
    response?: TResponse,
    externalRef?: string,
  ): Promise<CommandRecord<TResponse> | null>;

  get<TResponse = unknown>(
    scope: string,
    idempotencyKey: string,
  ): Promise<CommandRecord<TResponse> | null>;
}
