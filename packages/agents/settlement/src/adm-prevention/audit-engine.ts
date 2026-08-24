/**
 * ADM Prevention Engine — pre-ticketing audit checks.
 *
 * Domain source: docs/knowledge-base/adm-prevention.md
 * - IATA Reso 850m = ADM memo windows/dispute (Agent 6.3), not status rules
 * - Passive/UC/churn = carrier booking policy + host statuses (HX/UC/UN/NO/TK + extended)
 * - Travelport: those statuses do not need a ticketing field
 * - Churning requires segment history
 * - No carrier-secret commission tables
 */

import Decimal from 'decimal.js';
import type {
  ADMPreventionInput,
  ADMPreventionOutput,
  ADMPreventionResult,
  ADMCheck,
  SegmentHistoryEvent,
} from './types.js';
import {
  isBlockingSegmentStatus,
  isCoreBlockingStatus,
  isTravelportMarriageBreakStatus,
  DEFAULT_CHURN_CYCLE_THRESHOLD,
  DEFAULT_CHURN_WINDOW_HOURS,
} from './status-codes.js';

// Fare basis first-character to expected booking class mapping
// This is a simplified mapping — real ATPCO mappings are far more complex
const FARE_CLASS_MAP: Record<string, string[]> = {
  Y: ['Y'],
  B: ['B'],
  M: ['M'],
  H: ['H'],
  K: ['K'],
  L: ['L'],
  Q: ['Q'],
  N: ['N'],
  S: ['S'],
  T: ['T'],
  V: ['V'],
  W: ['W'],
  X: ['X'],
  E: ['E'],
  G: ['G'],
  U: ['U'],
  C: ['C', 'J', 'D'],
  J: ['C', 'J', 'D'],
  D: ['C', 'J', 'D'],
  R: ['R'],
  I: ['I'],
  P: ['P'],
  F: ['F', 'A'],
  A: ['F', 'A'],
};

const TOUR_CODE_RE = /^[A-Z0-9]{1,15}$/;
const TTL_BUFFER_MINUTES = 30;

// Unrestricted fare classes (no endorsement required)
const UNRESTRICTED_CLASSES = new Set(['Y', 'C', 'D', 'J', 'F', 'A', 'P', 'R', 'I']);

function currentTime(input: ADMPreventionInput): Date {
  return input.current_datetime ? new Date(input.current_datetime) : new Date();
}

function flightKey(carrier: string, flight: string, date: string): string {
  return `${carrier.toUpperCase()}|${flight}|${date}`;
}

/**
 * Calendar date (YYYY-MM-DD) in an IANA timezone for an instant.
 * Used for deadline-day ADM risk — not a substitute for carrier TTL rules.
 */
function localCalendarDate(isoInstant: string, timeZone: string): string | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(new Date(isoInstant));
  } catch {
    // TODO: DOMAIN_QUESTION: invalid ttl_timezone handling — fail open vs block
    return null;
  }
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkDuplicateBooking(input: ADMPreventionInput): ADMCheck {
  const check: ADMCheck = {
    check_id: 'DUPLICATE_BOOKING',
    name: 'Duplicate Booking Detection',
    severity: 'blocking',
    passed: true,
    reason: 'No duplicate bookings found.',
  };

  if (!input.duplicate_check_pnrs || input.duplicate_check_pnrs.length === 0) {
    return check;
  }

  const paxName = input.booking.passenger_name.toUpperCase();
  for (const otherPnr of input.duplicate_check_pnrs) {
    if (otherPnr.record_locator === input.booking.record_locator) continue;
    if (otherPnr.passenger_name.toUpperCase() !== paxName) continue;

    for (const otherSeg of otherPnr.segments) {
      for (const mySeg of input.booking.segments) {
        if (
          mySeg.carrier === otherSeg.carrier &&
          mySeg.flight_number === otherSeg.flight_number &&
          mySeg.departure_date === otherSeg.departure_date
        ) {
          check.passed = false;
          check.reason = `Duplicate: ${paxName} on ${mySeg.carrier}${mySeg.flight_number} ${mySeg.departure_date} in PNR ${otherPnr.record_locator}.`;
          return check;
        }
      }
    }
  }

  return check;
}

