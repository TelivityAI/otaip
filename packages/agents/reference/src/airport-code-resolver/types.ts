/**
 * Airport Code Resolver — Input/Output types
 *
 * Agent 0.1: Resolves IATA/ICAO airport and city codes to canonical records.
 * All types derived from the approved spec (agents/specs/0-1-airport-code-resolver.yaml).
 */

export type CodeType = 'iata' | 'icao' | 'city' | 'name' | 'auto';

export type AirportType =
  | 'large_airport'
  | 'medium_airport'
  | 'small_airport'
  | 'closed'
  | 'heliport'
  | 'seaplane_base';

export type AirportStatus = 'active' | 'decommissioned';

export interface AirportCodeResolverInput {
  /** IATA 3-letter, ICAO 4-letter, city code, or airport name (fuzzy match supported) */
  code: string;
  /** Hint for resolution. Auto-detected if omitted. */
  code_type?: CodeType;
  /** If true and input is a metro/city code, return all airports in that city. Default: true */
  include_metro?: boolean;
  /** If true, resolve codes that have been retired/reassigned. Default: false */
  include_decommissioned?: boolean;
  /** Cap on fuzzy-name matches considered during resolution. Omit for the default. */
  max_results?: number;
}

export interface ResolvedAirport {
  iata_code: string | null;
  icao_code: string | null;
  name: string;
  city_code: string | null;
  city_name: string | null;
  country_code: string;
  country_name: string;
  timezone: string | null;
  utc_offset: string | null;
  latitude: number;
  longitude: number;
  elevation_ft: number | null;
  type: AirportType;
  status: AirportStatus;
  /** Terminals are populated by Stage 1 agents from GDS/NDC APIs — not available in static data */
  terminals?: string[] | null;
  /** ISO date when airport was decommissioned, if applicable */
  decommission_date?: string | null;
  /** True if this is the primary/dominant airport in a multi-airport city */
  primary?: boolean;
}

export interface MetroAirport {
  iata_code: string;
  name: string;
  type: AirportType;
  primary?: boolean;
}

export interface AirportCodeResolverOutput {
  resolved_airport: ResolvedAirport | null;
  metro_airports: MetroAirport[] | null;
  match_confidence: number;
  /** Present when data is stale or there are resolution notes */
  stale_data?: boolean;
  /** Suggestion when code not found but fuzzy match found something close */
  suggestion?: string;
}

/**
 * Raw airport record from OurAirports CSV after processing.
 */
export interface RawAirportRecord {
  id: string;
  ident: string;
  type: string;
  name: string;
  latitude_deg: number;
  longitude_deg: number;
  elevation_ft: number | null;
  continent: string;
  iso_country: string;
  iso_region: string;
  municipality: string;
  scheduled_service: string;
  gps_code: string;
  iata_code: string;
  local_code: string;
  home_link: string;
  wikipedia_link: string;
  keywords: string;
}

/**
 * Processed airport record stored in airports.json
 */
export interface ProcessedAirport {
  iata_code: string | null;
  icao_code: string | null;
  name: string;
  city_name: string | null;
  city_code: string | null;
  country_code: string;
  country_name: string;
  timezone: string | null;
  latitude: number;
  longitude: number;
  elevation_ft: number | null;
  type: AirportType;
  status: AirportStatus;
  primary?: boolean;
}

/**
 * Metro area mapping: city code -> airport IATA codes
 */
export interface MetroArea {
  city_code: string;
  city_name: string;
  country_code: string;
  airports: string[];
}

/**
 * Decommissioned airport record
 */
export interface DecommissionedAirport {
  iata_code: string;
  icao_code: string | null;
  name: string;
  city_name: string | null;
  country_code: string;
  decommission_date: string | null;
  reason: string | null;
  replaced_by: string | null;
}
