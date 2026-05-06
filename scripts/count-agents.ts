#!/usr/bin/env tsx
/**
 * Single source of truth for the agent count + per-stage breakdown.
 *
 * Walks the workspace exactly the same way the CLI does — `discoverAgents`
 * lives in `@otaip/core` since v0.7.1, with the CLI re-exporting it.
 * README claims, docs counts, and the release-notes pipeline all read
 * from this script so they cannot drift apart.
 *
 * Usage:
 *   pnpm tsx scripts/count-agents.ts            # plain text
 *   pnpm tsx scripts/count-agents.ts --json     # machine-readable
 *
 * Imports the helper directly from its source path rather than through
 * the `@otaip/core` package specifier. The Release workflow's "Count
 * agents" step runs before any build, so a bare `import from '@otaip/core'`
 * fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` when `dist/index.js` doesn't
 * yet exist on the runner.
 */

import { discoverAgents } from '../packages/core/src/discovery/agent-discovery.js';

interface Counts {
  total: number;
  stages: number;
  by_stage: Record<string, number>;
}

function tally(): Counts {
  const agents = discoverAgents();
  const by_stage: Record<string, number> = {};
  for (const a of agents) {
    by_stage[a.stage] = (by_stage[a.stage] ?? 0) + 1;
  }
  return {
    total: agents.length,
    stages: Object.keys(by_stage).length,
    by_stage,
  };
}

function printJson(counts: Counts): void {
  console.log(JSON.stringify(counts, null, 2));
}

function printText(counts: Counts): void {
  console.log(`Total agents: ${counts.total}`);
  console.log(`Stages:       ${counts.stages}`);
  console.log('');
  for (const [stage, n] of Object.entries(counts.by_stage).sort()) {
    console.log(`  ${stage.padEnd(20)} ${n}`);
  }
}

const counts = tally();
if (process.argv.includes('--json')) {
  printJson(counts);
} else {
  printText(counts);
}
