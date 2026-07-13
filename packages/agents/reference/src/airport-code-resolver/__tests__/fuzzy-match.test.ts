/**
 * Tests for fuzzy match result limiting (Agent 0.1, issue #7 — max_results).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initFuzzyIndex, fuzzySearch, resetFuzzyIndex } from '../fuzzy-match.js';
import type { ProcessedAirport } from '../types.js';

function airport(iata: string, name: string, city: string): ProcessedAirport {
  return {
    iata_code: iata,
    icao_code: null,
    name,
    city_name: city,
    city_code: null,
    country_code: 'GB',
    country_name: 'United Kingdom',
    timezone: 'Europe/London',
    latitude: 0,
    longitude: 0,
    elevation_ft: null,
    type: 'large_airport',
    status: 'active',
  };
}

// Several airports share the "London" prefix so a single query yields many
// fuzzy candidates — enough to observe the limit taking effect.
const AIRPORTS: ProcessedAirport[] = [
  airport('LHR', 'London Heathrow Airport', 'London'),
  airport('LGW', 'London Gatwick Airport', 'London'),
  airport('STN', 'London Stansted Airport', 'London'),
  airport('LTN', 'London Luton Airport', 'London'),
  airport('LCY', 'London City Airport', 'London'),
  airport('SEN', 'London Southend Airport', 'London'),
];

describe('fuzzySearch result limiting', () => {
  beforeAll(() => initFuzzyIndex(AIRPORTS));
  afterAll(() => resetFuzzyIndex());

  it('max_results=1 returns at most 1 match', () => {
    const results = fuzzySearch('London', 1);
    expect(results).toHaveLength(1);
  });

  it('max_results=5 returns at most 5 matches', () => {
    const results = fuzzySearch('London', 5);
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results.length).toBeGreaterThan(1);
  });

  it('omitted limit falls back to the default (<= 5)', () => {
    const results = fuzzySearch('London');
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns matches sorted by confidence (highest first)', () => {
    const results = fuzzySearch('London', 5);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.confidence).toBeGreaterThanOrEqual(results[i]!.confidence);
    }
  });
});
