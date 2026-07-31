/**
 * Hotelbeds Activities — sandbox integration test.
 *
 * Hits the REAL Hotelbeds test sandbox at https://api.test.hotelbeds.com.
 * Auto-skips when HOTELBEDS_API_KEY / HOTELBEDS_SECRET are not set, so
 * CI never accidentally runs it. Pattern mirrors the Hotels integration
 * test — sequential it() blocks, shared state, afterAll cleanup.
 *
 * Counts toward the sandbox 50/day quota:
 *   1. searchActivities (BCN, two-day window)
 *   2. bookActivity (only when an activity + modality are returned)
 *   3. cancelActivity (cleanup)
 *
 * Run with:
 *   HOTELBEDS_API_KEY=... HOTELBEDS_SECRET=... HOTELBEDS_ENV=test \
 *     pnpm exec vitest run packages/adapters/hotelbeds/src/__tests__/activities-integration.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HotelbedsAdapter } from '../hotelbeds-adapter.js';
import type { ActivityModality, ActivityOffer } from '../activities-types.js';

const HAS_CREDENTIALS = Boolean(
  process.env['HOTELBEDS_API_KEY'] && process.env['HOTELBEDS_SECRET'],
);

const DESTINATION = 'BCN';

function isoDateOffsetDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const DATE_FROM = isoDateOffsetDays(56);
const DATE_TO = isoDateOffsetDays(58);

describe.skipIf(!HAS_CREDENTIALS)('Hotelbeds Activities — sandbox integration', () => {
  let adapter: HotelbedsAdapter;
  let pickedActivity: ActivityOffer | null = null;
  let pickedModality: ActivityModality | null = null;
  let bookingRef: string | null = null;
  let cancelled = false;

  beforeAll(() => {
    adapter = new HotelbedsAdapter();
  });

  afterAll(async () => {
    // Activity cancel is fail-closed pending DOMAIN_QUESTION — no adapter cleanup.
    if (bookingRef && !cancelled) {
      console.warn(
        `[activities-integration] left sandbox booking ${bookingRef} (cancel not wired)`,
      );
    }
  });

  it('searchActivities returns at least one activity for a major destination', async () => {
    const offers = await adapter.searchActivities({
      destination: DESTINATION,
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
      paxes: { adults: 2 },
    });
    expect(offers.length).toBeGreaterThan(0);
    pickedActivity = offers.find((o) => o.modalities.length > 0) ?? null;
    expect(pickedActivity, 'no activity with modalities returned').not.toBeNull();
    pickedModality = pickedActivity!.modalities[0] ?? null;
    expect(pickedModality, 'activity has no modalities').not.toBeNull();
  });

  it.runIf(true)('bookActivity creates a sandbox booking', async () => {
    if (!pickedActivity || !pickedModality) {
      console.warn('Skipping book: no candidate activity from search step');
      return;
    }
    const result = await adapter.bookActivity({
      activityCode: pickedActivity.activityCode,
      modalityCode: pickedModality.code,
      date: DATE_FROM,
      paxes: [{ age: 30 }, { age: 28 }],
      holder: { name: 'OTAIP', surname: 'Sandbox' },
      clientReference: `OTAIP-INT-ACT-${Date.now()}`,
    });
    expect(result.bookingReference.length).toBeGreaterThan(0);
    expect(['CONFIRMED', 'ON_REQUEST']).toContain(result.status);
    bookingRef = result.bookingReference;
  });

  it('cancelActivity fails closed until DOMAIN_QUESTION resolved', async () => {
    await expect(adapter.cancelActivity(bookingRef ?? 'NOREF')).rejects.toThrow(
      /DOMAIN_QUESTION|not wired|undocumented/i,
    );
  });
});
