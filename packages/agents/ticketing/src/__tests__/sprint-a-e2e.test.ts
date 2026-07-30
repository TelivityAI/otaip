/**
 * Sprint A end-to-end integration test.
 *
 * Proves the pipeline validator catches every category of LLM hallucination
 * along the full demo flow (search → fare rules → offer → routing → book →
 * ticket) without touching a real LLM, real adapters, or network.
 *
 * All 9 Sprint A contracts are registered. All six logical gates
 * (schema, semantic, intent, cross-agent, confidence, action_class) fire
 * at least once across the run.
 *
 * Location note: this file lives in @otaip/agents-ticketing because the
 * ticketing package transitively depends on all nine contracted agent
 * packages, making it the natural home for the cross-package integration
 * test. The test itself uses stub agents (not real implementations) so it
 * is deterministic and offline.
 */

import type { Agent, AgentContract, ReferenceDataProvider } from '@otaip/core';
import { PipelineOrchestrator } from '@otaip/core';
import {
  airlineCodeMapperContract,
  airportCodeResolverContract,
  fareBasisDecoderContract,
} from '@otaip/agents-reference';
import { availabilitySearchContract } from '@otaip/agents-search';
import {
  fareRuleAgentContract,
  offerBuilderAgentContract,
} from '@otaip/agents-pricing';
import {
  gdsNdcRouterContract,
  pnrBuilderContract,
} from '@otaip/agents-booking';
import { describe, expect, it } from 'vitest';
import { ticketIssuanceContract } from '../ticket-issuance/contract.js';

// ───────────────────────────────────────────────────────────────────────────
// Canned reference data provider — deterministic, offline.
// ───────────────────────────────────────────────────────────────────────────

const KNOWN_AIRPORTS: Record<string, { name: string; city: string; country: string }> = {
  JFK: { name: 'John F Kennedy Intl', city: 'New York', country: 'US' },
  LHR: { name: 'London Heathrow', city: 'London', country: 'GB' },
  CDG: { name: 'Paris Charles de Gaulle', city: 'Paris', country: 'FR' },
};

const KNOWN_AIRLINES: Record<string, { name: string }> = {
  BA: { name: 'British Airways' },
  UA: { name: 'United Airlines' },
  AA: { name: 'American Airlines' },
};

const cannedReference: ReferenceDataProvider = {
  async resolveAirport(code) {
    const rec = KNOWN_AIRPORTS[code];
    if (!rec) return null;
    return {
      iataCode: code,
      name: rec.name,
      city: rec.city,
      country: rec.country,
      matchConfidence: 1.0,
    };
  },
  async resolveAirline(code) {
    const rec = KNOWN_AIRLINES[code];
    if (!rec) return null;
    return { iataCode: code, name: rec.name, matchConfidence: 1.0 };
  },
  async decodeFareBasis(code) {
    return { fareBasis: code, matchConfidence: 1.0 };
  },
};

// ───────────────────────────────────────────────────────────────────────────
// Stub agent factory — uses `any` in its signature to allow adapting the
// pipeline's generic input/output shapes. Deterministic and offline.
// ───────────────────────────────────────────────────────────────────────────

