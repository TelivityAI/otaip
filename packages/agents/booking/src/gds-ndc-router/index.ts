/**
 * GDS/NDC Router — Agent 3.1
 *
 * Routes booking requests to the correct distribution channel
 * based on carrier config, codeshare rules, and NDC capability.
 *
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type {
  GdsNdcRouterInput,
  GdsNdcRouterOutput,
  DistributionChannel,
  GdsSystem,
  TransactionType,
} from './types.js';
import { routeSegments } from './router-engine.js';

const IATA_CODE_RE = /^[A-Z0-9]{2}$/;
const AIRPORT_RE = /^[A-Z]{3}$/i;
const VALID_CHANNELS = new Set<DistributionChannel>(['GDS', 'NDC', 'DIRECT']);
const VALID_GDS = new Set<GdsSystem>(['AMADEUS', 'SABRE', 'TRAVELPORT']);
const VALID_TRANSACTION_TYPES = new Set<TransactionType>([
  'shopping',
  'booking',
  'ticketing',
  'servicing',
  'group',
  'corporate',
]);
const VALID_VENDORS = new Set([
  'sabre',
  'amadeus',
  'duffel',
  'navitaire',
  'trippro',
  'airline_direct',
  'unknown',
]);

export class GdsNdcRouter implements Agent<GdsNdcRouterInput, GdsNdcRouterOutput> {
  readonly id = '3.1';
  readonly name = 'GDS/NDC Router';
  readonly version = '0.1.0';

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(input: AgentInput<GdsNdcRouterInput>): Promise<AgentOutput<GdsNdcRouterOutput>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const result = routeSegments(input.data);

    const warnings: string[] = [];
    const directRoutes = result.routings.filter(
      (r) => r.primary_channel === 'DIRECT' && !r.domain_input_required,
    );
    if (directRoutes.length > 0) {
      warnings.push(
        `${directRoutes.length} segment(s) routed to DIRECT channel — not bookable via GDS/NDC.`,
      );
    }
    if (!result.unified_channel && result.routings.length > 1) {
      warnings.push('Mixed channel routing — segments require different distribution channels.');
    }
    const codeshares = result.routings.filter((r) => r.codeshare_applied);
    if (codeshares.length > 0) {
      warnings.push(`Codeshare routing applied for ${codeshares.length} segment(s).`);
    }
    const unresolved = result.routings.filter((r) => r.domain_input_required);
    for (const r of unresolved) {
      warnings.push(
        `DOMAIN_INPUT_REQUIRED: capability matrix for carrier=${r.routed_carrier} transaction_type=${input.data.transaction_type} not provided — supply via input.capability_overrides.`,
      );
    }

    return {
      data: result,
      confidence: 1.0,
      warnings: warnings.length > 0 ? warnings : undefined,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        segments: input.data.segments.length,
        unified_channel: result.unified_channel,
        recommended_channel: result.recommended_channel,
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

  private validateInput(data: GdsNdcRouterInput): void {
    if (!data.transaction_type || !VALID_TRANSACTION_TYPES.has(data.transaction_type)) {
      throw new AgentInputValidationError(
        this.id,
        'transaction_type',
        `Must be one of: ${[...VALID_TRANSACTION_TYPES].join(', ')}`,
      );
    }
    if (!data.segments || !Array.isArray(data.segments) || data.segments.length === 0) {
      throw new AgentInputValidationError(this.id, 'segments', 'At least one segment required.');
    }

    for (let i = 0; i < data.segments.length; i++) {
      const seg = data.segments[i]!;
      if (!seg.marketing_carrier || !IATA_CODE_RE.test(seg.marketing_carrier)) {
        throw new AgentInputValidationError(
          this.id,
          `segments[${i}].marketing_carrier`,
          'Must be a 2-letter IATA code.',
        );
      }
      if (seg.operating_carrier && !IATA_CODE_RE.test(seg.operating_carrier)) {
        throw new AgentInputValidationError(
          this.id,
          `segments[${i}].operating_carrier`,
          'Must be a 2-letter IATA code.',
        );
      }
      if (!seg.origin || !AIRPORT_RE.test(seg.origin)) {
        throw new AgentInputValidationError(
          this.id,
          `segments[${i}].origin`,
          'Must be a 3-letter IATA code.',
        );
      }
      if (!seg.destination || !AIRPORT_RE.test(seg.destination)) {
        throw new AgentInputValidationError(
          this.id,
          `segments[${i}].destination`,
          'Must be a 3-letter IATA code.',
        );
      }
    }

    if (data.preferred_channel && !VALID_CHANNELS.has(data.preferred_channel)) {
      throw new AgentInputValidationError(
        this.id,
        'preferred_channel',
        'Must be GDS, NDC, or DIRECT.',
      );
    }

    if (data.preferred_gds && !VALID_GDS.has(data.preferred_gds)) {
      throw new AgentInputValidationError(
        this.id,
        'preferred_gds',
        'Must be AMADEUS, SABRE, or TRAVELPORT.',
      );
    }

    if (data.vendor && !VALID_VENDORS.has(data.vendor)) {
      throw new AgentInputValidationError(
        this.id,
        'vendor',
        `Must be one of: ${[...VALID_VENDORS].join(', ')}`,
      );
    }

    if (data.plating_carrier && !IATA_CODE_RE.test(data.plating_carrier)) {
      throw new AgentInputValidationError(
        this.id,
        'plating_carrier',
        'Must be a 2-letter IATA code.',
      );
    }
  }
}

export type {
  GdsNdcRouterInput,
  GdsNdcRouterOutput,
  RoutingSegment,
  ChannelRouting,
  CarrierChannelConfig,
  DistributionChannel,
  DistributionVendor,
  NdcVersion,
  GdsSystem,
  GdsPnrFormat,
  GdsPnrSegment,
  NdcOrderFormat,
  NdcOfferItem,
  TransactionType,
  TransactionCapabilityOverrides,
  CapabilityMatrixInputRow,
} from './types.js';

export {
  getSeedCapabilityMatrix,
  parseCapabilityMatrixCsv,
  lookupMatrixRow,
  matrixRowToCarrierConfig,
  buildCapabilityOverridesFromMatrix,
  MATRIX_TO_AGENT_TRANSACTION,
  matrixTransactionsForAgentType,
  parseNdcVersionNotes,
} from './capability-matrix.js';
export type {
  CapabilityMatrixRow,
  MatrixTransaction,
  MatrixVendor,
  MatrixChannel,
} from './capability-matrix.js';