function checkFareClassMismatch(input: ADMPreventionInput): ADMCheck {
  const check: ADMCheck = {
    check_id: 'FARE_CLASS_MISMATCH',
    name: 'Fare Basis vs Booked Class',
    severity: 'blocking',
    passed: true,
    reason: 'Fare basis matches booked class.',
  };

  const firstChar = input.fare_basis.charAt(0).toUpperCase();
  const allowed = FARE_CLASS_MAP[firstChar];
  if (allowed && !allowed.includes(input.booked_class.toUpperCase())) {
    check.passed = false;
    check.reason = `Fare basis ${input.fare_basis} (${firstChar} class) booked in ${input.booked_class} — mismatch.`;
  }

  return check;
}

/**
 * Passive / unable / schedule-change / pending statuses.
 * Core set HX/UC/UN/NO/TK from carrier booking policy + host practice.
 * Travelport: status alone is enough — no ticketing field required.
 */
function checkPassiveSegments(input: ADMPreventionInput): ADMCheck {
  const check: ADMCheck = {
    check_id: 'PASSIVE_SEGMENT',
    name: 'Passive / Unable / Risky Status',
    severity: 'blocking',
    passed: true,
    reason: 'No passive, unable, or uncleared risky statuses found.',
  };

  for (const seg of input.booking.segments) {
    if (!isBlockingSegmentStatus(seg.status)) continue;

    const code = seg.status.toUpperCase();
    const core = isCoreBlockingStatus(code);
    const travelportNote =
      input.gds === 'TRAVELPORT'
        ? ' Travelport: status alone is sufficient (no ticketing field required).'
        : '';

    check.passed = false;
    check.reason = core
      ? `Risky host status: ${seg.carrier}${seg.flight_number} status ${code} (core set HX/UC/UN/NO/TK) — must be cleared before ticketing.${travelportNote}`
      : `Risky host status: ${seg.carrier}${seg.flight_number} status ${code} — passive/pending/cancel residue must be removed before ticketing.${travelportNote}`;
    return check;
  }

  return check;
}

/**
 * Churning: book→cancel→rebook cycles. Requires segment_history.
 * Current HK-only status is a classic false negative without history.
 */
