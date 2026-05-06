/**
 * Integration tests for /api/playground/* — interactive API explorer.
 *
 * `initResolver: true` so the AirportCodeResolver agent is exercised
 * end-to-end. The mock OTA adapter handles the search-mode test path.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MockOtaAdapter } from '../mock-ota-adapter.js';
import { buildApp } from '../server.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    adapter: new MockOtaAdapter(),
    initResolver: true,
    security: { rateLimit: false, helmet: false, cors: false },
  });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app.close();
});

describe('GET /api/playground/catalog', () => {
  it('returns the discovered agents plus the executable whitelist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/playground/catalog' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      agents: Array<{ id: string; name: string }>;
      executable_ids: string[];
      schemas: Record<string, { description: string; example_input: unknown }>;
    };
    expect(body.agents.length).toBeGreaterThan(0);
    expect(body.executable_ids).toContain('0.1');
    expect(body.schemas['0.1']).toBeDefined();
    expect(body.schemas['0.1']?.example_input).toEqual({ code: 'JFK', code_type: 'iata' });
  });
});

describe('POST /api/playground/search', () => {
  it('runs a search through the configured adapter', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/playground/search',
      payload: {
        origin: 'JFK',
        destination: 'LAX',
        date: '2026-08-15',
        passengers: 1,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      offers: unknown[];
      totalFound: number;
      sources: string[];
      duration_ms: number;
    };
    expect(Array.isArray(body.offers)).toBe(true);
    expect(body.totalFound).toBe(body.offers.length);
    expect(typeof body.duration_ms).toBe('number');
  });

  it('rejects malformed origin via AJV body schema', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/playground/search',
      payload: { origin: 'JF', destination: 'LAX', date: '2026-08-15', passengers: 1 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/playground/agent', () => {
  it('executes the AirportCodeResolver (whitelisted)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/playground/agent',
      payload: {
        agent_id: '0.1',
        input: { code: 'JFK', code_type: 'iata' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      agent_id: string;
      output: { data: { resolved_airport: { iata_code: string | null } | null } };
      duration_ms: number;
    };
    expect(body.agent_id).toBe('0.1');
    expect(body.output.data.resolved_airport?.iata_code).toBe('JFK');
  }, 30_000);

  it('returns 501 with a clear message for unwired agents', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/playground/agent',
      payload: { agent_id: '99.99', input: {} },
    });
    expect(res.statusCode).toBe(501);
    const body = res.json() as { error: string; agent_id: string; hint: string };
    expect(body.agent_id).toBe('99.99');
    expect(body.error).toContain('not yet wired');
    expect(body.hint).toContain('executable_ids');
  });
});

describe('POST /api/playground/adapter', () => {
  it('runs the adapter health check', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/playground/adapter',
      payload: { operation: 'isAvailable' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { operation: string; output: boolean };
    expect(body.operation).toBe('isAvailable');
    expect(typeof body.output).toBe('boolean');
  });

  it('rejects an unknown operation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/playground/adapter',
      payload: { operation: 'book' },
    });
    expect(res.statusCode).toBe(400);
  });
});
