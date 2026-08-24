/**
 * Fare Construction — Input/Output types
 *
 * Agent 2.2: NUC × IROE with published TPM/MPM, Resolution 024d (HX/NX)
 * rounding, and fail-closed HIP/BHC/CTM hooks.
 *
 * Authoritative contracts:
 *   docs/knowledge-base/fare-construction-data-dependencies.md
 *
 * Output is `FareConstructionResult` — either a successful
 * `FareConstructionOutput` or `DomainInputRequired` when IROE, TPM/MPM,
 * or 024d rounding is unavailable.
 */

import type { DomainInputRequired } from '@otaip/core';

export type FareConstructionResult = FareConstructionOutput | DomainInputRequired;

export type JourneyType = 'OW' | 'RT' | 'CT';

/**
 * Resolution 024d rounding method.
 * HX = round up to the next higher unit (unless already exact).
 * NX = round to the nearest unit.
 * Never use IEEE banker's / half-to-even as a substitute.
 */
export type Rounding024dMethod = 'HX' | 'NX';

export interface Rounding024dRule {
  /** Smallest rounding increment as a decimal string (e.g. "0.01", "1", "100"). */
  unit: string;
  method: Rounding024dMethod;
}

/**
 * Published TPM/MPM for one city pair from a licensed IATA feed.
 * source must never be haversine / great-circle derived.
 */
export interface PublishedCityPairMileage {
  origin: string;
  destination: string;
  /** Ticketed Point Mileage (IATA TPM Manual). */
  tpm: number;
  /** Maximum Permitted Mileage (IATA MPM Manual). */
  mpm: number;
}

/**
 * Caller-supplied licensed data. Absent or incomplete → fail closed.
 * Do not commit proprietary IROE/TPM/024d tables to the repo; pass them
 * at runtime from a licensed subscription.
 */
export interface FareConstructionDataSources {
  /**
   * IROE rates keyed by ISO 4217 currency (decimal strings).
   * Example: { USD: "1.000000", EUR: "…" } from the current IROE period.
   */
  iroe: Record<string, string>;
  /**
   * Resolution 024d rounding rules keyed by currency.
   */
  rounding_024d: Record<string, Rounding024dRule>;
  /**
   * Published TPM/MPM city pairs from the IATA TPM/MPM manuals.
   */
  mileage: PublishedCityPairMileage[];
}

export interface FareComponent {
  /** Origin airport / city code */
  origin: string;
  /** Destination airport / city code */
  destination: string;
  /** Carrier */
  carrier: string;
  /** Fare basis code */
  fare_basis: string;
  /** NUC amount for this component */
  nuc_amount: string;
}

export interface FareConstructionInput {
  /** Journey type: OW (one-way), RT (round-trip), CT (circle-trip) */
  journey_type: JourneyType;
  /** Fare components (segments with NUC amounts) */
  components: FareComponent[];
  /** Point of sale / selling currency (ISO 4217) */
  selling_currency: string;
  /** Point of sale country (for IROE selection context) */
  point_of_sale?: string;
  /**
   * Licensed IROE / 024d / TPM-MPM data. Required for construction.
   * When omitted or incomplete, the engine returns DomainInputRequired.
   */
  data_sources?: FareConstructionDataSources;
}

export interface MileageCheck {
  origin: string;
  destination: string;
  /** Ticketed Point Mileage (published). Null when unavailable. */
  tpm: number | null;
  /** Maximum Permitted Mileage (published). Null when unavailable. */
  mpm: number | null;
  /** Whether published mileage data was found for this pair */
  data_available: boolean;
}

/**
 * Minimal HIP sketch — comparison rules are NOT implemented.
 * See docs/knowledge-base/fare-construction-data-dependencies.md.
 */
export interface HipCheck {
  detected: boolean;
  hip_point: string | null;
  hip_nuc: string | null;
  description: string;
  /**
   * Missing authoritative inputs (e.g. intermediate_point_fares:JFK-LON).
   * Real HIP needs per-airline filed fares between intermediate points.
   */
  missing_inputs?: string[];
}

/**
 * Minimal BHC sketch — comparison rules are NOT implemented.
 */
export interface BhcCheck {
  detected: boolean;
  description: string;
  missing_inputs?: string[];
}

/**
 * Minimal CTM sketch — comparison rules are NOT implemented.
 */
export interface CtmCheck {
  applies: boolean;
  ctm_nuc: string | null;
  description: string;
  missing_inputs?: string[];
}

export interface MileageSurcharge {
  applies: boolean;
  /** EMS-style percentage band when MPM excess is computed from published TPM/MPM. */
  percentage: number;
  surcharge_nuc: string;
  description: string;
}

export interface AuditStep {
  step: number;
  name: string;
  description: string;
  input: string;
  output: string;
}

export interface FareConstructionOutput {
  total_nuc: string;
  /** IROE used for NUC → local conversion */
  iroe: string;
  /** @deprecated Use `iroe`. Kept for transitional consumers. */
  roe: string;
  local_amount_raw: string;
  local_amount: string;
  currency: string;
  rounding_unit: string;
  rounding_method: Rounding024dMethod;
  mileage_checks: MileageCheck[];
  total_tpm: number;
  total_mpm: number;
  /** @deprecated Use `total_mpm`. */
  total_mph: number;
  mileage_exceeded: boolean;
  mileage_surcharge: MileageSurcharge;
  hip_check: HipCheck;
  bhc_check: BhcCheck;
  ctm_check: CtmCheck;
  audit_trail: AuditStep[];
}

/**
 * Requirements documents for HIP/BHC/CTM — interface sketch only.
 * Engines must not invent comparison logic from these shapes alone.
 */
export interface HipCheckRequirements {
  intermediate_point_fares: Array<{
    origin: string;
    destination: string;
    carrier: string;
    nuc_amount: string;
  }>;
}

export interface BhcCheckRequirements {
  /** Opaque until DOMAIN_QUESTION on published BHC rules is answered. */
  geographic_direction_analysis: unknown;
}

export interface CtmCheckRequirements {
  circle_trip_minima_nuc: Array<{ component_index: number; ctm_nuc: string }>;
}