function checkChurning(input: ADMPreventionInput): ADMCheck {
  const check: ADMCheck = {
    check_id: 'CHURNING',
    name: 'Churning Detection',
    severity: 'blocking',
    passed: true,
    reason: 'No churning pattern detected.',
  };

  const history = input.segment_history;
  if (!history || history.length === 0) {
    check.reason =
      'No segment history provided — churning skipped (cannot detect from current status alone).';
    return check;
  }

  const threshold = input.churn_cycle_threshold ?? DEFAULT_CHURN_CYCLE_THRESHOLD;
  const windowHours = input.churn_window_hours ?? DEFAULT_CHURN_WINDOW_HOURS;
  const windowMs = windowHours * 60 * 60 * 1000;

  const byFlight = new Map<string, SegmentHistoryEvent[]>();
  for (const event of history) {
    const key = flightKey(event.carrier, event.flight_number, event.departure_date);
    const list = byFlight.get(key) ?? [];
    list.push(event);
    byFlight.set(key, list);
  }

  for (const [key, events] of byFlight) {
    const sorted = [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    let cycles = 0;
    let lastCancelAt: number | null = null;

    for (const event of sorted) {
      const t = new Date(event.timestamp).getTime();
      if (event.action === 'CANCELLED') {
        lastCancelAt = t;
      } else if (
        (event.action === 'REBOOKED' || event.action === 'BOOKED') &&
        lastCancelAt != null &&
        t - lastCancelAt <= windowMs &&
        t >= lastCancelAt
      ) {
        cycles += 1;
        lastCancelAt = null;
      }
    }

    if (cycles >= threshold) {
      check.passed = false;
      check.reason = `Churning: ${cycles} cancel→rebook cycles on ${key.replace(/\|/g, ' ')} within ${windowHours}h (threshold ${threshold}). Current status alone is insufficient — history required.`;
      return check;
    }
  }

  return check;
}

function checkMarriedSegments(input: ADMPreventionInput): ADMCheck {
  const check: ADMCheck = {
    check_id: 'MARRIED_SEGMENT',
    name: 'Married Segment Integrity',
    severity: 'blocking',
    passed: true,
    reason: 'Married segments are consistent.',
  };

  // Travelport-specific: DX is a broken-marriage / marriage-integrity signal
  // (public Travelport status table). No separate ticketing field required.
  if (input.gds === 'TRAVELPORT') {
    for (const seg of input.booking.segments) {
      if (isTravelportMarriageBreakStatus(seg.status)) {
        check.passed = false;
        check.reason = `Travelport DX on ${seg.carrier}${seg.flight_number}: broken marriage / marriage-integrity risk — do not ticket until marriage is restored or properly authorized.`;
        return check;
      }
    }
  }

  const groups = new Map<string, typeof input.booking.segments>();
  for (const seg of input.booking.segments) {
    if (seg.married_group) {
      const list = groups.get(seg.married_group) ?? [];
      list.push(seg);
      groups.set(seg.married_group, list);
    }
  }

  if (groups.size === 0) {
    check.reason =
      'No married_group markers on segments — skipped. (Sabre MSI / Amadeus marriage / Travelport group must be mapped by the adapter.)';
    return check;
  }

  for (const [group, segs] of groups) {
    if (segs.length < 2) {
      check.passed = false;
      check.reason = `Married group ${group} has only ${segs.length} segment — incomplete marriage (possible break).`;
      return check;
    }

    const statuses = new Set(segs.map((s) => s.status.toUpperCase()));
    if (statuses.size > 1) {
      check.passed = false;
      check.reason = `Married group ${group} has mixed statuses: ${[...statuses].join(', ')} — must be identical (GDS marriage integrity).`;
      return check;
    }
  }

  return check;
}

function checkTtlExpired(input: ADMPreventionInput): ADMCheck {
  const check: ADMCheck = {
    check_id: 'TTL_EXPIRED',
    name: 'Ticketing Time Limit',
    severity: 'blocking',
    passed: true,
    reason: 'TTL is valid.',
  };

  if (!input.ttl_deadline) {
    check.reason = 'No TTL deadline provided — skipped.';
    return check;
  }

  const now = currentTime(input);
  const deadline = new Date(input.ttl_deadline);
  const minutesRemaining = (deadline.getTime() - now.getTime()) / (1000 * 60);
  const sourceNote = input.ttl_source ? ` (TTL source: ${input.ttl_source})` : '';

  if (minutesRemaining < 0) {
    check.passed = false;
    check.reason = `TTL expired at ${input.ttl_deadline}${sourceNote} — cannot ticket.`;
    return check;
  }

  // Deadline-day risk: same local calendar date as deadline is ADM-prone
  // even when UTC still shows remaining hours.
  if (input.ttl_timezone && input.current_datetime) {
    const nowLocal = localCalendarDate(input.current_datetime, input.ttl_timezone);
    const deadlineLocal = localCalendarDate(input.ttl_deadline, input.ttl_timezone);
    if (nowLocal && deadlineLocal && nowLocal === deadlineLocal) {
      check.passed = false;
      check.reason = `TTL deadline-day risk: current local date ${nowLocal} in ${input.ttl_timezone} equals deadline date — carriers commonly ADM same-day-of-deadline issuance${sourceNote}.`;
      return check;
    }
  }

  if (minutesRemaining < TTL_BUFFER_MINUTES) {
    check.passed = false;
    check.reason = `TTL expires in ${Math.round(minutesRemaining)} minutes (< ${TTL_BUFFER_MINUTES}min buffer) — risk of expiry during ticketing${sourceNote}.`;
  }

  return check;
}

function checkCommissionRate(input: ADMPreventionInput): ADMCheck {
  const check: ADMCheck = {
    check_id: 'COMMISSION_RATE',
    name: 'Commission Rate vs Contracted',
    severity: 'blocking',
    passed: true,
    reason: 'Commission rate is within contracted limits.',
  };

  // No carrier-secret commission tables in-repo — caller must supply both rates.
  if (input.commission_rate == null || input.carrier_contracted_rate == null) {
    check.reason =
      'Commission rate or contracted rate not provided — skipped (no embedded carrier commission tables).';
    return check;
  }

  if (input.commission_rate > input.carrier_contracted_rate) {
    check.passed = false;
    check.reason = `Commission ${input.commission_rate}% exceeds carrier contracted rate ${input.carrier_contracted_rate}% — ADM risk.`;
  }

  return check;
}

function checkEndorsementBox(input: ADMPreventionInput): ADMCheck {
  const check: ADMCheck = {
    check_id: 'ENDORSEMENT_BOX',
    name: 'Endorsement Box',
    severity: 'warning',
    passed: true,
    reason: 'Endorsement populated correctly.',
  };

  const firstChar = input.fare_basis.charAt(0).toUpperCase();
  const isRestricted = !UNRESTRICTED_CLASSES.has(firstChar);

  if (isRestricted && (!input.endorsement || input.endorsement.trim().length === 0)) {
    check.passed = false;
    check.reason = `Restricted fare ${input.fare_basis} requires endorsement (e.g., "NON-ENDO/NON-REF") — endorsement box is empty.`;
  }

  return check;
}

function checkTourCodeFormat(input: ADMPreventionInput): ADMCheck {
  const check: ADMCheck = {
    check_id: 'TOUR_CODE_FORMAT',
    name: 'Tour Code Format',
    severity: 'warning',
    passed: true,
    reason: 'Tour code format is valid.',
  };

  if (!input.tour_code) {
    check.reason = 'No tour code present — skipped.';
    return check;
  }

  if (!TOUR_CODE_RE.test(input.tour_code)) {
    check.passed = false;
    check.reason = `Tour code "${input.tour_code}" is invalid — must be alphanumeric, max 15 characters.`;
  }

  return check;
}

function checkNetRemit(input: ADMPreventionInput): ADMCheck {
  const check: ADMCheck = {
    check_id: 'NET_REMIT',
    name: 'Net Remit Validation',
    severity: 'blocking',
    passed: true,
    reason: 'Net remit validation passed.',
  };

  if (!input.is_net_remit) {
    check.reason = 'Not a net remit ticket — skipped.';
    return check;
  }

  if (!input.net_contracted_amount) {
    check.passed = false;
    check.reason = 'Net remit ticket but no contracted amount provided — cannot validate.';
    return check;
  }

  const baseFare = new Decimal(input.booking.base_fare);
  const netAmount = new Decimal(input.net_contracted_amount);

  if (baseFare.greaterThan(netAmount)) {
    check.passed = false;
    check.reason = `Base fare ${input.booking.base_fare_currency} ${baseFare.toFixed(2)} exceeds net contracted amount ${input.booking.base_fare_currency} ${netAmount.toFixed(2)} — ADM risk.`;
  }

  return check;
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

/** Number of audit checks run by Agent 6.2 (includes CHURNING). */
export const ADM_CHECK_COUNT = 10;

export function runAudit(input: ADMPreventionInput): ADMPreventionOutput {
  const checks: ADMCheck[] = [
    checkDuplicateBooking(input),
    checkFareClassMismatch(input),
    checkPassiveSegments(input),
    checkChurning(input),
    checkMarriedSegments(input),
    checkTtlExpired(input),
    checkCommissionRate(input),
    checkEndorsementBox(input),
    checkTourCodeFormat(input),
    checkNetRemit(input),
  ];

  const blockingFailures = checks.filter((c) => c.severity === 'blocking' && !c.passed);
  const warningFailures = checks.filter((c) => c.severity === 'warning' && !c.passed);

  const result: ADMPreventionResult = {
    checks,
    overall_pass: blockingFailures.length === 0,
    blocking_count: blockingFailures.length,
    warning_count: warningFailures.length,
  };

  return { result };
}
