/**
 * Money-path mutation outcomes shared by Connect + Duffel.
 */

export type MoneyPathOutcomeKind = 'succeeded' | 'failed' | 'unknown';

export type MoneyPathOutcome<T> =
  | { readonly kind: 'succeeded'; readonly value: T; readonly replayed: boolean }
  | { readonly kind: 'failed'; readonly error: unknown; readonly replayed: boolean }
  | {
      readonly kind: 'unknown';
      readonly error: unknown;
      readonly idempotencyKey: string;
      readonly reconcileHint: 'getBookingStatus' | 'getOrder';
    };

export class OutcomeUnknownError extends Error {
  readonly idempotencyKey: string;
  readonly reconcileHint: 'getBookingStatus' | 'getOrder';
  override readonly cause?: unknown;

  constructor(
    message: string,
    opts: {
      idempotencyKey: string;
      reconcileHint: 'getBookingStatus' | 'getOrder';
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'OutcomeUnknownError';
    this.idempotencyKey = opts.idempotencyKey;
    this.reconcileHint = opts.reconcileHint;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

export class MoneyPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyPathError';
  }
}
