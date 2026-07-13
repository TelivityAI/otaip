/**
 * Zod schemas for AirportCodeResolver (Agent 0.1).
 * Single source of truth for:
 *  - Runtime validation at the schema_in / schema_out pipeline gates
 *  - LLM tool definition generation via `zodToJsonSchema()`
 */

import { z } from 'zod';

export const airportCodeResolverInputSchema = z.object({
  code: z.string().min(1).max(50),
  code_type: z.enum(['iata', 'icao', 'city', 'name', 'auto']).optional(),
  include_metro: z.boolean().optional(),
  include_decommissioned: z.boolean().optional(),
  max_results: z.number().int().positive().optional(),
});

const airportTypeSchema = z.enum([
  'large_airport',
  'medium_airport',
  'small_airport',
  'closed',
  'heliport',
  'seaplane_base',
]);

const airportStatusSchema = z.enum(['active', 'decommissioned']);

const resolvedAirportSchema = z.object({
  iata_code: z.string().nullable(),
  icao_code: z.string().nullable(),
  name: z.string(),
  city_code: z.string().nullable(),
  city_name: z.string().nullable(),
  country_code: z.string(),
  country_name: z.string(),
  timezone: z.string().nullable(),
  utc_offset: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  elevation_ft: z.number().nullable(),
  type: airportTypeSchema,
  status: airportStatusSchema,
  terminals: z.array(z.string()).nullable().optional(),
  decommission_date: z.string().nullable().optional(),
  primary: z.boolean().optional(),
});

const metroAirportSchema = z.object({
  iata_code: z.string(),
  name: z.string(),
  type: airportTypeSchema,
  primary: z.boolean().optional(),
});

export const airportCodeResolverOutputSchema = z.object({
  resolved_airport: resolvedAirportSchema.nullable(),
  metro_airports: z.array(metroAirportSchema).nullable(),
  match_confidence: z.number().min(0).max(1),
  stale_data: z.boolean().optional(),
  suggestion: z.string().optional(),
});
