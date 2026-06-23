/**
 * Duffel Sandbox End-to-End Test
 *
 * Runs against the real Duffel test/sandbox API.
 * Skipped when DUFFEL_API_KEY is not set.
 *
 * To run:
 *   DUFFEL_API_KEY=duffel_test_... pnpm test -- packages/adapters/duffel/src/__tests__/duffel-e2e
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { DuffelAdapter } from '../duffel-adapter.js';
import type { SearchRequest } from '@otaip/core';

const describeE2E = process.env['DUFFEL_API_KEY'] ? describe : describe.skip;

function isoDatePlusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describeE2E('Duffel Sandbox E2E', () => {
  let adapter: DuffelAdapter;

  beforeAll(() => {
    // The key is read from the constructor arg or DUFFEL_API_KEY (here, the env).
    adapter = new DuffelAdapter(process.env['DUFFEL_API_KEY']!);
  });

  it('is available (health check)', async () => {
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  it('searches for flights and returns the unified output model', async () => {
    const request: SearchRequest = {
      segments: [{ origin: 'LHR', destination: 'CDG', departure_date: isoDatePlusDays(30) }],
      passengers: [{ type: 'ADT', count: 1 }],
      cabin_class: 'economy',
    };

    const response = await adapter.search(request);
    expect(response.offers.length).toBeGreaterThan(0);

    const offer = response.offers[0]!;
    expect(offer.offer_id).toMatch(/^off_/);
    expect(offer.source).toBe('duffel');
    expect(offer.price.total).toBeGreaterThan(0);
    expect(offer.price.currency).toBeDefined();
    expect(offer.itinerary.segments.length).toBeGreaterThan(0);

    const segment = offer.itinerary.segments[0]!;
    expect(segment.origin).toBe('LHR');
    expect(segment.departure_time).toBeDefined();
    expect(segment.arrival_time).toBeDefined();
  });

  it('prices an offer', async () => {
    const searchResponse = await adapter.search({
      segments: [{ origin: 'LHR', destination: 'CDG', departure_date: isoDatePlusDays(30) }],
      passengers: [{ type: 'ADT', count: 1 }],
      cabin_class: 'economy',
    });
    expect(searchResponse.offers.length).toBeGreaterThan(0);

    const cheapest = searchResponse.offers[0]!;
    const priceResponse = await adapter.price({ offer_id: cheapest.offer_id });
    expect(priceResponse.available).toBe(true);
    expect(priceResponse.price.total).toBeGreaterThan(0);
    expect(priceResponse.price.currency).toBeDefined();
  });
});
