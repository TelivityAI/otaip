/**
 * STUB — Booking pipeline: search → evaluate → price → book → confirm.
 *
 * Maturity: stub. Not a production money path.
 * Use MutationExecutor + ConnectAdapter methods (or the example OTA app)
 * for end-to-end booking. Full pipeline wiring is tracked separately.
 */

import type {
  ConnectAdapter,
  SearchFlightsInput,
  BookingResult,
  CreateBookingInput,
} from '../types.js';

export interface BookingPipelineConfig {
  adapter: ConnectAdapter;
  autoTicket: boolean;
  paymentTimeoutMs: number;
}

export type BookingPipelineStep = 'search' | 'evaluate' | 'price' | 'book' | 'confirm';

export class BookingPipeline {
  constructor(private _config: BookingPipelineConfig) {}

  async execute(
    _searchInput: SearchFlightsInput,
    _bookingInput: Omit<CreateBookingInput, 'offerId'>,
  ): Promise<BookingResult> {
    throw new Error(
      'Not implemented — BookingPipeline is a stub (maturity: stub). ' +
        'Use MutationExecutor with ConnectAdapter.createBooking for production-shaped flows.',
    );
  }
}
