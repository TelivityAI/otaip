#!/usr/bin/env tsx
/**
 * Render `docs/agent-map.html` from an AgentGraph.
 *
 * Callable standalone (`pnpm gen:agent-map`) or from `generate-manifest.ts`
 * so CI `--check` keeps the HTML in sync with the graph.
 *
 * Self-contained: no external JS/CSS. Stage columns + SVG workflow arcs.
 * Not a domain knowledge graph — agent navigation only.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentGraph, AgentGraphNode } from './agent-graph.js';

const GRAPH_PATH = 'agents.graph.json';
const MAP_HTML_PATH = 'docs/agent-map.html';

/** Display order for stage columns. Unknown stages append alphabetically. */
const STAGE_ORDER = [
  'reference',
  'search',
  'pricing',
  'booking',
  'ticketing',
  'exchange',
  'settlement',
  'reconciliation',
  'tmc',
  'platform',
  'core',
  'lodging',
] as const;

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

function compareAgentIds(a: string, b: string): number {
  const [aMajor = 0, aMinor = 0] = a.split('.').map(Number);
  const [bMajor = 0, bMinor = 0] = b.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor || a.localeCompare(b);
}

function stageSortKey(stage: string): number {
  const idx = (STAGE_ORDER as readonly string[]).indexOf(stage);
  return idx === -1 ? 1000 : idx;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function groupByStage(nodes: readonly AgentGraphNode[]): Array<[string, AgentGraphNode[]]> {
  const map = new Map<string, AgentGraphNode[]>();
  for (const n of nodes) {
    const list = map.get(n.stage) ?? [];
    list.push(n);
    map.set(n.stage, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => compareAgentIds(a.id, b.id));
  }
  return [...map.entries()].sort(([a], [b]) => stageSortKey(a) - stageSortKey(b) || a.localeCompare(b));
}

/**
 * Build a standalone HTML page that embeds the graph JSON and renders
 * stage columns with interactive selection.
 */
export function renderAgentMapHtml(graph: AgentGraph): string {
  const stages = groupByStage(graph.nodes);
  const columnsHtml = stages
    .map(([stage, agents]) => {
      const cards = agents
        .map((a) => {
          const status = a.contract_status === 'active' ? 'active' : 'stub';
          const contract = a.has_contract ? 'contracted' : 'no-contract';
          return `        <button type="button" class="node ${status} ${contract}" data-id="${escapeHtml(a.id)}" title="${escapeHtml(a.name)}">
          <span class="id">${escapeHtml(a.id)}</span>
          <span class="name">${escapeHtml(a.name)}</span>
        </button>`;
        })
        .join('\n');
      return `      <section class="stage" data-stage="${escapeHtml(stage)}">
        <h2>${escapeHtml(stage)} <span class="count">${agents.length}</span></h2>
        <div class="nodes">
${cards}
        </div>
      </section>`;
    })
    .join('\n');

  const payload = JSON.stringify(graph);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Otaip Agent Map · Telivity</title>
  <meta name="description" content="Telivity Otaip — visual map of travel AI agents across search, price, book, ticket, and settle." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #020617;
      --ink: #f1f5f9;
      --muted: #94a3b8;
      --line: #1e293b;
      --panel: #0f172a;
      --panel-2: #020617;
      --active: #06b6d4;
      --stub: #64748b;
      --workflow: #22d3ee;
      --pkg: #475569;
      --hl: #22d3ee;
      --brand: #22d3ee;
      --cta: #06b6d4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", system-ui, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(900px 480px at 8% -8%, rgba(6, 182, 212, 0.18) 0%, transparent 55%),
        radial-gradient(700px 420px at 100% 0%, rgba(34, 211, 238, 0.08) 0%, transparent 50%),
        var(--bg);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    header {
      padding: 1.5rem 1.75rem 0.75rem;
      max-width: 1400px;
      margin: 0 auto;
    }
    .brand {
      margin: 0 0 0.65rem;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--brand);
    }
    .brand a {
      color: inherit;
      text-decoration: none;
    }
    .brand a:hover { text-decoration: underline; }
    header h1 {
      margin: 0;
      font-family: "Space Grotesk", system-ui, sans-serif;
      font-weight: 700;
      font-size: clamp(1.75rem, 3vw, 2.35rem);
      letter-spacing: -0.03em;
      line-height: 1.1;
    }
    header h1 span { color: var(--brand); }
    header p {
      margin: 0.65rem 0 0;
      color: var(--muted);
      font-size: 0.95rem;
      max-width: 46rem;
      line-height: 1.5;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      padding: 0.75rem 1.75rem 1rem;
      max-width: 1400px;
      margin: 0 auto;
    }
    .toolbar input, .toolbar select {
      border: 1px solid #334155;
      background: var(--panel-2);
      color: var(--ink);
      border-radius: 8px;
      padding: 0.45rem 0.65rem;
      font: inherit;
      font-size: 0.875rem;
    }
    .toolbar input::placeholder { color: #64748b; }
    .toolbar input:focus, .toolbar select:focus {
      outline: none;
      border-color: var(--cta);
    }
    .toolbar select option { background: #0f172a; color: var(--ink); }
    .toolbar input { min-width: 12rem; }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.85rem;
      margin-left: auto;
      font-size: 0.75rem;
      color: var(--muted);
    }
    .legend span::before {
      content: "";
      display: inline-block;
      width: 0.65rem;
      height: 0.65rem;
      border-radius: 2px;
      margin-right: 0.3rem;
      vertical-align: -1px;
    }
    .legend .l-active::before { background: var(--active); }
    .legend .l-stub::before { background: var(--stub); }
    .legend .l-wf::before { background: var(--workflow); }
    .legend .l-pkg::before { background: var(--pkg); border: 1px dashed #94a3b8; }
    .layout {
      display: grid;
      grid-template-columns: 1fr minmax(14rem, 18rem);
      gap: 1rem;
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 1.75rem 2rem;
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
    }
    .board-wrap {
      position: relative;
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.72);
      min-height: 28rem;
    }
    .board {
      display: flex;
      gap: 0.75rem;
      padding: 1rem;
      min-width: max-content;
      position: relative;
      z-index: 1;
    }
    .stage {
      width: 11.5rem;
      flex: 0 0 auto;
    }
    .stage h2 {
      margin: 0 0 0.5rem;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #64748b;
      font-weight: 600;
    }
    .stage .count {
      font-weight: 500;
      color: var(--brand);
      opacity: 0.85;
    }
    .nodes { display: flex; flex-direction: column; gap: 0.35rem; }
    .node {
      text-align: left;
      border: 1px solid #334155;
      background: #020617;
      border-radius: 8px;
      padding: 0.45rem 0.55rem;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      transition: border-color 0.15s, box-shadow 0.15s, opacity 0.15s;
      color: inherit;
    }
    .node .id {
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 0.7rem;
      color: #64748b;
    }
    .node .name {
      font-size: 0.78rem;
      line-height: 1.25;
      color: #e2e8f0;
      font-weight: 500;
    }
    .node.active { border-left: 3px solid var(--active); }
    .node.stub { border-left: 3px solid var(--stub); opacity: 0.8; }
    .node.selected, .node:hover {
      border-color: var(--hl);
      box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.55);
    }
    .node.on-path {
      border-color: var(--workflow);
      box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.45);
    }
    .node.dim { opacity: 0.28; }
    svg.edges {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 0;
      overflow: visible;
    }
    svg.edges path.workflow { fill: none; stroke: var(--workflow); stroke-width: 1.5; opacity: 0.55; }
    svg.edges path.package { fill: none; stroke: var(--pkg); stroke-width: 1; stroke-dasharray: 4 3; opacity: 0.4; }
    svg.edges path.hl { opacity: 1; stroke-width: 2.25; }
    .detail {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.85);
      padding: 1rem;
      align-self: start;
      position: sticky;
      top: 1rem;
    }
    .detail h3 {
      margin: 0 0 0.5rem;
      font-family: "Space Grotesk", system-ui, sans-serif;
      font-size: 1.05rem;
      font-weight: 600;
    }
    .detail dl { margin: 0; display: grid; grid-template-columns: 5.5rem 1fr; gap: 0.35rem 0.5rem; font-size: 0.8rem; }
    .detail dt { color: var(--muted); }
    .detail dd { margin: 0; word-break: break-word; color: #e2e8f0; }
    .detail .empty { color: var(--muted); font-size: 0.85rem; }
    .detail ul { margin: 0.5rem 0 0; padding-left: 1.1rem; font-size: 0.8rem; color: #cbd5e1; }
    .detail code {
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 0.72rem;
      color: var(--brand);
    }
    .note {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 1.75rem 2rem;
      font-size: 0.75rem;
      color: #64748b;
    }
    .note a { color: var(--brand); text-decoration: none; }
    .note a:hover { text-decoration: underline; }
    .note code {
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <header>
    <p class="brand"><a href="https://telivity.app">Telivity</a> · Otaip</p>
    <h1>Agent Map for the <span>whole travel transaction</span></h1>
    <p>
      Every discovered Otaip agent by stage. Solid cyan arcs are Orchestrator
      workflow steps; dashed arcs are package workspace dependencies.
      Navigation only — not a travel-domain knowledge graph.
    </p>
  </header>
  <div class="toolbar">
    <input id="search" type="search" placeholder="Search id or name…" />
    <select id="stage">
      <option value="all">All stages</option>
    </select>
    <select id="status">
      <option value="all">All status</option>
      <option value="active">Active</option>
      <option value="stub">Stub</option>
    </select>
    <select id="workflow">
      <option value="all">All workflows</option>
    </select>
    <div class="legend">
      <span class="l-active">Active</span>
      <span class="l-stub">Stub</span>
      <span class="l-wf">Workflow</span>
      <span class="l-pkg">Package dep</span>
    </div>
  </div>
  <div class="layout">
    <div class="board-wrap" id="board-wrap">
      <svg class="edges" id="edges" aria-hidden="true"></svg>
      <div class="board" id="board">
${columnsHtml}
      </div>
    </div>
    <aside class="detail" id="detail">
      <p class="empty">Select an agent to see details and connected workflows.</p>
    </aside>
  </div>
  <p class="note">
    <a href="https://telivity.app">Telivity</a> · Powered by Otaip.
    Generated by <code>pnpm gen:manifest</code> from <code>agents.graph.json</code>
    (${graph.total_nodes} agents, ${graph.total_edges} edges). Do not hand-edit.
  </p>
  <script id="graph-data" type="application/json">${payload.replace(/</g, '\\u003c')}</script>
  <script>
    const graph = JSON.parse(document.getElementById('graph-data').textContent);
    const board = document.getElementById('board');
    const boardWrap = document.getElementById('board-wrap');
    const edgesSvg = document.getElementById('edges');
    const detail = document.getElementById('detail');
    const searchEl = document.getElementById('search');
    const stageEl = document.getElementById('stage');
    const statusEl = document.getElementById('status');
    const workflowEl = document.getElementById('workflow');

    const nodesById = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
    const workflows = [...new Set(graph.edges.filter(e => e.kind === 'workflow').map(e => e.label))].sort();
    for (const s of [...new Set(graph.nodes.map(n => n.stage))].sort()) {
      const o = document.createElement('option');
      o.value = s; o.textContent = s; stageEl.appendChild(o);
    }
    for (const w of workflows) {
      const o = document.createElement('option');
      o.value = w; o.textContent = w; workflowEl.appendChild(o);
    }

    let selected = null;

    function workflowsFor(id) {
      const set = new Set();
      for (const e of graph.edges) {
        if (e.kind === 'workflow' && (e.source === id || e.target === id)) set.add(e.label);
      }
      return [...set].sort();
    }

    function pathIdsForWorkflow(name) {
      if (name === 'all') return null;
      const ids = new Set();
      for (const e of graph.edges) {
        if (e.kind === 'workflow' && e.label === name) {
          ids.add(e.source); ids.add(e.target);
        }
      }
      return ids;
    }

    function applyFilters() {
      const q = searchEl.value.trim().toLowerCase();
      const stage = stageEl.value;
      const status = statusEl.value;
      const wf = workflowEl.value;
      const pathIds = pathIdsForWorkflow(wf);
      for (const btn of board.querySelectorAll('.node')) {
        const n = nodesById[btn.dataset.id];
        let show = true;
        if (stage !== 'all' && n.stage !== stage) show = false;
        if (status !== 'all' && n.contract_status !== status) show = false;
        if (q && !(n.id.includes(q) || n.name.toLowerCase().includes(q))) show = false;
        if (pathIds && !pathIds.has(n.id)) show = false;
        btn.style.display = show ? '' : 'none';
        btn.classList.toggle('on-path', Boolean(pathIds && pathIds.has(n.id)));
        btn.classList.toggle('dim', Boolean(selected) && selected !== n.id && !isNeighbor(selected, n.id));
        btn.classList.toggle('selected', selected === n.id);
      }
      drawEdges();
    }

    function isNeighbor(id, other) {
      return graph.edges.some(e =>
        (e.source === id && e.target === other) || (e.target === id && e.source === other)
      );
    }

    function showDetail(id) {
      const n = nodesById[id];
      if (!n) {
        detail.innerHTML = '<p class="empty">Select an agent to see details and connected workflows.</p>';
        return;
      }
      const wfs = workflowsFor(id);
      detail.innerHTML = \`
        <h3>\${escape(n.name)}</h3>
        <dl>
          <dt>ID</dt><dd><code>\${escape(n.id)}</code></dd>
          <dt>Stage</dt><dd>\${escape(n.stage)}</dd>
          <dt>Version</dt><dd>\${escape(n.version)}</dd>
          <dt>Status</dt><dd>\${escape(n.contract_status)}</dd>
          <dt>Contract</dt><dd>\${n.has_contract ? 'yes' : 'no'}</dd>
          <dt>Source</dt><dd><code>\${escape(n.source_path)}</code></dd>
        </dl>
        <p style="margin:0.75rem 0 0;font-size:0.75rem;color:var(--muted)">Workflows</p>
        \${wfs.length ? '<ul>' + wfs.map(w => '<li>' + escape(w) + '</li>').join('') + '</ul>' : '<p class="empty">Not in a built-in workflow.</p>'}
      \`;
    }

    function escape(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function nodeCenter(id) {
      const el = board.querySelector('.node[data-id="' + CSS.escape(id) + '"]');
      if (!el || el.style.display === 'none') return null;
      const a = el.getBoundingClientRect();
      const b = boardWrap.getBoundingClientRect();
      return {
        x: a.left - b.left + boardWrap.scrollLeft + a.width / 2,
        y: a.top - b.top + boardWrap.scrollTop + a.height / 2,
      };
    }

    function drawEdges() {
      const wfFilter = workflowEl.value;
      const w = boardWrap.scrollWidth;
      const h = Math.max(boardWrap.clientHeight, board.scrollHeight);
      edgesSvg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      edgesSvg.style.width = w + 'px';
      edgesSvg.style.height = h + 'px';
      const parts = [];
      for (const e of graph.edges) {
        if (e.kind === 'workflow' && wfFilter !== 'all' && e.label !== wfFilter) continue;
        if (e.kind === 'package' && wfFilter !== 'all') continue;
        const a = nodeCenter(e.source);
        const b = nodeCenter(e.target);
        if (!a || !b) continue;
        const dx = Math.max(40, Math.abs(b.x - a.x) * 0.35);
        const d = 'M ' + a.x + ' ' + a.y + ' C ' + (a.x + dx) + ' ' + a.y + ', ' + (b.x - dx) + ' ' + b.y + ', ' + b.x + ' ' + b.y;
        const hl = selected && (e.source === selected || e.target === selected);
        parts.push('<path class="' + e.kind + (hl ? ' hl' : '') + '" d="' + d + '" />');
      }
      edgesSvg.innerHTML = parts.join('');
    }

    board.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.node');
      if (!btn) return;
      selected = btn.dataset.id;
      showDetail(selected);
      applyFilters();
    });
    searchEl.addEventListener('input', applyFilters);
    stageEl.addEventListener('change', applyFilters);
    statusEl.addEventListener('change', applyFilters);
    workflowEl.addEventListener('change', applyFilters);
    boardWrap.addEventListener('scroll', drawEdges);
    window.addEventListener('resize', drawEdges);
    applyFilters();
  </script>
</body>
</html>
`;
}

function main(): void {
  const repo = repoRoot();
  const graphPath = join(repo, GRAPH_PATH);
  if (!existsSync(graphPath)) {
    console.error(`${GRAPH_PATH} missing. Run \`pnpm gen:manifest\` first.`);
    process.exit(1);
  }
  const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as AgentGraph;
  const html = renderAgentMapHtml(graph);
  const out = join(repo, MAP_HTML_PATH);
  writeFileSync(out, html);
  console.log(`Wrote ${MAP_HTML_PATH} (${graph.total_nodes} agents).`);
}

// Only run as CLI when invoked directly (not when imported by generate-manifest).
const isDirect =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  main();
}
