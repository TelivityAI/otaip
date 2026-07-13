/**
 * Health-check degradation tests (Agent 0.1, issue #8).
 *
 * `airports.json` is required; `metro-areas.json` and `decommissioned.json` are
 * optional. Missing optional datasets → `degraded`; missing core → cannot
 * initialize (→ `unhealthy`); all present → `healthy`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AirportCodeResolver } from '../index.js';
import type { ProcessedAirport } from '../types.js';

const AIRPORTS: ProcessedAirport[] = [
  {
    iata_code: 'JFK',
    icao_code: 'KJFK',
    name: 'John F Kennedy International Airport',
    city_name: 'New York',
    city_code: 'NYC',
    country_code: 'US',
    country_name: 'United States',
    timezone: 'America/New_York',
    latitude: 40.6413,
    longitude: -73.7781,
    elevation_ft: 13,
    type: 'large_airport',
    status: 'active',
    primary: true,
  },
];

const dirs: string[] = [];

async function makeDir(files: Record<string, unknown>): Promise<string> {
  const dir = join(tmpdir(), `otaip-health-${Date.now()}-${dirs.length}`);
  await mkdir(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(dir, name), JSON.stringify(contents));
  }
  dirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe('AirportCodeResolver.health()', () => {
  it('returns healthy when all datasets are present', async () => {
    const dir = await makeDir({
      'airports.json': AIRPORTS,
      'metro-areas.json': [],
      'decommissioned.json': [],
    });
    const agent = new AirportCodeResolver({ dataDir: dir });
    await agent.initialize();
    expect((await agent.health()).status).toBe('healthy');
    agent.destroy();
  });

  it('returns degraded when optional datasets are missing', async () => {
    const dir = await makeDir({ 'airports.json': AIRPORTS });
    const agent = new AirportCodeResolver({ dataDir: dir });
    await agent.initialize();
    const health = await agent.health();
    expect(health.status).toBe('degraded');
    expect(health.details).toContain('metro-areas.json');
    expect(health.details).toContain('decommissioned.json');
    agent.destroy();
  });

  it('names only the missing optional dataset', async () => {
    const dir = await makeDir({
      'airports.json': AIRPORTS,
      'metro-areas.json': [],
    });
    const agent = new AirportCodeResolver({ dataDir: dir });
    await agent.initialize();
    const health = await agent.health();
    expect(health.status).toBe('degraded');
    expect(health.details).toContain('decommissioned.json');
    expect(health.details).not.toContain('metro-areas.json');
    agent.destroy();
  });

  it('reports unhealthy (cannot initialize) when core airports.json is missing', async () => {
    const dir = await makeDir({ 'metro-areas.json': [] });
    const agent = new AirportCodeResolver({ dataDir: dir });
    await expect(agent.initialize()).rejects.toThrow(/Airport data not found/);
    // Without initialization the agent is unhealthy.
    expect((await agent.health()).status).toBe('unhealthy');
  });
});
