/**
 * Hotelbeds Transfers — sandbox integration test.
 *
 * Hits the REAL sandbox. Auto-skips without credentials. Counts toward
 * the daily quota:
 *   1. searchTransfers (BCN airport → ATLAS hotel id)
 *   2. bookTransfer (when a candidate is returned)
 *   3. cancelTransfer (cleanup)
 *
 * The `to` ATLAS code below is documented in Hotelbeds' Transfers
 * sample — the live sandbox may reject it; if so, the test surfaces the
 * raw error rather than masking it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HotelbedsAdapter } from '../hotelbeds-adapter.js';
import type { TransferOffer } from '../transfers-types.js';

const HAS_CREDENTIALS = Boolean(
  process.env['HOTELBEDS_API_KEY'] && process.env['HOTELBEDS_SECRET'],
);

const FROM_IATA = 'BCN';
// ATLAS code for a Barcelona hotel — placeholder; real ATLAS codes are
// supplier-specific. Override via HOTELBEDS_TRANSFER_ATLAS_TO if needed.
const TO_ATLAS = process.env['HOTELBEDS_TRANSFER_ATLAS_TO'] ?? '1234';

function isoDateOffsetDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const OUTBOUND_DATE = isoDateOffsetDays(56);
const OUTBOUND_TIME = '14:30';

describe.skipIf(!HAS_CREDENTIALS)('Hotelbeds Transfers — sandbox integration', () => {
  let adapter: HotelbedsAdapter;
  let pickedOffer: TransferOffer | null = null;
  let bookingRef: string | null = null;
  let cancelled = false;

  beforeAll(() => {
    adapter = new HotelbedsAdapter();
  });

  afterAll(async () => {
    // Transfer cancel is fail-closed pending DOMAIN_QUESTION — no adapter cleanup.
    if (bookingRef && !cancelled) {
      console.warn(
        `[transfers-integration] left sandbox booking ${bookingRef} (cancel not wired)`,
      );
    }
  });

  it('searchTransfers returns at least one option for an airport→hotel route', async () => {
    const offers = await adapter.searchTransfers({
      from: { type: 'IATA', code: FROM_IATA },
      to: { type: 'ATLAS', code: TO_ATLAS },
      outboundDate: OUTBOUND_DATE,
      outboundTime: OUTBOUND_TIME,
      adults: 2,
    });
    if (offers.length === 0) {
      console.warn(
        `Sandbox returned zero transfers for ${FROM_IATA}→${TO_ATLAS} on ${OUTBOUND_DATE}; ` +
          'override TO_ATLAS via HOTELBEDS_TRANSFER_ATLAS_TO if your sandbox uses different codes.',
      );
    }
    expect(offers.length).toBeGreaterThan(0);
    pickedOffer = offers[0]!;
  });

  it('bookTransfer creates a sandbox booking', async () => {
    if (!pickedOffer) {
      console.warn('Skipping book: no candidate transfer from search step');
      return;
    }
    const result = await adapter.bookTransfer({
      transferCode: pickedOffer.transferCode,
      holder: { name: 'OTAIP', surname: 'Sandbox' },
      passengers: [{ type: 'ADULT', name: 'OTAIP', surname: 'Sandbox' }],
      clientReference: `OTAIP-INT-TRF-${Date.now()}`,
    });
    expect(result.bookingReference.length).toBeGreaterThan(0);
    expect(['CONFIRMED', 'ON_REQUEST']).toContain(result.status);
    bookingRef = result.bookingReference;
  });

  it('cancelTransfer fails closed until DOMAIN_QUESTION resolved', async () => {
    await expect(adapter.cancelTransfer(bookingRef ?? 'NOREF')).rejects.toThrow(
      /DOMAIN_QUESTION|not wired|undocumented/i,
    );
  });
});
