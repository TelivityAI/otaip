/**
 * Integration tests for /api/platform/* — read-only telemetry endpoints.
 *
 * Uses Fastify inject (no real HTTP) with MockOtaAdapter so tests don't
 * pull in the live Duffel client at boot.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MockOtaAdapter } from '../mock-ota-adapter.js';
import { buildApp } from '../server.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    adapter: new MockOtaAdapter(),
    initResolver: false,
    // The platform routes opt out of rate limiting via per-route config;
    // this guard makes sure tests don't accidentally trip the global cap.
    security: { rateLimit: false, helmet: false, cors: false },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/platform/agents', () => {
  it('returns the discovered agent list with domain rollups', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/platform/agents' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      agents: Array<{ id: string; stage: string; contract_status: string; version: string }>;
      domain_groups: Record<string, { total: number; active: number; stub: number }>;
      totals: { total: number; active: number; stub: number };
    };
    expect(body.agents.length).toBeGreaterThan(0);
    expect(body.totals.total).toBe(body.agents.length);
    expect(body.totals.active + body.totals.stub).toBe(body.totals.total);
    // Every domain bucket totals match its members
    for (const [stage, bucket] of Object.entries(body.domain_groups)) {
      const members = body.agents.filter((a) => a.stage === stage);
      expect(members.length).toBe(bucket.total);
      expect(members.filter((a) => a.contract_status === 'active').length).toBe(bucket.active);
    }
  });

  it('marks v0.0.0 agents as stubs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/platform/agents' });
    const body = res.json() as { agents: Array<{ version: string; contract_status: string }> };
    for (const a of body.agents) {
      if (a.version === '0.0.0') expect(a.contract_status).toBe('stub');
      else expect(a.contract_status).toBe('active');
    }
  });
});

describe('GET /api/platform/agent-graph', () => {
  it('returns the committed agent navigation graph', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/platform/agent-graph' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      nodes: Array<{ id: string; stage: string; has_contract: boolean }>;
      edges: Array<{ source: string; target: string; kind: string; label: string }>;
      package_deps: Array<{ from_stage: string; to_stage: string }>;
      total_nodes: number;
      total_edges: number;
    };
    expect(body.nodes.length).toBe(body.total_nodes);
    expect(body.edges.length).toBe(body.total_edges);
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.edges.some((e) => e.kind === 'workflow')).toBe(true);
    expect(body.package_deps.length).toBeGreaterThan(0);
    const ids = new Set(body.nodes.map((n) => n.id));
    for (const e of body.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });
});

describe('GET /api/platform/adapters', () => {
  it('lists every documented adapter with env-derived configured flags', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/platform/adapters' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      adapters: Array<{ id: string; name: string; configured: boolean; env_vars: string[] }>;
    };
    const ids = body.adapters.map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining(['amadeus', 'sabre', 'navitaire', 'trippro', 'duffel', 'haip', 'hotelbeds']),
    );
    // The hotelbeds adapter is "configured" iff both API_KEY and SECRET are set
    const hb = body.adapters.find((a) => a.id === 'hotelbeds')!;
    const hbExpected =
      Boolean(process.env['HOTELBEDS_API_KEY']) && Boolean(process.env['HOTELBEDS_SECRET']);
    expect(hb.configured).toBe(hbExpected);
  });
});

describe('GET /api/platform/health', () => {
  it('returns uptime, node version, and a request count after the call lands', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/platform/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      status: string;
      uptime_seconds: number;
      node_version: string;
      otaip_version: string;
      last_request_at: string | null;
      request_count: number;
    };
    expect(body.status).toBe('ok');
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(body.node_version).toMatch(/^v\d+\.\d+\.\d+/);
    expect(body.request_count).toBeGreaterThan(0);
    expect(body.last_request_at).not.toBeNull();
  });
});

describe('GET /api/platform/stats', () => {
  it('returns aggregate counts that agree with the agent + adapter endpoints', async () => {
    const [statsRes, agentsRes, adaptersRes] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/platform/stats' }),
      app.inject({ method: 'GET', url: '/api/platform/agents' }),
      app.inject({ method: 'GET', url: '/api/platform/adapters' }),
    ]);
    expect(statsRes.statusCode).toBe(200);
    const stats = statsRes.json() as {
      agents: { total: number; active: number; stub: number };
      adapters: { total: number; configured: number };
    };
    const agents = (agentsRes.json() as { totals: { total: number } }).totals;
    const adapters = (adaptersRes.json() as { adapters: Array<{ configured: boolean }> }).adapters;
    expect(stats.agents.total).toBe(agents.total);
    expect(stats.adapters.total).toBe(adapters.length);
    expect(stats.adapters.configured).toBe(adapters.filter((a) => a.configured).length);
  });
});
