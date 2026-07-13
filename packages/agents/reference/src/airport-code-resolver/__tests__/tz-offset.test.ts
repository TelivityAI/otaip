/**
 * Tests for UTC offset derivation (Agent 0.1, issue #14).
 */

import { describe, it, expect } from 'vitest';
import { deriveUtcOffset } from '../tz-offset.js';

// Fixed instants so DST-sensitive assertions are deterministic.
const WINTER = new Date('2026-01-15T12:00:00Z');
const SUMMER = new Date('2026-07-15T12:00:00Z');

describe('deriveUtcOffset', () => {
  it('returns +00:00 for UTC', () => {
    expect(deriveUtcOffset('UTC', WINTER)).toBe('+00:00');
    expect(deriveUtcOffset('Etc/UTC', SUMMER)).toBe('+00:00');
  });

  it('returns a positive offset (with half-hour zones)', () => {
    // India Standard Time — no DST, always +05:30.
    expect(deriveUtcOffset('Asia/Kolkata', WINTER)).toBe('+05:30');
    expect(deriveUtcOffset('Asia/Kolkata', SUMMER)).toBe('+05:30');
  });

  it('returns a negative offset', () => {
    // US Pacific: -08:00 in winter (PST), -07:00 in summer (PDT).
    expect(deriveUtcOffset('America/Los_Angeles', WINTER)).toBe('-08:00');
    expect(deriveUtcOffset('America/Los_Angeles', SUMMER)).toBe('-07:00');
  });

  it('handles DST transitions for the same timezone', () => {
    // US Eastern: -05:00 (EST) in winter, -04:00 (EDT) in summer.
    expect(deriveUtcOffset('America/New_York', WINTER)).toBe('-05:00');
    expect(deriveUtcOffset('America/New_York', SUMMER)).toBe('-04:00');

    // Europe/London: +00:00 (GMT) in winter, +01:00 (BST) in summer.
    expect(deriveUtcOffset('Europe/London', WINTER)).toBe('+00:00');
    expect(deriveUtcOffset('Europe/London', SUMMER)).toBe('+01:00');
  });

  it('returns null for missing or invalid timezones', () => {
    expect(deriveUtcOffset(null)).toBeNull();
    expect(deriveUtcOffset(undefined)).toBeNull();
    expect(deriveUtcOffset('')).toBeNull();
    expect(deriveUtcOffset('Not/ARealZone', WINTER)).toBeNull();
  });
});
