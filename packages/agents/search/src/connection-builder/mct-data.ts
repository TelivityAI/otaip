/**
 * Minimum Connecting Time (MCT) resolution.
 *
 * Authority: IATA SSIM Chapter 8 + PSC Resolution 765.
 * Domain KB: docs/knowledge-base/mct.md
 * Dataset: data/reference/mct/
 *
 * Hierarchy (most specific wins):
 *   1. Carrier override at airport (optional terminals)
 *   2. Airport + terminal change
 *   3. Airport + connection type / status
 *   4. Fail-closed — no invented IATA global table
 *
 * // TODO: DOMAIN_QUESTION: DQ-MCT-1 online vs interline MCT application when
 * //   unpublished carrier exceptions / concurrence rules are not in the dataset.
 * // TODO: DOMAIN_QUESTION: DQ-MCT-2 DI vs ID mapping for mixed connections.
 * // TODO: DOMAIN_QUESTION: DQ-MCT-3 codeshare / operating-carrier MCT default.
 * // TODO: DOMAIN_QUESTION: DQ-MCT-4 full SSIM/aggregator feed ingestion path.
 * // TODO: DOMAIN_QUESTION: DQ-MCT-5 bags / optional SSIM passenger MCT elements.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConnectionType, TerminalChangeType } from './types.js';

export type MctHierarchyLevel = 'carrier_override' | 'airport_terminal' | 'airport' | 'unavailable';

export interface MctResolution {
  /** Minutes when resolved; null when fail-closed (no curated row). */
  minutes: number | null;
  /** Human-readable applied rule label */
  rule: string;
  /** Hierarchy level that produced the result */
  level: MctHierarchyLevel;
  /** False → fail-closed; caller must not invent a substitute MCT */
  resolved: boolean;
}

interface CarrierOverrideRow {
  airport: string;
  arriving_carrier: string;
  departing_carrier: string;
  connection_status?: string;
  connection_type: ConnectionType;
  scope?: 'online' | 'interline';
  minutes: number;
  arrival_terminal?: string | null;
  departure_terminal?: string | null;
}

interface AirportRuleRow {
  airport: string;
  connection_type: ConnectionType;
  connection_status?: string;
  minutes: number;
  /** When true, row applies only when terminal change is `different`. */
  terminal_change?: boolean;
  arrival_terminal?: string | null;
  departure_terminal?: string | null;
}

interface CarrierOverridesFile {
  overrides: CarrierOverrideRow[];
}

interface AirportRulesFile {
  rules: AirportRuleRow[];
}

// ---------------------------------------------------------------------------
// Dataset load (curated JSON under data/reference/mct/)
// ---------------------------------------------------------------------------

function candidateMctDirs(): string[] {
  const dirs: string[] = [];
  const cwdDir = join(process.cwd(), 'data', 'reference', 'mct');
  dirs.push(cwdDir);

  // When tests or tools run from a package cwd, walk up looking for the monorepo dataset.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    let cursor = here;
    for (let i = 0; i < 8; i++) {
      dirs.push(join(cursor, 'data', 'reference', 'mct'));
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  } catch {
    // import.meta.url unavailable in unlikely hosts — cwd candidate remains.
  }

  return dirs;
}

function readJsonIfPresent<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function loadDataset(): {
  carrierOverrides: CarrierOverrideRow[];
  airportRules: AirportRuleRow[];
  dataDir: string | null;
} {
  for (const dir of candidateMctDirs()) {
    const carrierPath = join(dir, 'carrier-overrides.json');
    const airportPath = join(dir, 'airport-rules.json');
    if (!existsSync(carrierPath)) continue;

    const carriers = readJsonIfPresent<CarrierOverridesFile>(carrierPath);
    const airports = readJsonIfPresent<AirportRulesFile>(airportPath);
    return {
      carrierOverrides: carriers?.overrides ?? [],
      airportRules: airports?.rules ?? [],
      dataDir: dir,
    };
  }

  // No dataset on disk → empty tables → every resolve is fail-closed.
  return { carrierOverrides: [], airportRules: [], dataDir: null };
}

const DATASET = loadDataset();

/** Test / tooling hook to inspect which directory was loaded. */
export function getMctDataDir(): string | null {
  return DATASET.dataDir;
}

// ---------------------------------------------------------------------------
// MCT resolution
// ---------------------------------------------------------------------------

function carriersMatch(
  row: CarrierOverrideRow,
  arrivingCarrier: string,
  departingCarrier: string,
): boolean {
  return (
    row.arriving_carrier.toUpperCase() === arrivingCarrier.toUpperCase() &&
    row.departing_carrier.toUpperCase() === departingCarrier.toUpperCase()
  );
}

function scopeAllows(
  row: CarrierOverrideRow,
  arrivingCarrier: string,
  departingCarrier: string,
): boolean {
  const online = arrivingCarrier.toUpperCase() === departingCarrier.toUpperCase();
  if (row.scope === 'online' && !online) return false;
  if (row.scope === 'interline' && online) return false;
  return true;
}

