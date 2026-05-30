#!/usr/bin/env tsx
/**
 * Generate `agents.manifest.json` — the single authoritative roster.
 *
 * OTAIP historically had four overlapping notions of "which agents exist":
 *   - `discoverAgents()` (filesystem walk, all 75)
 *   - `scripts/count-agents.ts` (counts, derived from discovery)
 *   - `docs/agents.md` (hand-maintained table)
 *   - the per-package `AgentContract` registry (the ~18 contracted agents)
 *
 * This script collapses them into one generated file. For each discovered
 * agent it records identity + stage + version + whether it has a pipeline
 * contract, and for contracted agents the action type, description, and the
 * input/output JSON Schemas (from the SAME `zodToJsonSchema` the tool catalog
 * uses). `has_contract` makes the two-tier model first-class and queryable —
 * the honest answer to "why can't I describe/eval every agent": some agents
 * have contracts and some don't, and now that's machine-readable instead of
 * inferred.
 *
 * Requires a prior build (contracts import `@otaip/core`, which resolves to
 * its built `dist`). CI runs this after `pnpm -r run build` and fails if the
 * committed manifest is stale (see the freshness check in CI).
 *
 * Usage:
 *   pnpm gen:manifest            # write agents.manifest.json
 *   pnpm gen:manifest --check    # exit 1 if the file would change (CI)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Import from core SOURCE (not the `@otaip/core` specifier): this script runs
// from the repo root, which is not a package that depends on `@otaip/core`, so
// the bare specifier doesn't resolve here. Contracts loaded below DO use the
// specifier — that resolves correctly relative to each agent package.
import {
  type JSONSchema,
  zodToJsonSchema,
} from '../packages/core/src/pipeline-validator/schema-bridge.js';
import type { AgentContract } from '../packages/core/src/pipeline-validator/types.js';
import {
  type DiscoveredAgent,
  discoverAgents,
} from '../packages/core/src/discovery/agent-discovery.js';

const MANIFEST_PATH = 'agents.manifest.json';

interface ManifestAgent {
  readonly id: string;
  readonly name: string;
  readonly stage: string;
  readonly version: string;
  readonly contract_status: 'active' | 'stub';
  readonly has_contract: boolean;
  readonly source_path: string;
  readonly action_type?: string;
  readonly description?: string;
  readonly input_schema?: JSONSchema;
  readonly output_schema?: JSONSchema;
}

interface Manifest {
  readonly generated_by: string;
  readonly total: number;
  readonly with_contract: number;
  readonly agents: readonly ManifestAgent[];
}

function repoRoot(): string {
  let cur = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(cur, 'pnpm-workspace.yaml'))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/** A contract is any exported object carrying the AgentContract shape. */
function isAgentContract(value: unknown): value is AgentContract {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['agentId'] === 'string' &&
    typeof v['actionType'] === 'string' &&
    v['inputSchema'] !== undefined &&
    v['outputSchema'] !== undefined
  );
}

/**
 * Load the contract co-located with an agent (sibling `contract.ts`), if any.
 * Returns null when the agent has no contract file. Throws (fail loud) when a
 * contract file exists but can't be imported or doesn't match the agent id.
 */
async function loadContract(
  repo: string,
  agent: DiscoveredAgent,
): Promise<AgentContract | null> {
  const contractPath = join(repo, dirname(agent.source_path), 'contract.ts');
  if (!existsSync(contractPath)) return null;
  const mod = (await import(pathToFileURL(contractPath).href)) as Record<string, unknown>;
  const contracts = Object.values(mod).filter(isAgentContract);
  const match = contracts.find((c) => c.agentId === agent.id) ?? contracts[0];
  if (!match) {
    throw new Error(
      `${contractPath} exists but exports no AgentContract (agent ${agent.id}).`,
    );
  }
  if (match.agentId !== agent.id) {
    throw new Error(
      `${contractPath}: contract agentId '${match.agentId}' does not match discovered agent id '${agent.id}'.`,
    );
  }
  return match;
}

async function buildManifest(): Promise<Manifest> {
  const repo = repoRoot();
  const agents = discoverAgents();
  const entries: ManifestAgent[] = [];

  for (const agent of agents) {
    const contract = await loadContract(repo, agent);
    const base: ManifestAgent = {
      id: agent.id,
      name: agent.name,
      stage: agent.stage,
      version: agent.version,
      contract_status: agent.contract_status,
      has_contract: contract !== null,
      source_path: agent.source_path,
    };
    if (contract === null) {
      entries.push(base);
      continue;
    }
    entries.push({
      ...base,
      action_type: contract.actionType,
      ...(contract.description ? { description: contract.description } : {}),
      input_schema: zodToJsonSchema(contract.inputSchema),
      output_schema: zodToJsonSchema(contract.outputSchema),
    });
  }

  return {
    generated_by: 'scripts/generate-manifest.ts',
    total: entries.length,
    with_contract: entries.filter((a) => a.has_contract).length,
    agents: entries,
  };
}

async function main(): Promise<void> {
  const repo = repoRoot();
  const outPath = join(repo, MANIFEST_PATH);
  const manifest = await buildManifest();
  const json = JSON.stringify(manifest, null, 2) + '\n';

  if (process.argv.includes('--check')) {
    const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
    if (current !== json) {
      console.error(
        `${MANIFEST_PATH} is stale. Run \`pnpm gen:manifest\` and commit the result.`,
      );
      process.exit(1);
    }
    console.log(`${MANIFEST_PATH} is up to date (${manifest.total} agents, ${manifest.with_contract} contracted).`);
    return;
  }

  writeFileSync(outPath, json);
  console.log(
    `Wrote ${MANIFEST_PATH}: ${manifest.total} agents, ${manifest.with_contract} with contracts.`,
  );
}

main().catch((err) => {
  console.error('generate-manifest failed:', err);
  process.exit(1);
});
