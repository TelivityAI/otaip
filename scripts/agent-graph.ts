/**
 * Shared agent-graph builders used by `generate-manifest.ts` and
 * `generate-agent-map-html.ts`.
 *
 * Nodes come from the agent manifest. Edges are explicit only:
 *   - workflow: consecutive steps in Orchestrator WORKFLOW_PIPELINES
 *   - package: stage-hub links derived from workspace package.json deps
 *
 * This is NOT a domain knowledge graph and not Graphify — it maps OTAIP
 * agents for navigation only.
 */

import { WORKFLOW_PIPELINES } from '../packages/agents-platform/src/orchestrator/workflows.js';

export interface AgentGraphNode {
  readonly id: string;
  readonly name: string;
  readonly stage: string;
  readonly version: string;
  readonly contract_status: 'active' | 'stub';
  readonly has_contract: boolean;
  readonly source_path: string;
}

export interface AgentGraphEdge {
  readonly source: string;
  readonly target: string;
  readonly kind: 'workflow' | 'package';
  readonly label: string;
}

export interface PackageDep {
  readonly from_package: string;
  readonly to_package: string;
  readonly from_stage: string;
  readonly to_stage: string;
}

export interface AgentGraph {
  readonly generated_by: string;
  readonly total_nodes: number;
  readonly total_edges: number;
  readonly nodes: readonly AgentGraphNode[];
  readonly edges: readonly AgentGraphEdge[];
  readonly package_deps: readonly PackageDep[];
}

/** npm package name → discovery stage name. */
export const PACKAGE_TO_STAGE: Readonly<Record<string, string>> = {
  '@otaip/agents-reference': 'reference',
  '@otaip/agents-search': 'search',
  '@otaip/agents-pricing': 'pricing',
  '@otaip/agents-booking': 'booking',
  '@otaip/agents-ticketing': 'ticketing',
  '@otaip/agents-exchange': 'exchange',
  '@otaip/agents-settlement': 'settlement',
  '@otaip/agents-reconciliation': 'reconciliation',
  '@otaip/agents-lodging': 'lodging',
  '@otaip/agents-platform': 'platform',
  '@otaip/agents-tmc': 'tmc',
};

/**
 * Workspace agent-package dependencies (mirrors package.json files).
 * Kept here as a table so graph generation does not need to re-read every
 * package.json; update when agent package deps change.
 */
export const AGENT_PACKAGE_DEPS: ReadonlyArray<{ from: string; to: string }> = [
  { from: '@otaip/agents-search', to: '@otaip/agents-reference' },
  { from: '@otaip/agents-pricing', to: '@otaip/agents-reference' },
  { from: '@otaip/agents-booking', to: '@otaip/agents-reference' },
  { from: '@otaip/agents-booking', to: '@otaip/agents-search' },
  { from: '@otaip/agents-booking', to: '@otaip/agents-pricing' },
  { from: '@otaip/agents-ticketing', to: '@otaip/agents-booking' },
  { from: '@otaip/agents-exchange', to: '@otaip/agents-search' },
  { from: '@otaip/agents-exchange', to: '@otaip/agents-ticketing' },
  { from: '@otaip/agents-settlement', to: '@otaip/agents-ticketing' },
  { from: '@otaip/agents-reconciliation', to: '@otaip/agents-reference' },
];

export interface ManifestAgentLike {
  readonly id: string;
  readonly name: string;
  readonly stage: string;
  readonly version: string;
  readonly contract_status: 'active' | 'stub';
  readonly has_contract: boolean;
  readonly source_path: string;
}

function compareAgentIds(a: string, b: string): number {
  const [aMajor = 0, aMinor = 0] = a.split('.').map(Number);
  const [bMajor = 0, bMinor = 0] = b.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor || a.localeCompare(b);
}

function stageHubId(
  nodesByStage: Map<string, AgentGraphNode[]>,
  stage: string,
): string | undefined {
  const list = nodesByStage.get(stage);
  if (!list || list.length === 0) return undefined;
  return [...list].sort((a, b) => compareAgentIds(a.id, b.id))[0]?.id;
}

export function buildAgentGraph(agents: readonly ManifestAgentLike[]): AgentGraph {
  const nodes: AgentGraphNode[] = agents.map((a) => ({
    id: a.id,
    name: a.name,
    stage: a.stage,
    version: a.version,
    contract_status: a.contract_status,
    has_contract: a.has_contract,
    source_path: a.source_path,
  }));

  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodesByStage = new Map<string, AgentGraphNode[]>();
  for (const n of nodes) {
    const list = nodesByStage.get(n.stage) ?? [];
    list.push(n);
    nodesByStage.set(n.stage, list);
  }

  const edges: AgentGraphEdge[] = [];
  const seen = new Set<string>();

  const pushEdge = (edge: AgentGraphEdge): void => {
    const key = `${edge.kind}|${edge.source}|${edge.target}|${edge.label}`;
    if (seen.has(key)) return;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
    seen.add(key);
    edges.push(edge);
  };

  for (const [workflow, pipeline] of Object.entries(WORKFLOW_PIPELINES)) {
    for (let i = 0; i < pipeline.length - 1; i++) {
      const source = pipeline[i]!;
      const target = pipeline[i + 1]!;
      pushEdge({ source, target, kind: 'workflow', label: workflow });
    }
  }

  const package_deps: PackageDep[] = [];
  for (const dep of AGENT_PACKAGE_DEPS) {
    const from_stage = PACKAGE_TO_STAGE[dep.from];
    const to_stage = PACKAGE_TO_STAGE[dep.to];
    if (!from_stage || !to_stage) continue;
    package_deps.push({
      from_package: dep.from,
      to_package: dep.to,
      from_stage,
      to_stage,
    });
    const source = stageHubId(nodesByStage, from_stage);
    const target = stageHubId(nodesByStage, to_stage);
    if (!source || !target) continue;
    pushEdge({
      source,
      target,
      kind: 'package',
      label: `${dep.from} → ${dep.to}`,
    });
  }

  return {
    generated_by: 'scripts/generate-manifest.ts',
    total_nodes: nodes.length,
    total_edges: edges.length,
    nodes: [...nodes].sort((a, b) => compareAgentIds(a.id, b.id)),
    edges,
    package_deps,
  };
}
