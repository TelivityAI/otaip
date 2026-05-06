import { useMemo, useState } from 'react';
import type { DiscoveredAgent } from '../api/types';
import Badge from './Badge';

interface AgentTableProps {
  agents: DiscoveredAgent[];
}

type StatusFilter = 'all' | 'active' | 'stub';
type SortKey = 'id' | 'name' | 'stage';

export default function AgentTable({ agents }: AgentTableProps) {
  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState<string>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('id');

  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) set.add(a.stage);
    return ['all', ...[...set].sort()];
  }, [agents]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents
      .filter((a) => (domain === 'all' ? true : a.stage === domain))
      .filter((a) => (status === 'all' ? true : a.contract_status === status))
      .filter((a) => (q ? a.name.toLowerCase().includes(q) || a.id.includes(q) : true))
      .sort((a, b) => {
        if (sortKey === 'name') return a.name.localeCompare(b.name);
        if (sortKey === 'stage') return a.stage.localeCompare(b.stage) || compareIds(a.id, b.id);
        return compareIds(a.id, b.id);
      });
  }, [agents, search, domain, status, sortKey]);

  // Group by stage for the collapsible view; preserves the active sort
  const grouped = useMemo(() => {
    const groups: Record<string, DiscoveredAgent[]> = {};
    for (const a of filtered) {
      (groups[a.stage] ??= []).push(a);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Agent Registry</h2>
        <span className="text-xs text-slate-500">
          {filtered.length} of {agents.length}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-44 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
          />
          <select
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            {domains.map((d) => (
              <option key={d} value={d}>
                {d === 'all' ? 'All domains' : d}
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
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="id">Sort: ID</option>
            <option value="name">Sort: Name</option>
            <option value="stage">Sort: Domain</option>
          </select>
        </div>
      </header>

      <div className="divide-y divide-slate-200">
        {grouped.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">No agents match these filters.</div>
        ) : null}
        {grouped.map(([stage, list]) => {
          const isCollapsed = Boolean(collapsed[stage]);
          return (
            <div key={stage}>
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [stage]: !c[stage] }))}
                className="flex w-full items-center justify-between bg-slate-50 px-5 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-600 hover:bg-slate-100"
              >
                <span>
                  {stage}
                  <span className="ml-2 text-slate-400 normal-case">({list.length})</span>
                </span>
                <span aria-hidden>{isCollapsed ? '+' : '–'}</span>
              </button>
              {isCollapsed ? null : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="w-20 px-5 py-2">ID</th>
                      <th className="px-5 py-2">Name</th>
                      <th className="w-28 px-5 py-2">Status</th>
                      <th className="w-24 px-5 py-2">Version</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((a) => (
                      <tr key={a.source_path} className="border-t border-slate-100">
                        <td className="px-5 py-2 font-mono text-slate-700">{a.id}</td>
                        <td className="px-5 py-2 text-slate-900">{a.name}</td>
                        <td className="px-5 py-2">
                          {a.contract_status === 'active' ? (
                            <Badge tone="green">Active</Badge>
                          ) : (
                            <Badge tone="amber">Stub</Badge>
                          )}
                        </td>
                        <td className="px-5 py-2 font-mono text-slate-500">{a.version}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function compareIds(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return a.localeCompare(b);
}
