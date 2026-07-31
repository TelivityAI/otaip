/**
 * PNR Retrieval — Agent 3.8
 *
 * Retrieves an existing PNR/booking by record locator across distribution
 * adapters. Read-only — no side effects.
 *
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type { PnrRetrievalInput, PnrRetrievalOutput } from './types.js';
import {
  retrievePnr,
  type OrderRetrievalPort,
  type PnrRetrievalPort,
} from './retrieval-engine.js';

const RECORD_LOCATOR_RE = /^[A-Z0-9]{5,8}$/;
const VALID_SOURCES = new Set(['AMADEUS', 'SABRE', 'TRAVELPORT', 'NDC', 'DIRECT']);

export interface PnrRetrievalConfig {
  readonly bookingStatusPort?: PnrRetrievalPort;
  readonly orderPort?: OrderRetrievalPort;
}

export class PnrRetrieval implements Agent<PnrRetrievalInput, PnrRetrievalOutput> {
  readonly id = '3.8';
  readonly name = 'PNR Retrieval';
  readonly version = '0.1.0';

  private initialized = false;
  private readonly bookingStatusPort: PnrRetrievalPort | undefined;
  private readonly orderPort: OrderRetrievalPort | undefined;

  constructor(config?: PnrRetrievalConfig) {
    this.bookingStatusPort = config?.bookingStatusPort;
    this.orderPort = config?.orderPort;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<PnrRetrievalInput>,
  ): Promise<AgentOutput<PnrRetrievalOutput>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const result = await retrievePnr(input.data, {
      bookingStatusPort: this.bookingStatusPort,
      orderPort: this.orderPort,
    });

    const confidence =
      result.booking_status === 'CONFIRMED'
        ? 1.0
        : result.booking_status === 'UNKNOWN'
          ? 0.5
          : 0.8;

    return {
      data: result,
      confidence,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        source: result.source,
        wired: Boolean(this.bookingStatusPort ?? this.orderPort),
      },
    };
  }

  async health(): Promise<AgentHealthStatus> {
    if (!this.initialized) {
      return { status: 'unhealthy', details: 'Not initialized. Call initialize() first.' };
    }
    return { status: 'healthy' };
  }

  private validateInput(data: PnrRetrievalInput): void {
    if (!data.record_locator || typeof data.record_locator !== 'string') {
      throw new AgentInputValidationError(
        this.id,
        'record_locator',
        'Required string field. Provide a 5-8 character alphanumeric record locator.',
      );
    }

    const trimmed = data.record_locator.trim().toUpperCase();
    if (!RECORD_LOCATOR_RE.test(trimmed)) {
      throw new AgentInputValidationError(
        this.id,
        'record_locator',
        'Must be 5-8 uppercase alphanumeric characters (e.g. ABC123, XYZW12).',
      );
    }

    // Normalize for downstream.
    data.record_locator = trimmed;

    if (data.source !== undefined && !VALID_SOURCES.has(data.source)) {
      throw new AgentInputValidationError(
        this.id,
        'source',
        `Must be one of: ${[...VALID_SOURCES].join(', ')}`,
      );
    }
  }
}

export type { PnrRetrievalInput, PnrRetrievalOutput } from './types.js';
export type {
  RetrievedPassenger,
  RetrievedSegment,
  RetrievedContact,
  RetrievedTicketing,
  RetrievalSource,
  BookingStatus,
  SegmentStatus as PnrRetrievalSegmentStatus,
} from './types.js';
export type {
  BookingStatusPortResult,
  OrderRetrievalPort,
  PnrRetrievalPort,
  RetrievePnrOptions,
} from './retrieval-engine.js';
export { retrievePnr } from './retrieval-engine.js';
