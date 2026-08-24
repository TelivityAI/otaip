/**
 * Fare Construction — Agent 2.2
 *
 * NUC × IROE with published TPM/MPM, Resolution 024d (HX/NX) rounding,
 * and fail-closed HIP/BHC/CTM hooks.
 *
 * Licensed data is supplied via input.data_sources — this package does
 * not ship IROE or TPM files.
 *
 * KB: docs/knowledge-base/fare-construction-data-dependencies.md
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import {
  AgentNotInitializedError,
  AgentInputValidationError,
  isDomainInputRequired,
} from '@otaip/core';
import type {
  FareConstructionInput,
  FareConstructionResult,
  JourneyType,
} from './types.js';
import { constructFare } from './fare-engine.js';

const VALID_JOURNEY_TYPES = new Set<JourneyType>(['OW', 'RT', 'CT']);
const IATA_CODE_RE = /^[A-Z]{3}$/i;
const CURRENCY_RE = /^[A-Z]{3}$/;

export class FareConstruction implements Agent<FareConstructionInput, FareConstructionResult> {
  readonly id = '2.2';
  readonly name = 'Fare Construction';
  readonly version = '0.2.0';

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<FareConstructionInput>,
  ): Promise<AgentOutput<FareConstructionResult>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const result = constructFare(input.data);

    if (isDomainInputRequired(result)) {
      return {
        data: result,
        confidence: 0,
        warnings: [
          `DOMAIN_INPUT_REQUIRED: ${result.description}`,
          ...result.missing.map((m) => `missing: ${m}`),
        ],
        metadata: {
          agent_id: this.id,
          agent_version: this.version,
          journey_type: input.data.journey_type,
          component_count: input.data.components.length,
          currency: input.data.selling_currency,
          status: 'DOMAIN_INPUT_REQUIRED',
        },
      };
    }

    const warnings: string[] = [];
    if (result.mileage_exceeded) {
      warnings.push(
        `Mileage exceeded: TPM ${result.total_tpm} > MPM ${result.total_mpm}. Surcharge of ${result.mileage_surcharge.percentage}% applied.`,
      );
    }
    if (result.hip_check.detected) {
      warnings.push(`HIP detected at ${result.hip_check.hip_point}.`);
    }
    if (result.bhc_check.detected) {
      warnings.push(result.bhc_check.description);
    }
    if (result.hip_check.missing_inputs && result.hip_check.missing_inputs.length > 0) {
      warnings.push(
        `DOMAIN_INPUT_REQUIRED (HIP): ${result.hip_check.missing_inputs.join(', ')}`,
      );
    }
    if (result.bhc_check.missing_inputs && result.bhc_check.missing_inputs.length > 0) {
      warnings.push(
        `DOMAIN_INPUT_REQUIRED (BHC): ${result.bhc_check.missing_inputs.join(', ')}`,
      );
    }
    if (result.ctm_check.missing_inputs && result.ctm_check.missing_inputs.length > 0) {
      warnings.push(
        `DOMAIN_INPUT_REQUIRED (CTM): ${result.ctm_check.missing_inputs.join(', ')}`,
      );
    }

    return {
      data: result,
      confidence: 1.0,
      warnings: warnings.length > 0 ? warnings : undefined,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        journey_type: input.data.journey_type,
        component_count: input.data.components.length,
        currency: input.data.selling_currency,
      },
    };
  }

  async health(): Promise<AgentHealthStatus> {
    if (!this.initialized) {
      return { status: 'unhealthy', details: 'Not initialized. Call initialize() first.' };
    }
    return { status: 'healthy' };
  }

  destroy(): void {
    this.initialized = false;
  }

  private validateInput(data: FareConstructionInput): void {
    if (!VALID_JOURNEY_TYPES.has(data.journey_type)) {
      throw new AgentInputValidationError(this.id, 'journey_type', 'Must be OW, RT, or CT.');
    }

    if (!data.components || !Array.isArray(data.components) || data.components.length === 0) {
      throw new AgentInputValidationError(
        this.id,
        'components',
        'At least one fare component required.',
      );
    }

    for (let i = 0; i < data.components.length; i++) {
      const comp = data.components[i]!;
      if (!comp.origin || !IATA_CODE_RE.test(comp.origin)) {
        throw new AgentInputValidationError(
          this.id,
          `components[${i}].origin`,
          'Must be a 3-letter IATA code.',
        );
      }
      if (!comp.destination || !IATA_CODE_RE.test(comp.destination)) {
        throw new AgentInputValidationError(
          this.id,
          `components[${i}].destination`,
          'Must be a 3-letter IATA code.',
        );
      }
      if (!comp.nuc_amount || isNaN(Number(comp.nuc_amount))) {
        throw new AgentInputValidationError(
          this.id,
          `components[${i}].nuc_amount`,
          'Must be a valid numeric string.',
        );
      }
    }

    if (!data.selling_currency || !CURRENCY_RE.test(data.selling_currency)) {
      throw new AgentInputValidationError(
        this.id,
        'selling_currency',
        'Must be a 3-letter ISO 4217 currency code.',
      );
    }
  }
}

export {
  constructFare,
  apply024dRounding,
  assertPublishedTpmSource,
  HAVERSINE_AS_TPM_BANNED,
  HARDCODED_IROE_BANNED,
  BANKERS_ROUNDING_AS_IATA_BANNED,
} from './fare-engine.js';

export type {
  FareConstructionInput,
  FareConstructionOutput,
  FareConstructionResult,
  FareConstructionDataSources,
  FareComponent,
  JourneyType,
  MileageCheck,
  MileageSurcharge,
  HipCheck,
  BhcCheck,
  CtmCheck,
  AuditStep,
  Rounding024dMethod,
  Rounding024dRule,
  PublishedCityPairMileage,
  HipCheckRequirements,
  BhcCheckRequirements,
  CtmCheckRequirements,
} from './types.js';