/**
 * Resolve MCT for a connection.
 * Returns resolved=false (fail-closed) when no curated row matches.
 * Never invents airport constants or a global default table.
 */
export function resolveMct(
  airport: string,
  connectionType: ConnectionType,
  terminalChange: TerminalChangeType,
  arrivingCarrier?: string,
  departingCarrier?: string,
): MctResolution {
  const station = airport.toUpperCase().trim();

  // Level 1: Carrier-specific at airport
  if (arrivingCarrier && departingCarrier) {
    for (const row of DATASET.carrierOverrides) {
      if (row.airport.toUpperCase() !== station) continue;
      if (row.connection_type !== connectionType) continue;
      if (!carriersMatch(row, arrivingCarrier, departingCarrier)) continue;
      if (!scopeAllows(row, arrivingCarrier, departingCarrier)) continue;

      // TODO: DOMAIN_QUESTION: DQ-MCT-3 — when override lists arrival/departure
      //   terminals (or codeshare operating carrier), exact match rules vs unknown terminals.
      return {
        minutes: row.minutes,
        rule: `carrier-specific: ${arrivingCarrier}→${departingCarrier} at ${station}`,
        level: 'carrier_override',
        resolved: true,
      };
    }

    // // TODO: DOMAIN_QUESTION: DQ-MCT-1 — unpublished interline / concurrence exceptions
    // // must not be synthesized when carriers differ and no interline row exists.
  }

  // Level 2: Airport + connection type + terminal change
  if (terminalChange === 'different') {
    for (const row of DATASET.airportRules) {
      if (row.airport.toUpperCase() !== station) continue;
      if (row.connection_type !== connectionType) continue;
      if (row.terminal_change !== true) continue;
      return {
        minutes: row.minutes,
        rule: `airport terminal-change: ${station} ${connectionType}`,
        level: 'airport_terminal',
        resolved: true,
      };
    }
  }

  // Level 3: Airport + connection type (no terminal-change requirement)
  for (const row of DATASET.airportRules) {
    if (row.airport.toUpperCase() !== station) continue;
    if (row.connection_type !== connectionType) continue;
    if (row.terminal_change === true) continue;
    return {
      minutes: row.minutes,
      rule: `airport default: ${station} ${connectionType}`,
      level: 'airport',
      resolved: true,
    };
  }

  // Level 4: Fail-closed — do not invent a global MCT table or airport constants.
  return {
    minutes: null,
    rule:
      `mct-unavailable: no curated row for ${station} ${connectionType}` +
      (arrivingCarrier && departingCarrier ? ` (${arrivingCarrier}→${departingCarrier})` : ''),
    level: 'unavailable',
    resolved: false,
  };
}

// ---------------------------------------------------------------------------
// Alliance data (for interline checks — agreement existence, not MCT minutes)
// ---------------------------------------------------------------------------

const ALLIANCE_MAP: Record<string, string> = {
  // Star Alliance
  UA: 'star_alliance',
  LH: 'star_alliance',
  AC: 'star_alliance',
  NH: 'star_alliance',
  SK: 'star_alliance',
  OS: 'star_alliance',
  SN: 'star_alliance',
  LO: 'star_alliance',
  OU: 'star_alliance',
  TK: 'star_alliance',
  SQ: 'star_alliance',
  NZ: 'star_alliance',
  ET: 'star_alliance',
  SA: 'star_alliance',
  AI: 'star_alliance',
  // oneworld
  AA: 'oneworld',
  BA: 'oneworld',
  QF: 'oneworld',
  CX: 'oneworld',
  JL: 'oneworld',
  IB: 'oneworld',
  AY: 'oneworld',
  QR: 'oneworld',
  MH: 'oneworld',
  RJ: 'oneworld',
  AT: 'oneworld',
  // SkyTeam
  DL: 'skyteam',
  AF: 'skyteam',
  KL: 'skyteam',
  KE: 'skyteam',
  AM: 'skyteam',
  SU: 'skyteam',
  CI: 'skyteam',
  MU: 'skyteam',
  GA: 'skyteam',
  SV: 'skyteam',
  VN: 'skyteam',
};

/**
 * Alliance / rough interline allowance check.
 * // TODO: DOMAIN_QUESTION: Real interline agreement database (distinct from MCT filings).
 * // Alliance membership ≠ MCT concurrence (SSIM User Guide §II).
 */
export function checkInterline(
  carrier1: string,
  carrier2: string,
): { interlineAllowed: boolean; sameAlliance: boolean; alliance?: string } {
  if (carrier1 === carrier2) {
    return { interlineAllowed: true, sameAlliance: true, alliance: ALLIANCE_MAP[carrier1] };
  }

  const alliance1 = ALLIANCE_MAP[carrier1];
  const alliance2 = ALLIANCE_MAP[carrier2];

  if (alliance1 && alliance2 && alliance1 === alliance2) {
    return { interlineAllowed: true, sameAlliance: true, alliance: alliance1 };
  }

  const hasAnyAlliance = !!(alliance1 || alliance2);
  return {
    interlineAllowed: hasAnyAlliance,
    sameAlliance: false,
  };
}
