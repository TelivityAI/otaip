#!/usr/bin/env tsx
/**
 * Build self-check — proves every published `@otaip/*` bundle actually LOADS.
 *
 * The footgun this guards against (B0a):
 *   tsup bundles `src/index.ts` → `dist/index.js` but does NOT copy
 *   `data/*.json`. An engine that loaded JSON via `createRequire(...)` emits a
 *   runtime `require('./data/x.json')` into the bundle that resolves nothing →
 *   `MODULE_NOT_FOUND` the moment a downstream consumer imports the package.
 *   Agent discovery never catches this (it reads source, never imports), and
 *   `pnpm publish` prints success regardless — so a broken package ships
 *   silently and a consumer gets a plausible-but-wrong validation rate.
 *
 * Two per-package `dist-runtime.test.ts` files (booking, ticketing) guard
 * this for those two packages only. This script generalises the same check to
 * EVERY publishable package and fails loud on the first load error, naming the
 * package and cause.
 *
 * Run after `pnpm -r run build` (the root `verify` script chains both).
 *
 * Usage:
 *   pnpm verify:dist            # after a build
 *   pnpm verify                 # build, then verify:dist
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverAgents } from '../packages/core/src/discovery/agent-discovery.js';

/** Hard floor for the agent roster — mirrors the CLI discovery test. */
const MIN_AGENTS = 60;

/**
 * Packages we must NOT `import()` here because doing so has side effects.
 * `@otaip/cli` calls `program.parse()` at module top level, so importing its
 * bundle would parse THIS script's argv. It is an executable entrypoint, not a
 * data-dependent library, and is covered by its own test suite.
 */
const IMPORT_EXCLUDE = new Set<string>(['@otaip/cli']);

interface WorkspacePackage {
  readonly name?: string;
  readonly path: string;
  readonly private?: boolean;
}

/**
 * Enumerate publishable `@otaip/*` packages exactly the way the publish
 * workflow does (`pnpm m ls --json`), so this self-check covers the same set
 * that actually ships to npm.
 */
function listPublishablePackages(): { name: string; path: string }[] {
  const raw = execSync('pnpm m ls --json --depth=-1', { encoding: 'utf8' });
  const arr = JSON.parse(raw) as WorkspacePackage[];
  return arr
    .filter((p) => !p.private && p.name?.startsWith('@otaip/'))
    .map((p) => ({ name: p.name as string, path: p.path }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function main(): Promise<void> {
  const pkgs = listPublishablePackages();
  if (pkgs.length === 0) {
    console.error(
      'verify-dist: no publishable @otaip/* packages discovered — refusing to claim success.',
    );
    process.exit(1);
  }

  console.log(`verify-dist: checking ${pkgs.length} built packages…`);
  const errors: string[] = [];

  for (const pkg of pkgs) {
    const dist = join(pkg.path, 'dist', 'index.js');
    if (!existsSync(dist)) {
      errors.push(`${pkg.name}: missing ${dist} — run \`pnpm -r run build\` first.`);
      console.log(`  MISSING  ${pkg.name}`);
      continue;
    }
    if (IMPORT_EXCLUDE.has(pkg.name)) {
      console.log(`  SKIP     ${pkg.name}  (executable entrypoint — built artifact present)`);
      continue;
    }
    try {
      // Engines load their JSON at module top level, so a clean import is
      // sufficient evidence the bundle inlined every data file (see the
      // existing dist-runtime tests).
      await import(pathToFileURL(dist).href);
      console.log(`  OK       ${pkg.name}`);
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      errors.push(`${pkg.name}: dist failed to import — ${msg}`);
      console.log(`  FAIL     ${pkg.name}  (${msg})`);
    }
  }

  // Roster sanity: discovery must still enumerate a non-trivial set of agents.
  const agents = discoverAgents();
  console.log(`verify-dist: discovered ${agents.length} agents across the workspace.`);
  if (agents.length < MIN_AGENTS) {
    errors.push(
      `agent discovery returned only ${agents.length} agents (expected >= ${MIN_AGENTS}) — the discovery walk is likely broken.`,
    );
  }

  if (errors.length > 0) {
    console.error('\nverify-dist FAILED:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`\nverify-dist passed: all ${pkgs.length} built bundles load cleanly.`);
}

main().catch((err) => {
  console.error('verify-dist crashed:', err);
  process.exit(1);
});
