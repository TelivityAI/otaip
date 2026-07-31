/**
 * Offline integration tests.
 *
 * These prove the wiring — gates fire, the trace is emitted, FileEventStore is
 * durable — WITHOUT touching the network. A stub `DistributionAdapter` stands
 * in for Duffel and a canned `ReferenceDataProvider` stands in for OurAirports.
 * The live sandbox proof lives in scripts/duffel-search.ts (run manually with a
 * real DUFFEL_API_KEY); see INTEGRATION.md.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type {
  DistributionAdapter,
  ReferenceDataProvider,
  SearchRequest,
  SearchResponse,
} from '@otaip/core';
import { InMemoryEventStore } from '@otaip/core';
import type { AvailabilitySearchInput } from '@otaip/agents-search';
import { runAvailabilitySearch } from '../run-search.js';
import { getRunTrace } from '../trace.js';
import { FileEventStore } from '../file-event-store.js';

// ── Stubs ────────────────────────────────────────────────────────────────────

function stubAdapter(name = 'duffel'): DistributionAdapter {
  return {
    name,
    async isAvailable() {
      return true;
    },
    async search(request: SearchRequest): Promise<SearchResponse> {
      const seg = request.segments[0]!;
      return {
        offers: [
          {
            offer_id: 'off_stub_0001',
            source: name,
            itinerary: {
              source_id: 'off_stub_0001',
              source: name,
              segments: [
                {
                  carrier: 'ZZ',
                  flight_number: '1000',
                  origin: seg.origin,
                  destination: seg.destination,
                  departure_time: `${seg.departure_date}T09:00:00Z`,
                  arrival_time: `${seg.departure_date}T21:00:00Z`,
                  duration_minutes: 420,
                  cabin_class: 'economy',
                  stops: 0,
                },
              ],
              total_duration_minutes: 420,
              connection_count: 0,
            },
            price: { base_fare: 300, taxes: 120, total: 420, currency: 'GBP' },
          },
        ],
        truncated: false,
        metadata: { source: name },
      };
    },
  };
}

const cannedReference: ReferenceDataProvider = {
  async resolveAirport(code) {
    const known: Record<string, string> = { JFK: 'John F Kennedy Intl', LHR: 'London Heathrow' };
    if (!(code in known)) return null;
    return { iataCode: code, name: known[code]!, matchConfidence: 1 };
  },
  async resolveAirline(code) {
    return { iataCode: code, name: code, matchConfidence: 1 };
  },
  async decodeFareBasis(code) {
    return { fareBasis: code, matchConfidence: 1 };
  },
};

const baseInput: AvailabilitySearchInput = {
  origin: 'JFK',
  destination: 'LHR',
  departure_date: '2026-07-23',
  passengers: [{ type: 'ADT', count: 1 }],
  cabin_class: 'economy',
  currency: 'GBP',
};

const fixedNow = () => new Date('2026-06-23T12:00:00Z');

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runAvailabilitySearch (offline)', () => {
  it('passes all gates and emits a readable trace for a valid search', async () => {
    const res = await runAvailabilitySearch(baseInput, {
      adapter: stubAdapter(),
      reference: cannedReference,
      now: fixedNow,
    });

    expect(res.ok).toBe(true);
    expect(res.output?.offers).toHaveLength(1);
    expect(res.output?.offers[0]?.price.currency).toBe('GBP');

    // Trace is readable by session id and reflects the gates.
    const trace = await getRunTrace(res.eventStore, res.sessionId);
    expect(trace.outcome).toBe('ok');
    expect(trace.agentExecutions).toHaveLength(1);

    const exec = trace.agentExecutions[0]!;
    expect(exec.agentId).toBe('1.1');
    expect(exec.success).toBe(true);
    const passedGates = new Set(exec.gateResults.filter((g) => g.passed).map((g) => g.gate));
    // Query agents skip action_class (approval runs pre-execute for mutations only).
    for (const gate of [
      'intent_lock',
      'schema_in',
      'semantic_in',
      'cross_agent',
      'execute',
      'schema_out',
      'confidence',
    ]) {
      expect(passedGates.has(gate)).toBe(true);
    }
    expect(passedGates.has('action_class')).toBe(false);

    expect(trace.adapterHealth).toHaveLength(1);
    expect(trace.adapterHealth[0]?.status).toBe('healthy');
  });

  it('rejects an unknown airport at the semantic gate and records it in the trace', async () => {
    const res = await runAvailabilitySearch(
      { ...baseInput, destination: 'ZZZ' },
      { adapter: stubAdapter(), reference: cannedReference, now: fixedNow },
    );

    expect(res.ok).toBe(false);
    expect(res.failure?.reason).toBe('semantic_invalid');
    expect(res.failure?.failureClass).toBe('validation');

    const trace = await getRunTrace(res.eventStore, res.sessionId);
    expect(trace.outcome).toBe('rejected');
    expect(trace.agentExecutions[0]?.success).toBe(false);
  });

  it('writes a durable trace that a different store instance can read back', async () => {
    const path = join(tmpdir(), `otaip-trace-${process.pid}-${Date.now()}.jsonl`);
    try {
      const store = await FileEventStore.open(path);
      const res = await runAvailabilitySearch(baseInput, {
        adapter: stubAdapter(),
        reference: cannedReference,
        eventStore: store,
        now: fixedNow,
      });
      expect(res.ok).toBe(true);

      // The on-disk file actually contains JSONL events with no secrets.
      const raw = await readFile(path, 'utf-8');
      const lines = raw.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(raw).not.toMatch(/duffel_test_|duffel_live_|Bearer/i);

      // A fresh store, opened on the same file, reads the trace back by id.
      const reopened = await FileEventStore.open(path);
      const trace = await getRunTrace(reopened, res.sessionId);
      expect(trace.outcome).toBe('ok');
      expect(trace.agentExecutions).toHaveLength(1);
      expect(trace.adapterHealth).toHaveLength(1);
    } finally {
      await rm(path, { force: true });
    }
  });

  it('defaults to an in-memory store when none is provided', async () => {
    const res = await runAvailabilitySearch(baseInput, {
      adapter: stubAdapter(),
      reference: cannedReference,
      now: fixedNow,
    });
    expect(res.eventStore).toBeInstanceOf(InMemoryEventStore);
  });
});
