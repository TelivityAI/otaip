/**
 * Airport/City Code Resolver — Agent 0.1
 *
 * Resolves IATA/ICAO airport and city codes to canonical airport records
 * with multi-airport city awareness and historical code handling.
 *
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type { AirportCodeResolverInput, AirportCodeResolverOutput } from './types.js';
import { loadAirportData, type AirportDataset } from './data-loader.js';
import { buildIndexes } from './resolver.js';
import { resolve } from './resolver.js';
import { initFuzzyIndex, resetFuzzyIndex } from './fuzzy-match.js';

type AirportIndexes = ReturnType<typeof buildIndexes>;

const VALID_CODE_TYPES = new Set(['iata', 'icao', 'city', 'name', 'auto']);

export class AirportCodeResolver implements Agent<
  AirportCodeResolverInput,
  AirportCodeResolverOutput
> {
  readonly id = '0.1';
  readonly name = 'Airport/City Code Resolver';
  readonly version = '0.1.0';

  private dataset: AirportDataset | null = null;
  private indexes: AirportIndexes | null = null;
  private dataDir: string | undefined;

  constructor(options?: { dataDir?: string }) {
    this.dataDir = options?.dataDir;
  }

  async initialize(): Promise<void> {
    this.dataset = await loadAirportData(this.dataDir);
    this.indexes = buildIndexes(this.dataset);
    initFuzzyIndex(this.dataset.airports);
  }

  async execute(
    input: AgentInput<AirportCodeResolverInput>,
  ): Promise<AgentOutput<AirportCodeResolverOutput>> {
    if (!this.dataset || !this.indexes) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const result = resolve(input.data, this.indexes);

    const warnings: string[] = [];

    // Check data staleness (older than 30 days)
    const dataAge = Date.now() - this.dataset.loadedAt.getTime();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    if (dataAge > THIRTY_DAYS_MS) {
      result.stale_data = true;
      warnings.push(
        'Airport data is older than 30 days. Consider refreshing with pnpm run data:download.',
      );
    }

    return {
      data: result,
      confidence: result.match_confidence,
      warnings: warnings.length > 0 ? warnings : undefined,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        dataset_loaded_at: this.dataset.loadedAt.toISOString(),
        airport_count: this.dataset.airports.length,
      },
    };
  }

  async health(): Promise<AgentHealthStatus> {
    if (!this.dataset || !this.indexes) {
      return { status: 'unhealthy', details: 'Not initialized. Call initialize() first.' };
    }

    if (this.dataset.airports.length === 0) {
      return { status: 'unhealthy', details: 'Airport dataset is empty.' };
    }

    const dataAge = Date.now() - this.dataset.loadedAt.getTime();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    if (dataAge > THIRTY_DAYS_MS) {
      return { status: 'degraded', details: 'Airport data is stale (>30 days old).' };
    }

    // Optional datasets missing → degraded (core airports.json is present, so
    // resolution still works, but metro/decommissioned lookups are unavailable).
    const missing: string[] = [];
    if (!this.dataset.optionalDatasets.metroAreas) missing.push('metro-areas.json');
    if (!this.dataset.optionalDatasets.decommissioned) missing.push('decommissioned.json');
    if (missing.length > 0) {
      return {
        status: 'degraded',
        details: `Optional dataset(s) missing: ${missing.join(', ')}.`,
      };
    }

    return { status: 'healthy' };
  }

  private validateInput(data: AirportCodeResolverInput): void {
    if (!data.code || typeof data.code !== 'string') {
      throw new AgentInputValidationError(
        this.id,
        'code',
        'Required string field. Provide an IATA, ICAO, city code, or airport name.',
      );
    }

    const trimmed = data.code.trim();
    if (trimmed.length < 1 || trimmed.length > 50) {
      throw new AgentInputValidationError(this.id, 'code', 'Must be 1-50 characters.');
    }

    if (data.code_type !== undefined && !VALID_CODE_TYPES.has(data.code_type)) {
      throw new AgentInputValidationError(
        this.id,
        'code_type',
        `Must be one of: ${[...VALID_CODE_TYPES].join(', ')}`,
      );
    }
  }

  /**
   * Tear down resources (used in testing).
   */
  destroy(): void {
    this.dataset = null;
    this.indexes = null;
    resetFuzzyIndex();
  }
}

export type { AirportCodeResolverInput, AirportCodeResolverOutput } from './types.js';
export type {
  ResolvedAirport,
  MetroAirport,
  CodeType,
  AirportType,
  AirportStatus,
} from './types.js';
