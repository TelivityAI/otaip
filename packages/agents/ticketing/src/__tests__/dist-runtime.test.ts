/**
 * dist-runtime test — proves the BUILT bundle (not source) loads cleanly.
 *
 * Bug guarded against (B0a):
 *   Engines used `require('./data/x.json')` via `createRequire`. tsup
 *   bundles src/index.ts → dist/index.js without emitting the JSON files,
 *   so on `import @otaip/agents-ticketing` (after publish) the bundled
 *   require resolves nothing → MODULE_NOT_FOUND → agent gates throw the
 *   moment the package is imported by a downstream consumer.
 *
 * Fix: JSON files are imported via plain ESM `import` statements, which
 * esbuild inlines into dist/index.js.
 *
 * This test imports the dist artifact DIRECTLY (not the package alias —
 * vitest.config.ts aliases `@otaip/agents-*` to `src/index.ts`, which
 * would defeat the test). Engines load JSON at module top-level, so a
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
    `[skip] @otaip/agents-ticketing dist-runtime test: ${DIST_INDEX} not found.\n` +
      '       Run `pnpm --filter @otaip/agents-ticketing build` first.',
  );
}

describeIfBuilt('@otaip/agents-ticketing — built bundle loads + invokes', () => {
  it('importing dist/index.js does not throw MODULE_NOT_FOUND', async () => {
    const mod = await import(pathToFileURL(DIST_INDEX).href);
    // JSON files are loaded at module top-level inside the engines, so a
    // successful import is sufficient evidence the bundle inlined them.
    expect(typeof mod).toBe('object');
    expect(mod).not.toBeNull();
  });

  it('exports the agent classes that depend on JSON data', async () => {
    const mod = (await import(pathToFileURL(DIST_INDEX).href)) as Record<string, unknown>;
    expect(typeof mod['TicketIssuance']).toBe('function');
    expect(typeof mod['VoidAgent']).toBe('function');
    expect(typeof mod['EmdManagement']).toBe('function');
  });
});
