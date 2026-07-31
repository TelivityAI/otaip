/**
 * STUB — Payment link handoff + status polling.
 *
 * Maturity: stub. Not a production money path.
 */

import type { BookingStatus } from '../types.js';

export interface PaymentHandoffConfig {
  pollIntervalMs: number;
  maxPollAttempts: number;
}

export interface PaymentHandoffResult {
  paymentLink: string;
  status: BookingStatus;
  completedAt?: string;
}

export class PaymentHandoff {
  constructor(private _config: PaymentHandoffConfig) {}

  async awaitPayment(_bookingId: string): Promise<PaymentHandoffResult> {
    throw new Error(
      'Not implemented — PaymentHandoff is a stub (maturity: stub). ' +
        'Wire payment capture in the consuming application.',
    );
  }
}