function mkAgent(
  id: string,
  transform: (data: unknown) => unknown,
  confidence = 1.0,
): Agent {
  return {
    id,
    name: id,
    version: '0.0.1',
    async initialize() {},
    async execute(input) {
      return { data: transform(input.data), confidence };
    },
    async health() {
      return { status: 'healthy' };
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Fixtures: canned agent outputs shaped to pass each contract's outputSchema.
// ───────────────────────────────────────────────────────────────────────────

const canned = {
  airportResolver: () =>
    mkAgent('0.1', (input) => {
      const code = (input as { code: string }).code;
      const known = KNOWN_AIRPORTS[code];
      return {
        resolved_airport: known
          ? {
              iata_code: code,
              icao_code: null,
              name: known.name,
              city_code: null,
              city_name: known.city,
              country_code: known.country,
              country_name: known.country,
              timezone: null,
              utc_offset: null,
              latitude: 0,
              longitude: 0,
              elevation_ft: null,
              type: 'large_airport' as const,
              status: 'active' as const,
            }
          : null,
        metro_airports: null,
        match_confidence: known ? 1.0 : 0,
      };
    }),
  airlineMapper: () =>
    mkAgent('0.2', (input) => {
      const code = (input as { code: string }).code;
      const known = KNOWN_AIRLINES[code];
      return {
        airline: known
          ? {
              iata_code: code,
              icao_code: null,
              name: known.name,
              callsign: null,
              country_code: 'US',
              country_name: 'United States',
              alliance: null,
              alliance_status: null,
              is_operating: true,
              hub_airports: [],
              website: null,
              founded_year: null,
              status: 'active' as const,
              merged_into: null,
              defunct_date: null,
            }
          : null,
        codeshare_partners: null,
        match_confidence: known ? 1.0 : 0,
      };
    }),
  fareBasisDecoder: () =>
    mkAgent('0.3', (input) => ({
      decoded: {
        fare_basis: (input as { fare_basis: string }).fare_basis,
        primary_code: 'Y',
        cabin_class: 'economy' as const,
        fare_type: 'normal' as const,
        season: null,
        day_of_week: null,
        advance_purchase: null,
        min_stay: null,
        max_stay: null,
        penalties: {
          refundable: true,
          changeable: true,
          change_fee_applies: false,
          description: null,
        },
        ticket_designator: null,
      },
      match_confidence: 1.0,
      unparsed_segments: [],
    })),
  availabilitySearch: () =>
    mkAgent('1.1', () => ({
      offers: [
        {
          offer_id: 'offer-real-1',
          source: 'amadeus',
          itinerary: {
            source_id: 'src-1',
            source: 'amadeus',
            segments: [
              {
                carrier: 'BA',
                flight_number: '112',
                origin: 'JFK',
                destination: 'LHR',
                departure_time: '2026-05-01T18:00:00Z',
                arrival_time: '2026-05-02T06:30:00Z',
                duration_minutes: 450,
              },
            ],
            total_duration_minutes: 450,
            connection_count: 0,
          },
          price: { base_fare: 400, taxes: 50, total: 450, currency: 'USD' },
        },
      ],
      total_raw_offers: 1,
      source_status: [
        { source: 'amadeus', success: true, offer_count: 1, response_time_ms: 100 },
      ],
      truncated: false,
    })),
  fareRule: () =>
    mkAgent('2.1', () => ({
      rules: [],
      total_rules: 0,
      valid_for_date: true,
      in_blackout: false,
    })),
  offerBuilder: () =>
    mkAgent('2.4', () => ({
      offer: {
        offerId: 'built-1',
        segments: [
          {
            carrier: 'BA',
            flightNumber: '112',
            origin: 'JFK',
            destination: 'LHR',
            departureDate: '2026-05-01',
            cabin: 'Y',
          },
        ],
        fare: { basis: 'YOW', cabin: 'Y', baseAmount: '400.00', currency: 'USD' },
        taxes: [],
        ancillaries: [],
        subtotal: '400.00',
        ancillaryTotal: '0.00',
        totalAmount: '450.00',
        currency: 'USD',
        passengerCount: 1,
        perPassengerTotal: '450.00',
        pricingSource: 'GDS' as const,
        createdAt: '2026-04-20T12:00:00Z',
        expiresAt: '2026-04-20T13:00:00Z',
        status: 'ACTIVE' as const,
      },
    })),
  gdsNdcRouter: () =>
    mkAgent('3.1', () => ({
      routings: [
        {
          primary_channel: 'GDS' as const,
          gds_system: 'AMADEUS' as const,
          ndc_version: null,
          ndc_provider_id: null,
          fallbacks: [],
          routed_carrier: 'BA',
          codeshare_applied: false,
          booking_format: 'GDS_PNR' as const,
        },
      ],
      unified_channel: true,
      recommended_channel: 'GDS' as const,
      gds_format: null,
      ndc_format: null,
    })),
  pnrBuilder: () =>
    mkAgent('3.2', () => ({
      gds: 'AMADEUS' as const,
      commands: [
        { command: 'NM1TEST/JOHN MR', description: 'name', element_type: 'NAME' as const },
      ],
      passenger_count: 1,
      segment_count: 1,
      is_group: false,
      infant_count: 0,
    })),
  ticketIssuance: () =>
    mkAgent('4.1', () => ({
      tickets: [
        {
          ticket_number: '125-1234567890',
          record_locator: 'ABC123',
          issuing_carrier: 'BA',
          issue_date: '2026-04-20',
          passenger_name: 'TEST/JOHN MR',
          coupons: [
            {
              carrier: 'BA',
              flight_number: '112',
              origin: 'JFK',
              destination: 'LHR',
              departure_date: '2026-05-01',
              booking_class: 'Y',
              fare_basis: 'YOW',
              coupon_number: 1,
              status: 'O' as const,
            },
          ],
          base_fare: '400.00',
          base_fare_currency: 'USD',
          total_tax: '50.00',
          taxes: [{ code: 'YQ', amount: '50.00', currency: 'USD' }],
          total_amount: '450.00',
          fare_calculation: 'JFK BA LHR 400.00 NUC400.00 END ROE1.0',
          form_of_payment: {
            type: 'CREDIT_CARD' as const,
            card_code: 'VI',
            card_last_four: '4242',
            amount: '450.00',
            currency: 'USD',
          },
        },
      ],
      total_coupons: 1,
      is_conjunction: false,
    })),
};

// ───────────────────────────────────────────────────────────────────────────
// Orchestrator factory.
// ───────────────────────────────────────────────────────────────────────────

function makeOrchestrator(): PipelineOrchestrator {
  const contracts = new Map<string, AgentContract>([
    ['0.1', airportCodeResolverContract],
    ['0.2', airlineCodeMapperContract],
    ['0.3', fareBasisDecoderContract],
    ['1.1', availabilitySearchContract],
    ['2.1', fareRuleAgentContract],
    ['2.4', offerBuilderAgentContract],
    ['3.1', gdsNdcRouterContract],
    ['3.2', pnrBuilderContract],
    ['4.1', ticketIssuanceContract],
  ]);
  const agents = new Map<string, Agent>([
    ['0.1', canned.airportResolver()],
    ['0.2', canned.airlineMapper()],
    ['0.3', canned.fareBasisDecoder()],
    ['1.1', canned.availabilitySearch()],
    ['2.1', canned.fareRule()],
    ['2.4', canned.offerBuilder()],
    ['3.1', canned.gdsNdcRouter()],
    ['3.2', canned.pnrBuilder()],
    ['4.1', canned.ticketIssuance()],
  ]);
  return new PipelineOrchestrator({
    reference: cannedReference,
    contracts,
    agents,
    referenceAgentIds: new Set(['0.1', '0.2', '0.3']),
    now: () => new Date('2026-04-20T12:00:00Z'),
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

describe('Sprint A end-to-end pipeline', () => {
  it('runs the full happy-path flow and fires all six logical gates', async () => {
    const orch = makeOrchestrator();
    const session = orch.createSession({
      type: 'one_way_economy_booking',
      origin: 'JFK',
      destination: 'LHR',
      outboundDate: '2026-05-01',
      passengerCount: 1,
      cabinClass: 'economy',
    });

    // 1) Availability search (query) — all gates except action_class-block fire.
    const searchInput = {
      origin: 'JFK',
      destination: 'LHR',
      departure_date: '2026-05-01',
      passengers: [{ type: 'ADT' as const, count: 1 }],
    };
    const r1 = await orch.runAgent(session, '1.1', searchInput);
    expect(r1.ok).toBe(true);

    // 2) Fare rules lookup.
    const r2 = await orch.runAgent(session, '2.1', {
      fare_basis: 'YOW',
      carrier: 'BA',
      origin: 'JFK',
      destination: 'LHR',
      travel_date: '2026-05-01',
    });
    expect(r2.ok).toBe(true);

    // 3) Offer builder.
    const r3 = await orch.runAgent(session, '2.4', {
      operation: 'buildOffer',
      buildInput: {
        segments: [
          {
            carrier: 'BA',
            flightNumber: '112',
            origin: 'JFK',
            destination: 'LHR',
            departureDate: '2026-05-01',
            cabin: 'Y',
          },
        ],
        fare: {
          basis: 'YOW',
          cabin: 'Y',
          nuc: '400.00',
          roe: '1.0',
          baseAmount: '400.00',
          currency: 'USD',
        },
        taxes: [],
        passengerCount: 1,
        pricingSource: 'GDS',
      },
    });
    expect(r3.ok).toBe(true);

    // 4) GDS/NDC routing decision.
    const r4 = await orch.runAgent(session, '3.1', {
      segments: [
        { marketing_carrier: 'BA', origin: 'JFK', destination: 'LHR' },
      ],
      include_fallbacks: true,
    });
    expect(r4.ok).toBe(true);

    // 5) PNR build (mutation_reversible).
    const r5 = await orch.runAgent(session, '3.2', {
      gds: 'AMADEUS',
      passengers: [
        { last_name: 'TEST', first_name: 'JOHN', passenger_type: 'ADT' },
      ],
      segments: [
        {
          carrier: 'BA',
          flight_number: '112',
          booking_class: 'Y',
          departure_date: '2026-05-01',
          origin: 'JFK',
          destination: 'LHR',
          quantity: 1,
          status: 'SS',
        },
      ],
      contacts: [{ phone: '+1555', type: 'AGENCY' }],
      ticketing: { time_limit: '2026-04-25', type: 'TL' },
      received_from: 'TEST',
    });
    expect(r5.ok).toBe(true);

    // 6) Ticket issuance WITHOUT approval token → blocked at action_class.
    const ticketInput = {
      record_locator: 'ABC123',
      issuing_carrier: 'BA',
      passenger_name: 'TEST/JOHN MR',
      segments: [
        {
          carrier: 'BA',
          flight_number: '112',
          origin: 'JFK',
          destination: 'LHR',
          departure_date: '2026-05-01',
          booking_class: 'Y',
          fare_basis: 'YOW',
        },
      ],
      base_fare: '400.00',
      base_fare_currency: 'USD',
      taxes: [{ code: 'YQ', amount: '50.00', currency: 'USD' }],
      fare_calculation: 'JFK BA LHR 400.00 NUC400.00 END ROE1.0',
      form_of_payment: {
        type: 'CREDIT_CARD' as const,
        card_code: 'VI',
        card_last_four: '4242',
        amount: '450.00',
        currency: 'USD',
      },
    };
    const r6a = await orch.runAgent(session, '4.1', ticketInput);
    expect(r6a.ok).toBe(false);
    if (!r6a.ok) expect(r6a.reason).toBe('action_class_blocked');

    // 7) Ticket issuance WITH bound approval token → commits.
    const { issueBoundApprovalToken } = await import('@otaip/core');
    const approvalToken = issueBoundApprovalToken({
      sessionId: session.sessionId,
      agentId: '4.1',
      input: ticketInput,
      secret: 'test-secret',
    });
    const r6b = await orch.runAgent(session, '4.1', {
      ...ticketInput,
      approvalToken,
    });
    expect(r6b.ok).toBe(true);

    // Across the whole session, every one of the six logical gates fired at
    // least once on a passing invocation.
    const gatesFired = new Set<string>();
    for (const inv of session.history) {
      for (const g of inv.gateResults) {
        if (g.passed) gatesFired.add(g.gate);
      }
    }
    expect(gatesFired.has('intent_lock')).toBe(true);
    expect(gatesFired.has('schema_in')).toBe(true);
    expect(gatesFired.has('semantic_in')).toBe(true);
    expect(gatesFired.has('cross_agent')).toBe(true);
    expect(gatesFired.has('schema_out')).toBe(true);
    expect(gatesFired.has('confidence')).toBe(true);
    expect(gatesFired.has('action_class')).toBe(true);
  });

  it('rejects an invalid airport code at the semantic_in gate', async () => {
    // Open a session whose intent IS 'XYZ' so the intent_lock gate passes;
    // semantic_in is then the first gate that can catch the unknown airport.
    const orch = makeOrchestrator();
    const session = orch.createSession({
      type: 'one_way_economy_booking',
      origin: 'XYZ',
      destination: 'LHR',
      outboundDate: '2026-05-01',
      passengerCount: 1,
    });
    const r = await orch.runAgent(session, '1.1', {
      origin: 'XYZ',
      destination: 'LHR',
      departure_date: '2026-05-01',
      passengers: [{ type: 'ADT' as const, count: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('semantic_invalid');
      expect(r.issues.map((i) => i.code)).toContain('AIRPORT_NOT_FOUND');
    }
  });

  it('blocks a destination change mid-session at the intent_lock gate', async () => {
    const orch = makeOrchestrator();
    const session = orch.createSession({
      type: 'one_way_economy_booking',
      origin: 'JFK',
      destination: 'LHR',
      outboundDate: '2026-05-01',
      passengerCount: 1,
    });
    // Try to pivot the route to CDG via the search agent.
    const r = await orch.runAgent(session, '1.1', {
      origin: 'JFK',
      destination: 'CDG',
      departure_date: '2026-05-01',
      passengers: [{ type: 'ADT' as const, count: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('intent_lock');
  });

  it('blocks a past departure date at the semantic_in gate', async () => {
    const orch = makeOrchestrator();
    const session = orch.createSession({
      type: 'one_way_economy_booking',
      origin: 'JFK',
      destination: 'LHR',
      outboundDate: '2025-01-01',
      passengerCount: 1,
    });
    const r = await orch.runAgent(session, '1.1', {
      origin: 'JFK',
      destination: 'LHR',
      departure_date: '2025-01-01',
      passengers: [{ type: 'ADT' as const, count: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('semantic_invalid');
      expect(r.issues.map((i) => i.code)).toContain('DATE_IN_PAST');
    }
  });
});
