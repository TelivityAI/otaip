/**
 * dist-runtime test — proves the BUILT bundle (not source) loads cleanly.
 *
 * Bug guarded against (B0a):
 *   `involuntary-rebook/rebook-engine.ts` loaded `./data/eu-countries.json`
 *   via `createRequire`. tsup bundles src/index.ts → dist/index.js without
 *   emitting the JSON file, so on `import @otaip/agents-exchange` (after
 *   publish) the bundled require resolved nothing → MODULE_NOT_FOUND the
 *   moment the package was imported. This shipped broken until the repo-wide
 *   `pnpm verify:dist` self-check caught it.
 *
 * Fix: the JSON file is imported via a plain ESM `import`, which esbuild
 * inlines into dist/index.js.
 *
 * This test imports the dist artifact DIRECTLY (not the package alias —
 * vitest.config.ts aliases `@otaip/agents-*` to `src/index.ts`, which would
 * defeat the test). The engine loads JSON at module top level, so a
 * successful `await import(dist)` already proves no MODULE_NOT_FOUND.
 *
 * Skips with a clear message when dist/index.js is missing. CI runs
 * `pnpm -r run build` before tests.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DIST_INDEX = resolve(__dirname, '..', '..', 'dist', 'index.js');
const DIST_AVAILABLE = existsSync(DIST_INDEX);

const describeIfBuilt = DIST_AVAILABLE ? describe : describe.skip;

if (!DIST_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    `[skip] @otaip/agents-exchange dist-runtime test: ${DIST_INDEX} not found.\n` +
      '       Run `pnpm --filter @otaip/agents-exchange build` first.',
  );
}

describeIfBuilt('@otaip/agents-exchange — built bundle loads + invokes', () => {
  it('importing dist/index.js does not throw MODULE_NOT_FOUND', async () => {
    const mod = await import(pathToFileURL(DIST_INDEX).href);
    expect(typeof mod).toBe('object');
    expect(mod).not.toBeNull();
  });

  it('exports the agent class that depends on JSON data', async () => {
    const mod = (await import(pathToFileURL(DIST_INDEX).href)) as Record<string, unknown>;
    expect(typeof mod['InvoluntaryRebook']).toBe('function');
  });
});
