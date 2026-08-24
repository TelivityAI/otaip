/**
 * ADM Prevention — GDS host status matrices
 *
 * Source: docs/knowledge-base/adm-prevention.md
 * (IATA Reso 850m = ADM memo process only; passive/UC/churn = carrier
 * booking policy + host statuses.)
 */

/** Core blocking advice/status codes from carrier booking policy + host practice. */
export const CORE_BLOCKING_STATUSES = ['HX', 'UC', 'UN', 'NO', 'TK'] as const;

/**
 * Extended blocking set: pending confirmation, passive entry, cancel residue,
 * and Travelport marriage-break signals from public GDS status tables.
 */
export const EXTENDED_BLOCKING_STATUSES = [
  'HN',
  'PK',
  'PL',
  'GK',
  'GL',
  'GN',
  'YK',
  'AK',
  'AL',
  'AN',
  'BK',
  'BL',
  'MK',
  'PS',
  'ZK',
  'LK',
  'DX',
  'UU',
  'US',
  'XX',
  'XK',
] as const;

const CORE_SET = new Set<string>(CORE_BLOCKING_STATUSES);
const EXTENDED_SET = new Set<string>(EXTENDED_BLOCKING_STATUSES);

/** All statuses that must be cleared before ticketing. */
export function isBlockingSegmentStatus(status: string): boolean {
  const code = status.toUpperCase();
  return CORE_SET.has(code) || EXTENDED_SET.has(code);
}

export function isCoreBlockingStatus(status: string): boolean {
  return CORE_SET.has(status.toUpperCase());
}

/** Travelport: DX indicates broken marriage / marriage integrity risk. */
export function isTravelportMarriageBreakStatus(status: string): boolean {
  return status.toUpperCase() === 'DX';
}

export type GdsHost = 'SABRE' | 'AMADEUS' | 'TRAVELPORT' | 'UNKNOWN';

/** Default churn heuristic — overridable; not a carrier-secret table. */
export const DEFAULT_CHURN_CYCLE_THRESHOLD = 3;
export const DEFAULT_CHURN_WINDOW_HOURS = 72;
