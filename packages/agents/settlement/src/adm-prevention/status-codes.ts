/**
 * ADM Prevention — GDS host status matrices
 *
 * Source: docs/knowledge-base/adm-prevention.md
 * (IATA Reso 850m = ADM memo process only; passive/UC/churn = carrier
 * booking policy + host statuses.)
 *
 * Do NOT treat HN / PK / GK / YK as one universal IATA meaning — they are
 * host-specific. Only the core set applies without a known `gds`.
 */

export type GdsHost = 'SABRE' | 'AMADEUS' | 'TRAVELPORT' | 'UNKNOWN';

/**
 * Cross-host core blocking advice/status codes from carrier booking policy
 * + shared host practice (HX/UC/UN/NO/TK). Not an IATA catalog of all codes.
 */
export const CORE_BLOCKING_STATUSES = ['HX', 'UC', 'UN', 'NO', 'TK'] as const;

/**
 * Per-host extended blocking codes from public GDS status/advice tables.
 * Meanings differ by host — do not merge into a universal set.
 *
 * // TODO: DOMAIN_QUESTION: Confirm Sabre vs Amadeus GK semantics in each
 * // adapter's normalized status before treating GK as interchangeable.
 * // TODO: DOMAIN_QUESTION: When gds is UNKNOWN, host-specific codes are
 * // ignored (core only). Should UNKNOWN warn instead of silent skip?
 */
export const HOST_BLOCKING_STATUSES: Readonly<Record<GdsHost, readonly string[]>> = {
  AMADEUS: [
    'HN', // Holding need (Amadeus status tables)
    'PK', // Passive confirmed
    'PL', // Passive waitlisted
    'GK', // Confirmed ghost segment (Amadeus)
    'GL', // Waitlisted ghost
    'GN', // Ghost need
    'UU', // Unable, have waitlisted
    'US', // Unable to accept sale, have waitlisted
    'XX', // Cancel residue
  ],
  SABRE: [
    'YK', // Sabre administrative / itinerary passive (ops usage — not Amadeus PK)
    'GK', // Sabre passive-for-ticketing usage (≠ Amadeus ghost semantics)
    'HN', // Holding need when present on Sabre air
    'XX', // Cancel residue
  ],
  TRAVELPORT: [
    'HN', // Holds need/confirmed (Travelport table)
    'AK', // Passive confirmed outside Galileo (1G)
    'AL', // Passive waitlisted outside Galileo
    'AN', // Passive requested outside Galileo
    'BK', // Passive booked with carrier
    'BL', // Passive waitlist
    'DX', // Broken marriage / authorized partial cancel in marriage
    'MK', // Non-messaging passive
    'PS', // Passive
    'ZK', // Passive API booking
    'LK', // Passive link booking
    'UU',
    'US',
    'XX',
    'XK', // Cancel seg with change
  ],
  // Host-specific codes must not be applied without a known host.
  UNKNOWN: [],
};

const CORE_SET = new Set<string>(CORE_BLOCKING_STATUSES);

const HOST_SETS: Readonly<Record<GdsHost, ReadonlySet<string>>> = {
  AMADEUS: new Set(HOST_BLOCKING_STATUSES.AMADEUS),
  SABRE: new Set(HOST_BLOCKING_STATUSES.SABRE),
  TRAVELPORT: new Set(HOST_BLOCKING_STATUSES.TRAVELPORT),
  UNKNOWN: new Set(HOST_BLOCKING_STATUSES.UNKNOWN),
};

function resolveHost(gds: GdsHost | undefined): GdsHost {
  return gds ?? 'UNKNOWN';
}

/** Core cross-host set only. */
export function isCoreBlockingStatus(status: string): boolean {
  return CORE_SET.has(status.toUpperCase());
}

/**
 * True if status blocks ticketing for the given host.
 * Without a known `gds`, only the core set (HX/UC/UN/NO/TK) applies —
 * HN/PK/GK/YK and other host codes are not universalized.
 */
export function isBlockingSegmentStatus(
  status: string,
  gds?: GdsHost,
): { blocking: boolean; scope: 'core' | 'host' | 'none'; host: GdsHost } {
  const code = status.toUpperCase();
  const host = resolveHost(gds);

  if (CORE_SET.has(code)) {
    return { blocking: true, scope: 'core', host };
  }

  if (host !== 'UNKNOWN' && HOST_SETS[host].has(code)) {
    return { blocking: true, scope: 'host', host };
  }

  return { blocking: false, scope: 'none', host };
}

/** Travelport: DX indicates broken marriage / marriage integrity risk. */
export function isTravelportMarriageBreakStatus(status: string): boolean {
  return status.toUpperCase() === 'DX';
}

/** Default churn heuristic — overridable; not a carrier-secret table. */
export const DEFAULT_CHURN_CYCLE_THRESHOLD = 3;
export const DEFAULT_CHURN_WINDOW_HOURS = 72;
