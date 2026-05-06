/**
 * Discover OTAIP agents by walking the workspace source tree.
 *
 * Filesystem-only and synchronous — no agent code is executed and no
 * transitive dependencies are loaded. Each agent's own exported `id`,
 * `name`, and `version` constants are the source of truth.
 *
 * Lives in `@otaip/core` so both the CLI (`packages/cli`) and the OTA
 * server (`examples/ota`) can call it without duplicating the logic.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DiscoveredAgent {
  id: string;
  name: string;
  stage: string;
  version: string;
  /** Path relative to the repo root for traceability. */
  source_path: string;
  /** Derived from version: '0.0.0' → 'stub', anything else → 'active'. */
  contract_status: 'active' | 'stub';
}

interface AgentRoot {
  /** Path under the repo root that contains agent subdirectories. */
  path: string;
  /** Stage name for everything under this root. */
  stage: string;
}

/**
 * Resolve the repo root from this module's URL. Works in both:
 *   - dev (tsx): packages/core/src/discovery/agent-discovery.ts
 *   - built (tsup): packages/core/dist/discovery/agent-discovery.js
 *
 * Walks up until it finds the workspace `pnpm-workspace.yaml`. Falls back
 * to the four-up parent so a missing marker file does not crash.
 */
function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let cur = here;
  for (let i = 0; i < 8; i++) {
    try {
      statSync(join(cur, 'pnpm-workspace.yaml'));
      return cur;
    } catch {
      // not here, walk up
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return resolve(here, '..', '..', '..', '..');
}

/**
 * Roots to walk. Each entry maps either:
 *   - a single stage path: `packages/agents-platform/src` (stage 'platform')
 *   - or a parent path holding stage subdirs: `packages/agents`
 *
 * For the parent-form, every immediate subdir under it becomes its own
 * stage and is scanned at `<stage>/src/<agent>/index.ts`.
 */
const STAGE_ROOTS: ReadonlyArray<AgentRoot> = [
  { path: 'packages/agents-platform/src', stage: 'platform' },
  { path: 'packages/agents-tmc/src', stage: 'tmc' },
  // OfferEvaluator (1.9) lives in @otaip/core for circular-dep reasons.
  { path: 'packages/core/src/agents/shopping', stage: 'core' },
];

const NESTED_STAGE_ROOT = 'packages/agents';

const ID_RE = /readonly\s+id\s*=\s*['"]([^'"]+)['"]/;
const NAME_RE = /readonly\s+name\s*=\s*['"]([^'"]+)['"]/;
const VERSION_RE = /readonly\s+version\s*=\s*['"]([^'"]+)['"]/;

function safeListDirs(p: string): string[] {
  try {
    return readdirSync(p)
      .filter((entry) => {
        try {
          return statSync(join(p, entry)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

function readAgentMetadata(indexPath: string): { id: string; name: string; version: string } | null {
  let src: string;
  try {
    src = readFileSync(indexPath, 'utf8');
  } catch {
    return null;
  }
  const idMatch = ID_RE.exec(src);
  const nameMatch = NAME_RE.exec(src);
  const versionMatch = VERSION_RE.exec(src);
  if (!idMatch || !nameMatch || !versionMatch) return null;
  return { id: idMatch[1]!, name: nameMatch[1]!, version: versionMatch[1]! };
}

function scanStageRoot(root: AgentRoot, repo: string): DiscoveredAgent[] {
  const stageDir = join(repo, root.path);
  const out: DiscoveredAgent[] = [];
  for (const agentDir of safeListDirs(stageDir)) {
    if (agentDir.startsWith('__')) continue; // skip __tests__ etc.
    const indexPath = join(stageDir, agentDir, 'index.ts');
    const meta = readAgentMetadata(indexPath);
    if (!meta) continue;
    out.push({
      id: meta.id,
      name: meta.name,
      stage: root.stage,
      version: meta.version,
      source_path: `${root.path}/${agentDir}/index.ts`,
      contract_status: meta.version === '0.0.0' ? 'stub' : 'active',
    });
  }
  return out;
}

function scanNestedRoots(repo: string): DiscoveredAgent[] {
  const parent = join(repo, NESTED_STAGE_ROOT);
  const out: DiscoveredAgent[] = [];
  for (const stageName of safeListDirs(parent)) {
    out.push(
      ...scanStageRoot(
        { path: `${NESTED_STAGE_ROOT}/${stageName}/src`, stage: stageName },
        repo,
      ),
    );
  }
  return out;
}

/**
 * Compare agent IDs as dotted-version sequences (so '2.10' sorts after
 * '2.2'). Falls back to lexical comparison when components are equal.
 */
function compareAgentIds(a: string, b: string): number {
  const partsA = a.split('.').map((n) => Number(n));
  const partsB = b.split('.').map((n) => Number(n));
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const x = partsA[i] ?? 0;
    const y = partsB[i] ?? 0;
    if (x !== y) return x - y;
  }
  return a.localeCompare(b);
}

export function discoverAgents(): DiscoveredAgent[] {
  const repo = repoRoot();
  const found = [...scanNestedRoots(repo), ...STAGE_ROOTS.flatMap((r) => scanStageRoot(r, repo))];
  return found.sort((a, b) => compareAgentIds(a.id, b.id));
}
