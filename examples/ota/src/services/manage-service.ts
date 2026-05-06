/**
 * Manage Service — retrieve and cancel bookings.
 */

import type { BookingResult, CancelResult, OtaAdapter } from '../types.js';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ManageService {
  private readonly adapter: OtaAdapter;

  constructor(adapter: OtaAdapter) {
    this.adapter = adapter;
  }

  /** Retrieve booking details by reference. */
  async getBooking(reference: string): Promise<BookingResult | null> {
    return this.adapter.getBooking(reference);
  }

  /** Cancel a booking if eligible. */
  async cancelBooking(reference: string): Promise<CancelResult> {
    return this.adapter.cancelBooking(reference);
  }
}
