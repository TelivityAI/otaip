/**
 * Connection Builder — Agent 1.3
 *
 * Validates connections against MCT rules, scores connection quality,
 * and checks interline agreements.
 *
 * MCT authority: IATA SSIM Chapter 8 + PSC Resolution 765
 * (see docs/knowledge-base/mct.md). Missing curated rows fail closed.
 *
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type {
  ConnectionBuilderInput,
  ConnectionBuilderOutput,
  ConnectionType,
  TerminalChangeType,
} from './types.js';
import { resolveMct, checkInterline } from './mct-data.js';
import { scoreConnection } from './connection-scorer.js';

const IATA_CODE_RE = /^[A-Z]{3}$/i;

export class ConnectionBuilder implements Agent<ConnectionBuilderInput, ConnectionBuilderOutput> {
  readonly id = '1.3';
  readonly name = 'Connection Builder';
  readonly version = '0.1.0';

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<ConnectionBuilderInput>,
  ): Promise<AgentOutput<ConnectionBuilderOutput>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const data = input.data;
    const arriving = data.arriving_segment;
    const departing = data.departing_segment;
    const airport = data.connection_airport.toUpperCase().trim();

    // Determine connection type
    // TODO: DOMAIN_QUESTION: DQ-MCT-2 — real domestic/international classification
    //   using country data; DI vs ID for mixed.
    const sameCarrier = arriving.carrier === departing.carrier;
    const connectionType: ConnectionType = data.is_interline ? 'international' : 'domestic';

    // Determine terminal change
    // TODO: [FUTURE] Use terminal data from airport records to set 'same' or 'different'
    const terminalChange: TerminalChangeType = 'unknown';

    // Calculate available connection time
    const arrivalTime = new Date(arriving.arrival_time).getTime();
    const departureTime = new Date(departing.departure_time).getTime();
    const availableMinutes = Math.round((departureTime - arrivalTime) / 60000);

    // Resolve MCT (fail-closed when no curated row)
    const mct = resolveMct(
      airport,
      connectionType,
      terminalChange,
      arriving.carrier,
      departing.carrier,
    );

    const valid = mct.resolved && mct.minutes !== null && availableMinutes >= mct.minutes;
    const bufferMinutes =
      mct.resolved && mct.minutes !== null ? availableMinutes - mct.minutes : null;

    const validation = {
      valid,
      available_minutes: availableMinutes,
      required_mct_minutes: mct.minutes,
      buffer_minutes: bufferMinutes,
      applied_rule: mct.rule,
      connection_type: connectionType,
    };

    // Check interline
    let interline = null;
    if (!sameCarrier) {
      const check = checkInterline(arriving.carrier, departing.carrier);
      interline = {
        interline_allowed: check.interlineAllowed,
        same_alliance: check.sameAlliance,
        alliance: check.alliance,
      };
    }

    // Score quality
    const quality = scoreConnection({
      availableMinutes,
      requiredMctMinutes: mct.minutes,
      sameCarrier,
      sameAlliance: interline?.same_alliance ?? sameCarrier,
      terminalChange: (terminalChange as TerminalChangeType) === 'different',
    });

    // Build warnings
    const warnings: string[] = [];
    if (!mct.resolved) {
      warnings.push(
        `MCT unavailable at ${airport} for ${arriving.carrier}→${departing.carrier} (${connectionType}) — fail-closed (no curated SSIM row).`,
      );
    } else if (!valid && mct.minutes !== null) {
      warnings.push(
        `Connection time ${availableMinutes}min is below MCT ${mct.minutes}min at ${airport}.`,
      );
    }
    if (bufferMinutes !== null && bufferMinutes >= 0 && bufferMinutes < 15) {
      warnings.push('Very tight connection — less than 15 minutes buffer over MCT.');
    }
    if (availableMinutes > 360) {
      warnings.push('Long connection — over 6 hours at connecting airport.');
    }
    if (interline && !interline.interline_allowed) {
      warnings.push(`No interline agreement between ${arriving.carrier} and ${departing.carrier}.`);
    }

    return {
      data: {
        validation,
        quality: { score: quality.score, factors: quality.factors },
        interline,
        warnings,
      },
      confidence: valid ? 1.0 : 0.5,
      warnings: warnings.length > 0 ? warnings : undefined,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        connection_airport: airport,
        mct_rule: mct.rule,
        mct_level: mct.level,
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

  private validateInput(data: ConnectionBuilderInput): void {
    if (!data.arriving_segment) {
      throw new AgentInputValidationError(this.id, 'arriving_segment', 'Required.');
    }

    if (!data.departing_segment) {
      throw new AgentInputValidationError(this.id, 'departing_segment', 'Required.');
    }

    if (!data.connection_airport || !IATA_CODE_RE.test(data.connection_airport.trim())) {
      throw new AgentInputValidationError(
        this.id,
        'connection_airport',
        'Must be a 3-letter IATA code.',
      );
    }

    if (!data.arriving_segment.arrival_time) {
      throw new AgentInputValidationError(this.id, 'arriving_segment.arrival_time', 'Required.');
    }

    if (!data.departing_segment.departure_time) {
      throw new AgentInputValidationError(this.id, 'departing_segment.departure_time', 'Required.');
    }

    if (!data.arriving_segment.carrier) {
      throw new AgentInputValidationError(this.id, 'arriving_segment.carrier', 'Required.');
    }

    if (!data.departing_segment.carrier) {
      throw new AgentInputValidationError(this.id, 'departing_segment.carrier', 'Required.');
    }
  }
}

export type {
  ConnectionBuilderInput,
  ConnectionBuilderOutput,
  ConnectionValidation,
  ConnectionQuality,
  QualityFactor,
  InterlineCheck,
  ConnectionType,
  TerminalChangeType,
  MctRule,
} from './types.js';

export type { MctResolution, MctHierarchyLevel } from './mct-data.js';
export { resolveMct, checkInterline, getMctDataDir } from './mct-data.js';
