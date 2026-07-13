/**
 * Edge-case tests for the property deduplication scoring algorithms
 * (Agent 20.x property-dedup, issue #16).
 *
 * Covers transliteration/unicode, co-located vs same-name-different-city,
 * and missing/null components (coordinates, star rating, chain code) — asserting
 * the actual behavior of the exported scoring functions.
 */

import { describe, it, expect } from 'vitest';
import {
  jaroWinkler,
  haversineScore,
  starRatingScore,
  chainCodeScore,
  compositeScore,
} from '../matching/scorer.js';
import { normalizeName } from '../matching/normalizer.js';

const base = {
  name: 0,
  address: 0,
  coordinates: 0,
  chainCode: 0.5,
  starRating: 0.5,
};

describe('dedup scoring — edge cases', () => {
  describe('transliteration & unicode', () => {
    it('normalizes accented and transliterated spellings to the same string', () => {
      expect(normalizeName('Hotel München')).toBe(normalizeName('Hotel Munchen'));
      expect(normalizeName('Café Rouge')).toBe(normalizeName('Cafe Rouge'));
    });

    it('scores transliterated names as an exact match after normalization', () => {
      const a = normalizeName('Hotel München');
      const b = normalizeName('Hotel Munchen');
      expect(jaroWinkler(a, b)).toBe(1.0);
    });

    it('handles unicode combining marks (NFD vs NFC) consistently', () => {
      const nfc = 'Hôtel'.normalize('NFC');
      const nfd = 'Hôtel'.normalize('NFD');
      expect(normalizeName(nfc)).toBe(normalizeName(nfd));
    });
  });

  describe('coordinates', () => {
    it('co-located properties (identical coordinates) score 1.0', () => {
      expect(haversineScore(40.7, -74.0, 40.7, -74.0)).toBe(1.0);
    });

    it('same name in a different city scores 0.0 on proximity', () => {
      // "Hilton" in New York vs London — identical name, far apart.
      expect(haversineScore(40.7128, -74.006, 51.5074, -0.1278)).toBe(0.0);
    });

    it('co-located but different names ranks below co-located same-name', () => {
      const sameName = compositeScore({ ...base, name: 1.0, coordinates: 1.0 });
      const diffName = compositeScore({ ...base, name: 0.2, coordinates: 1.0 });
      expect(diffName.weighted).toBeLessThan(sameName.weighted);
    });

    it('same name but far apart ranks below same name co-located', () => {
      const near = compositeScore({ ...base, name: 1.0, coordinates: 1.0 });
      const far = compositeScore({ ...base, name: 1.0, coordinates: 0.0 });
      expect(far.weighted).toBeLessThan(near.weighted);
    });
  });

  describe('missing / null components', () => {
    it('missing star rating (one or both) yields a neutral 0.5', () => {
      expect(starRatingScore(undefined, 4)).toBe(0.5);
      expect(starRatingScore(4, undefined)).toBe(0.5);
      expect(starRatingScore(undefined, undefined)).toBe(0.5);
    });

    it('exact star rating match yields 1.0; >0.5 apart yields 0.0', () => {
      expect(starRatingScore(4, 4)).toBe(1.0);
      expect(starRatingScore(3, 5)).toBe(0.0);
    });

    it('missing chain code (one or both) yields a neutral 0.5', () => {
      expect(chainCodeScore(undefined, 'HH')).toBe(0.5);
      expect(chainCodeScore('HH', undefined)).toBe(0.5);
      expect(chainCodeScore(undefined, undefined)).toBe(0.5);
    });

    it('matching chain codes 1.0, differing 0.0 (case-insensitive)', () => {
      expect(chainCodeScore('hh', 'HH')).toBe(1.0);
      expect(chainCodeScore('HH', 'MC')).toBe(0.0);
    });

    it('compositeScore stays finite when all components are neutral/zero', () => {
      const s = compositeScore(base);
      expect(Number.isFinite(s.weighted)).toBe(true);
      expect(s.weighted).toBeGreaterThanOrEqual(0);
    });
  });
});
