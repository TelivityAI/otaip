import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentGraph, AgentGraphNode } from '../api/types';

interface AgentMapProps {
  graph: AgentGraph;
}

type StatusFilter = 'all' | 'active' | 'stub';

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

function compareIds(a: string, b: string): number {
  const [aMajor = 0, aMinor = 0] = a.split('.').map(Number);
  const [bMajor = 0, bMinor = 0] = b.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor || a.localeCompare(b);
}

function stageKey(stage: string): number {
  const idx = (STAGE_ORDER as readonly string[]).indexOf(stage);
  return idx === -1 ? 1000 : idx;
}

export default function AgentMap({ graph }: AgentMapProps) {
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [workflow, setWorkflow] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<Array<{ d: string; kind: string; hl: boolean }>>([]);
  const [svgSize, setSvgSize] = useState({ w: 1, h: 1 });

  const stages = useMemo(() => {
    const set = new Set(graph.nodes.map((n) => n.stage));
    return ['all', ...[...set].sort((a, b) => stageKey(a) - stageKey(b) || a.localeCompare(b))];
  }, [graph.nodes]);

  const workflows = useMemo(() => {
    const set = new Set(
      graph.edges.filter((e) => e.kind === 'workflow').map((e) => e.label),
    );
    return ['all', ...[...set].sort()];
  }, [graph.edges]);

  const nodesById = useMemo(() => {
    const m = new Map<string, AgentGraphNode>();
    for (const n of graph.nodes) m.set(n.id, n);
    return m;
  }, [graph.nodes]);

  const workflowPathIds = useMemo(() => {
    if (workflow === 'all') return null;
    const ids = new Set<string>();
    for (const e of graph.edges) {
      if (e.kind === 'workflow' && e.label === workflow) {
        ids.add(e.source);
        ids.add(e.target);
      }
    }
    return ids;
  }, [graph.edges, workflow]);

  const visibleIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    const ids = new Set<string>();
    for (const n of graph.nodes) {
      if (stage !== 'all' && n.stage !== stage) continue;
      if (status !== 'all' && n.contract_status !== status) continue;
      if (q && !(n.id.includes(q) || n.name.toLowerCase().includes(q))) continue;
      if (workflowPathIds && !workflowPathIds.has(n.id)) continue;
      ids.add(n.id);
    }
    return ids;
  }, [graph.nodes, search, stage, status, workflowPathIds]);

  const columns = useMemo(() => {
    const map = new Map<string, AgentGraphNode[]>();
    for (const n of graph.nodes) {
      if (!visibleIds.has(n.id)) continue;
      const list = map.get(n.stage) ?? [];
      list.push(n);
      map.set(n.stage, list);
    }
    for (const list of map.values()) list.sort((a, b) => compareIds(a.id, b.id));
    return [...map.entries()].sort(([a], [b]) => stageKey(a) - stageKey(b) || a.localeCompare(b));
  }, [graph.nodes, visibleIds]);

  const selectedNode = selected ? nodesById.get(selected) ?? null : null;

  const selectedWorkflows = useMemo(() => {
    if (!selected) return [] as string[];
    const set = new Set<string>();
    for (const e of graph.edges) {
      if (e.kind === 'workflow' && (e.source === selected || e.target === selected)) {
        set.add(e.label);
      }
    }
    return [...set].sort();
  }, [graph.edges, selected]);

  const neighborIds = useMemo(() => {
    if (!selected) return new Set<string>();
    const set = new Set<string>();
    for (const e of graph.edges) {
      if (e.source === selected) set.add(e.target);
      if (e.target === selected) set.add(e.source);
    }
    return set;
  }, [graph.edges, selected]);

  useEffect(() => {
    function redraw() {
      const wrap = wrapRef.current;
      const board = boardRef.current;
      if (!wrap || !board) {
        setPaths([]);
        return;
      }
      const wrapBox = wrap.getBoundingClientRect();
      setSvgSize({
        w: Math.max(wrap.scrollWidth, 1),
        h: Math.max(wrap.clientHeight, board.scrollHeight, 1),
      });
      const centers = new Map<string, { x: number; y: number }>();
      for (const id of visibleIds) {
        const el = board.querySelector(`[data-agent-id="${CSS.escape(id)}"]`);
        if (!(el instanceof HTMLElement)) continue;
        const r = el.getBoundingClientRect();
        centers.set(id, {
          x: r.left - wrapBox.left + wrap.scrollLeft + r.width / 2,
          y: r.top - wrapBox.top + wrap.scrollTop + r.height / 2,
        });
      }
      const next: Array<{ d: string; kind: string; hl: boolean }> = [];
      for (const e of graph.edges) {
        if (e.kind === 'workflow' && workflow !== 'all' && e.label !== workflow) continue;
        if (e.kind === 'package' && workflow !== 'all') continue;
        if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) continue;
        const a = centers.get(e.source);
        const b = centers.get(e.target);
        if (!a || !b) continue;
        const dx = Math.max(40, Math.abs(b.x - a.x) * 0.35);
        const d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
        const hl = Boolean(selected && (e.source === selected || e.target === selected));
        next.push({ d, kind: e.kind, hl });
      }
      setPaths(next);
    }

    redraw();
    const wrap = wrapRef.current;
    wrap?.addEventListener('scroll', redraw);
    window.addEventListener('resize', redraw);
    return () => {
      wrap?.removeEventListener('scroll', redraw);
      window.removeEventListener('resize', redraw);
    };
  }, [graph.edges, visibleIds, workflow, selected, columns]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Agent Map</h2>
        <span className="text-xs text-slate-500">
          {visibleIds.size} of {graph.total_nodes} · {graph.total_edges} edges
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-44 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
          />
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            {stages.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All domains' : s}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="stub">Stub</option>
          </select>
          <select
            value={workflow}
            onChange={(e) => setWorkflow(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            {workflows.map((w) => (
              <option key={w} value={w}>
                {w === 'all' ? 'All workflows' : w}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_16rem]">
        <div ref={wrapRef} className="relative min-h-[28rem] overflow-x-auto border-b border-slate-100 lg:border-b-0 lg:border-r">
          <svg
            className="pointer-events-none absolute inset-0 z-0"
            width={svgSize.w}
            height={svgSize.h}
            viewBox={`0 0 ${svgSize.w} ${svgSize.h}`}
            aria-hidden
          >
            {paths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill="none"
                stroke={p.kind === 'workflow' ? '#06b6d4' : '#64748b'}
                strokeWidth={p.hl ? 2.25 : p.kind === 'workflow' ? 1.5 : 1}
                strokeDasharray={p.kind === 'package' ? '4 3' : undefined}
                opacity={p.hl ? 1 : p.kind === 'workflow' ? 0.55 : 0.35}
              />
            ))}
          </svg>
          <div ref={boardRef} className="relative z-10 flex min-w-max gap-3 p-4">
            {columns.length === 0 ? (
              <div className="px-2 py-8 text-sm text-slate-500">No agents match these filters.</div>
            ) : null}
            {columns.map(([colStage, agents]) => (
              <div key={colStage} className="w-44 flex-none">
                <h3 className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
                  {colStage} <span className="font-normal opacity-70">{agents.length}</span>
                </h3>
                <div className="flex flex-col gap-1.5">
                  {agents.map((a) => {
                    const isSelected = selected === a.id;
                    const dim = Boolean(selected) && !isSelected && !neighborIds.has(a.id);
                    const onPath = Boolean(workflowPathIds?.has(a.id));
                    return (
                      <button
                        key={a.id}
                        type="button"
                        data-agent-id={a.id}
                        onClick={() => setSelected(a.id)}
                        className={[
                          'rounded-md border bg-white px-2 py-1.5 text-left transition',
                          a.contract_status === 'active' ? 'border-l-[3px] border-l-cyan-500' : 'border-l-[3px] border-l-slate-400',
                          isSelected || onPath ? 'border-cyan-400 shadow-[0_0_0_1px_#22d3ee]' : 'border-slate-200',
                          dim ? 'opacity-30' : '',
                        ].join(' ')}
                      >
                        <div className="font-mono text-[0.65rem] text-slate-500">{a.id}</div>
                        <div className="text-xs leading-snug text-slate-900">{a.name}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className="p-4 text-sm">
          {!selectedNode ? (
            <p className="text-slate-500">Select an agent to see details and connected workflows.</p>
          ) : (
            <div className="space-y-3">
              <h3 className="font-semibold text-slate-900">{selectedNode.name}</h3>
              <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1.5 text-xs">
                <dt className="text-slate-500">ID</dt>
                <dd className="font-mono">{selectedNode.id}</dd>
                <dt className="text-slate-500">Stage</dt>
                <dd>{selectedNode.stage}</dd>
                <dt className="text-slate-500">Version</dt>
                <dd>{selectedNode.version}</dd>
                <dt className="text-slate-500">Status</dt>
                <dd>{selectedNode.contract_status}</dd>
                <dt className="text-slate-500">Contract</dt>
                <dd>{selectedNode.has_contract ? 'yes' : 'no'}</dd>
                <dt className="text-slate-500">Source</dt>
                <dd className="break-all font-mono text-[0.65rem]">{selectedNode.source_path}</dd>
              </dl>
              <div>
                <div className="mb-1 text-xs text-slate-500">Workflows</div>
                {selectedWorkflows.length === 0 ? (
                  <p className="text-xs text-slate-500">Not in a built-in workflow.</p>
                ) : (
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-800">
                    {selectedWorkflows.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          <p className="mt-6 text-[0.65rem] leading-relaxed text-slate-400">
            Solid arcs = orchestrator workflows. Dashed arcs = package workspace deps (stage hubs).
            Navigation only — not a domain knowledge graph.
          </p>
        </aside>
      </div>
    </section>
  );
}
