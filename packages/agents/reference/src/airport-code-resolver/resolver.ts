/**
 * Core resolution logic for Airport Code Resolver.
 *
 * Classifies input, looks up against in-memory indexes, and returns canonical records.
 * All domain rules from the spec (agents/specs/0-1-airport-code-resolver.yaml).
 */

import type {
  AirportCodeResolverInput,
  AirportCodeResolverOutput,
  ProcessedAirport,
  MetroArea,
  DecommissionedAirport,
  ResolvedAirport,
  MetroAirport,
  CodeType,
  AirportType,
} from './types.js';
import type { AirportDataset } from './data-loader.js';
import { fuzzySearch } from './fuzzy-match.js';
import { deriveUtcOffset } from './tz-offset.js';

/** Indexes built from the loaded dataset for O(1) lookups */
interface AirportIndexes {
  byIata: Map<string, ProcessedAirport>;
  byIcao: Map<string, ProcessedAirport>;
  byCityCode: Map<string, ProcessedAirport[]>;
  metroAreas: Map<string, MetroArea>;
  decommissioned: Map<string, DecommissionedAirport>;
}

/**
 * Build lookup indexes from the loaded dataset.
 */
export function buildIndexes(dataset: AirportDataset): AirportIndexes {
  const byIata = new Map<string, ProcessedAirport>();
  const byIcao = new Map<string, ProcessedAirport>();
  const byCityCode = new Map<string, ProcessedAirport[]>();

  for (const airport of dataset.airports) {
    if (airport.iata_code) {
      byIata.set(airport.iata_code.toUpperCase(), airport);
    }
    if (airport.icao_code) {
      byIcao.set(airport.icao_code.toUpperCase(), airport);
    }
    if (airport.city_code) {
      const key = airport.city_code.toUpperCase();
      const existing = byCityCode.get(key) ?? [];
      existing.push(airport);
      byCityCode.set(key, existing);
    }
  }

  const metroAreas = new Map<string, MetroArea>();
  for (const metro of dataset.metroAreas) {
    metroAreas.set(metro.city_code.toUpperCase(), metro);
  }

  const decommissioned = new Map<string, DecommissionedAirport>();
  for (const dc of dataset.decommissioned) {
    decommissioned.set(dc.iata_code.toUpperCase(), dc);
  }

  return { byIata, byIcao, byCityCode, metroAreas, decommissioned };
}

const IATA_PATTERN = /^[A-Z]{3}$/;
const ICAO_PATTERN = /^[A-Z]{4}$/;

/**
 * Classify what type of code the input is.
 * If code_type is provided, use it. Otherwise auto-detect.
 */
export function classifyInput(code: string, codeType?: CodeType): CodeType {
  if (codeType && codeType !== 'auto') {
    return codeType;
  }

  const upper = code.toUpperCase();

  if (ICAO_PATTERN.test(upper)) {
    return 'icao';
  }
  if (IATA_PATTERN.test(upper)) {
    // Could be IATA airport code or city code — try IATA first (per spec)
    return 'iata';
  }

  return 'name';
}

/** Airport type sort order: large > medium > small > others */
const TYPE_ORDER: Record<string, number> = {
  large_airport: 0,
  medium_airport: 1,
  small_airport: 2,
  seaplane_base: 3,
  heliport: 4,
  closed: 5,
};

function sortAirportsByType(airports: ProcessedAirport[]): ProcessedAirport[] {
  return [...airports].sort((a, b) => {
    const orderA = TYPE_ORDER[a.type] ?? 99;
    const orderB = TYPE_ORDER[b.type] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });
}

function toResolvedAirport(airport: ProcessedAirport): ResolvedAirport {
  return {
    iata_code: airport.iata_code,
    icao_code: airport.icao_code,
    name: airport.name,
    city_code: airport.city_code,
    city_name: airport.city_name,
    country_code: airport.country_code,
    country_name: airport.country_name,
    timezone: airport.timezone,
    utc_offset: deriveUtcOffset(airport.timezone), // DST-correct offset from IANA tz
    latitude: airport.latitude,
    longitude: airport.longitude,
    elevation_ft: airport.elevation_ft,
    type: airport.type,
    status: airport.status,
    terminals: null, // Populated by Stage 1 agents from GDS/NDC APIs
    primary: airport.primary ?? undefined,
  };
}

function toMetroAirport(airport: ProcessedAirport): MetroAirport {
  return {
    iata_code: airport.iata_code ?? '',
    name: airport.name,
    type: airport.type,
    primary: airport.primary ?? undefined,
  };
}

