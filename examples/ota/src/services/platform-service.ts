/**
 * Platform Service — read-only telemetry that backs the Platform UI dashboard.
 *
 * Aggregates agent discovery + adapter env-var status + a small request-time
 * counter so the dashboard has one cohesive surface to render. No state is
 * mutated through this service; all data is in-memory or filesystem-only.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverAgents, type DiscoveredAgent } from '@otaip/core';

// ---------------------------------------------------------------------------
// Types — mirror the JSON the dashboard consumes
// ---------------------------------------------------------------------------

export interface AgentRollup {
  agents: DiscoveredAgent[];
  /** Counts keyed by stage. */
  domain_groups: Record<string, { total: number; active: number; stub: number }>;
  totals: { total: number; active: number; stub: number };
}

export interface AdapterDescriptor {
  id: string;
  name: string;
  type: string;
  auth: string;
  configured: boolean;
  /**
   * Names of the env vars consulted to determine `configured`. Surfaced so
   * the dashboard can hint at exactly what to set.
   */
  env_vars: string[];
}

export interface HealthReport {
  status: 'ok';
  uptime_seconds: number;
  node_version: string;
  otaip_version: string;
  /** ISO timestamp of the last request handled, or null when none yet. */
  last_request_at: string | null;
  /** Total requests handled since boot. */
  request_count: number;
}

export interface PlatformStats {
  agents: { total: number; active: number; stub: number };
  adapters: { total: number; configured: number };
}

// ---------------------------------------------------------------------------
// Adapter table — keyed off env-var presence. Read-only.
//
// Every adapter the brief enumerates is here. `env_vars` is the full set the
// adapter needs to be considered "configured" — adapters that need both a
// key and a secret list both, and we require all-present (logical AND).
// ---------------------------------------------------------------------------

const ADAPTERS: ReadonlyArray<Omit<AdapterDescriptor, 'configured'>> = [
  { id: 'amadeus',   name: 'Amadeus',           type: 'GDS',                          auth: 'OAuth2',         env_vars: ['AMADEUS_CLIENT_ID', 'AMADEUS_CLIENT_SECRET'] },
  { id: 'sabre',     name: 'Sabre',             type: 'GDS',                          auth: 'OAuth2 ATK',     env_vars: ['SABRE_CLIENT_ID', 'SABRE_CLIENT_SECRET'] },
  { id: 'navitaire', name: 'Navitaire',         type: 'LCC Direct',                   auth: 'JWT',            env_vars: ['NAVITAIRE_API_URL', 'NAVITAIRE_API_KEY'] },
  { id: 'trippro',   name: 'TripPro / Mondee',  type: 'NDC',                          auth: 'AccessToken',    env_vars: ['TRIPPRO_ACCESS_TOKEN'] },
  { id: 'duffel',    name: 'Duffel',            type: 'NDC REST',                     auth: 'API token',      env_vars: ['DUFFEL_API_KEY'] },
  { id: 'haip',      name: 'HAIP',              type: 'Hotel PMS',                    auth: 'Bearer',         env_vars: ['HAIP_API_TOKEN'] },
  { id: 'hotelbeds', name: 'Hotelbeds',         type: 'Hotel + Activities + Transfers', auth: 'API key + Secret', env_vars: ['HOTELBEDS_API_KEY', 'HOTELBEDS_SECRET'] },
];

function envIsSet(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// OTAIP version — read once at module load. The reference OTA's
// package.json is the closest authoritative version — the workspace as a
// whole tracks it.
// ---------------------------------------------------------------------------

const OTAIP_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PlatformService {
  private readonly bootMs = Date.now();
  private lastRequestAt: string | null = null;
  private requestCount = 0;

  /** Called from a Fastify onRequest hook to keep the dashboard health honest. */
  recordRequest(): void {
    this.lastRequestAt = new Date().toISOString();
    this.requestCount++;
  }

  agents(): AgentRollup {
    const agents = discoverAgents();
    const domain_groups: Record<string, { total: number; active: number; stub: number }> = {};
    let activeTotal = 0;
    let stubTotal = 0;
    for (const a of agents) {
      const bucket = (domain_groups[a.stage] ??= { total: 0, active: 0, stub: 0 });
      bucket.total++;
      if (a.contract_status === 'active') {
        bucket.active++;
        activeTotal++;
      } else {
        bucket.stub++;
        stubTotal++;
      }
    }
    return {
      agents,
      domain_groups,
      totals: { total: agents.length, active: activeTotal, stub: stubTotal },
    };
  }

  adapters(): AdapterDescriptor[] {
    return ADAPTERS.map((a) => ({
      ...a,
      configured: a.env_vars.every(envIsSet),
    }));
  }

  health(): HealthReport {
    return {
      status: 'ok',
      uptime_seconds: Math.floor((Date.now() - this.bootMs) / 1000),
      node_version: process.version,
      otaip_version: OTAIP_VERSION,
      last_request_at: this.lastRequestAt,
      request_count: this.requestCount,
    };
  }

  stats(): PlatformStats {
    const ag = this.agents().totals;
    const adapters = this.adapters();
    return {
      agents: { total: ag.total, active: ag.active, stub: ag.stub },
      adapters: {
        total: adapters.length,
        configured: adapters.filter((a) => a.configured).length,
      },
    };
  }
}
