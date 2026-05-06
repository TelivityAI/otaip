/**
 * Ticketing Service — issues tickets for confirmed bookings.
 *
 * Follows Option B: check booking status first, only issue if not yet ticketed.
 */

import type { BookingLifecycle, OtaAdapter, TicketResult } from '../types.js';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TicketingService {
  private readonly adapter: OtaAdapter & BookingLifecycle;

  constructor(adapter: OtaAdapter & BookingLifecycle) {
    this.adapter = adapter;
  }

  /**
   * Issue tickets for a booking.
   *
   * - If already ticketed, returns existing ticket numbers.
   * - If confirmed, issues new tickets.
   * - If cancelled, throws.
   */
  async issueTicket(bookingReference: string): Promise<TicketResult> {
    const booking = await this.adapter.getBooking(bookingReference);

    if (!booking) {
      throw new TicketingError(`Booking not found: ${bookingReference}`);
    }

    if (booking.status === 'cancelled') {
      throw new TicketingError('Cannot issue tickets for a cancelled booking.');
    }

    // If already ticketed, return existing info
    if (booking.status === 'ticketed' && booking.ticketNumbers) {
      return {
        bookingReference,
        status: 'ticketed',
        ticketNumbers: booking.ticketNumbers,
        ticketedAt: new Date().toISOString(),
      };
    }

    // Issue new tickets
    const ticketNumbers = this.adapter.issueTickets(bookingReference);

    if (!ticketNumbers) {
      throw new TicketingError(`Failed to issue tickets for: ${bookingReference}`);
    }

    return {
      bookingReference,
      status: 'ticketed',
      ticketNumbers,
      ticketedAt: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TicketingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TicketingError';
  }
}