/**
 * Resolve an airport/city code to canonical records.
 */
export function resolve(
  input: AirportCodeResolverInput,
  indexes: AirportIndexes,
): AirportCodeResolverOutput {
  const code = input.code.trim();
  const includeMetro = input.include_metro ?? true;
  const includeDecommissioned = input.include_decommissioned ?? false;

  const detectedType = classifyInput(code, input.code_type);
  const upper = code.toUpperCase();

  // Step 1: Try IATA lookup
  if (detectedType === 'iata' || detectedType === 'city') {
    // Check direct IATA airport code first
    const iataMatch = indexes.byIata.get(upper);
    if (iataMatch) {
      // Check if this is also a city code with metro airports
      const metroArea = indexes.metroAreas.get(upper);
      const cityAirports = indexes.byCityCode.get(upper);

      let metroAirports: MetroAirport[] | null = null;
      if (includeMetro && (metroArea ?? cityAirports)) {
        const airports = cityAirports ?? [];
        metroAirports = sortAirportsByType(airports).map(toMetroAirport);
      }

      return {
        resolved_airport: toResolvedAirport(iataMatch),
        metro_airports: metroAirports,
        match_confidence: 1.0,
      };
    }

    // Check if it's a city/metro code (not an airport code itself)
    const metroArea = indexes.metroAreas.get(upper);
    const cityAirports = indexes.byCityCode.get(upper);

    if (metroArea ?? cityAirports) {
      const airports = cityAirports ?? [];
      const sorted = sortAirportsByType(airports);
      const primaryAirport = sorted[0];

      return {
        resolved_airport: primaryAirport ? toResolvedAirport(primaryAirport) : null,
        metro_airports: includeMetro ? sorted.map(toMetroAirport) : null,
        match_confidence: 0.95,
      };
    }
  }

  // Step 2: Try ICAO lookup
  if (detectedType === 'icao') {
    const icaoMatch = indexes.byIcao.get(upper);
    if (icaoMatch) {
      return {
        resolved_airport: toResolvedAirport(icaoMatch),
        metro_airports: null,
        match_confidence: 1.0,
      };
    }
  }

  // Step 3: Try decommissioned codes
  if (includeDecommissioned) {
    const dcMatch = indexes.decommissioned.get(upper);
    if (dcMatch) {
      const resolved: ResolvedAirport = {
        iata_code: dcMatch.iata_code,
        icao_code: dcMatch.icao_code,
        name: dcMatch.name,
        city_code: null,
        city_name: dcMatch.city_name,
        country_code: dcMatch.country_code,
        country_name: '', // Not available in decommissioned dataset
        timezone: null,
        utc_offset: null,
        latitude: 0,
        longitude: 0,
        elevation_ft: null,
        type: 'closed' as AirportType,
        status: 'decommissioned',
        terminals: null,
        decommission_date: dcMatch.decommission_date,
      };

      return {
        resolved_airport: resolved,
        metro_airports: null,
        match_confidence: 0.9,
      };
    }
  }

  // Step 4: For IATA-like codes not found, check decommissioned even if not requested
  // (to provide a helpful suggestion)
  if (detectedType === 'iata' || detectedType === 'icao') {
    const dcMatch = indexes.decommissioned.get(upper);
    if (dcMatch && !includeDecommissioned) {
      return {
        resolved_airport: null,
        metro_airports: null,
        match_confidence: 0,
        suggestion: `${upper} is a decommissioned code (${dcMatch.name}). Set include_decommissioned=true to resolve it.`,
      };
    }
  }

  // Step 5: Fuzzy name search
  if (detectedType === 'name' || (detectedType === 'iata' && !indexes.byIata.has(upper))) {
    const fuzzyResults = fuzzySearch(code, input.max_results ?? 1);
    if (fuzzyResults.length > 0) {
      const best = fuzzyResults[0]!;
      if (best.confidence >= 0.5) {
        return {
          resolved_airport: toResolvedAirport(best.airport),
          metro_airports: null,
          match_confidence: best.confidence,
        };
      }
      // Low confidence — return null with suggestion
      return {
        resolved_airport: null,
        metro_airports: null,
        match_confidence: 0,
        suggestion: `Did you mean ${best.airport.name} (${best.airport.iata_code ?? best.airport.icao_code})?`,
      };
    }
  }

  // Step 6: Not found
  return {
    resolved_airport: null,
    metro_airports: null,
    match_confidence: 0,
  };
}
