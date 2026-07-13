/**
 * Room type taxonomy mapping tests for chain-specific naming patterns
 * (Agent 20.x content-normalization, issue #18).
 *
 * These assert the *actual* keyword-extraction behavior of `normalizeRoomType`
 * (category/bedType/bedCount) across real chain room descriptions — including
 * the important negative cases where a chain's marketing word ("Regency",
 * "Executive", "Club", "M Club") carries no taxonomy signal and the room falls
 * back to `standard`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeRoomType, resetRoomIdCounter } from '../room-normalizer.js';
import type { RawRoomType } from '../../types/hotel-common.js';

function norm(description: string, code?: string) {
  const raw: RawRoomType = code
    ? { roomTypeId: description, description, code }
    : { roomTypeId: description, description };
  return normalizeRoomType(raw, 'test-source');
}

describe('normalizeRoomType — chain-specific descriptions', () => {
  beforeEach(() => resetRoomIdCounter());

  it('Marriott: "Deluxe King" → deluxe / king', () => {
    const r = norm('Deluxe King');
    expect(r?.category).toBe('deluxe');
    expect(r?.bedType).toBe('king');
  });

  it('Marriott: "Executive Suite" → suite, no bed keyword falls back to double', () => {
    const r = norm('Executive Suite');
    expect(r?.category).toBe('suite');
    expect(r?.bedType).toBe('double');
  });

  it('Marriott: "M Club Lounge King" → standard (no category keyword) / king', () => {
    const r = norm('M Club Lounge King');
    expect(r?.category).toBe('standard');
    expect(r?.bedType).toBe('king');
  });

  it('Hilton: "King Hilton Executive" → standard / king', () => {
    const r = norm('King Hilton Executive');
    expect(r?.category).toBe('standard');
    expect(r?.bedType).toBe('king');
  });

  it('Hilton: "Twin Hilton Guest Room" → standard / twin (2 beds)', () => {
    const r = norm('Twin Hilton Guest Room');
    expect(r?.category).toBe('standard');
    expect(r?.bedType).toBe('twin');
    expect(r?.bedCount).toBe(2);
  });

  it('IHG: "Standard King" → standard / king', () => {
    const r = norm('Standard King');
    expect(r?.category).toBe('standard');
    expect(r?.bedType).toBe('king');
  });

  it('IHG: "Club InterContinental Suite" → suite / double', () => {
    const r = norm('Club InterContinental Suite');
    expect(r?.category).toBe('suite');
    expect(r?.bedType).toBe('double');
  });

  it('Hyatt: "Regency King" → standard (Regency is not a category) / king', () => {
    const r = norm('Regency King');
    expect(r?.category).toBe('standard');
    expect(r?.bedType).toBe('king');
  });

  it('Hyatt: "Grand Suite" → suite / double', () => {
    const r = norm('Grand Suite');
    expect(r?.category).toBe('suite');
    expect(r?.bedType).toBe('double');
  });

  it('Boutique: "Artist Loft" → standard / double', () => {
    const r = norm('Artist Loft');
    expect(r?.category).toBe('standard');
    expect(r?.bedType).toBe('double');
  });

  it('Boutique: "Penthouse Studio" → penthouse wins over studio (pattern order)', () => {
    const r = norm('Penthouse Studio');
    expect(r?.category).toBe('penthouse');
  });

  it('Budget: "Economy Room" → standard / double', () => {
    const r = norm('Economy Room');
    expect(r?.category).toBe('standard');
    expect(r?.bedType).toBe('double');
  });

  it('Budget: "Value Double" → standard / double', () => {
    const r = norm('Value Double');
    expect(r?.category).toBe('standard');
    expect(r?.bedType).toBe('double');
  });

  it('assigns a unique otaipRoomId per normalized room', () => {
    resetRoomIdCounter();
    const a = norm('Deluxe King');
    const b = norm('Standard Twin');
    expect(a?.otaipRoomId).not.toBe(b?.otaipRoomId);
  });
});
