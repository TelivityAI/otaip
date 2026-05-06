import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AdapterDescriptor, AgentRollup, HealthReport, PlatformStats } from '../api/types';
import StatCard from '../components/StatCard';
import AgentTable from '../components/AgentTable';
import AdapterCard from '../components/AdapterCard';
import HealthSidebar from '../components/HealthSidebar';

export default function Dashboard() {
  const [agents, setAgents] = useState<AgentRollup | null>(null);
  const [adapters, setAdapters] = useState<AdapterDescriptor[] | null>(null);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [a, ad, s, h] = await Promise.all([
          api.agents(),
          api.adapters(),
          api.stats(),
          api.health(),
        ]);
        if (cancelled) return;
        setAgents(a);
        setAdapters(ad.adapters);
        setStats(s);
        setHealth(h);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    // Refresh health on a slow interval; everything else stays stable
    const t = window.setInterval(() => {
      api.health().then((h) => !cancelled && setHealth(h)).catch(() => {});
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Operational overview of this OTAIP instance.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong className="font-semibold">Failed to load:</strong> {error}
          <div className="mt-1 text-xs text-red-700">
            Is the OTA server running on <code className="font-mono">localhost:3000</code>?
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total agents" value={loading ? '—' : (stats?.agents.total ?? 0)} />
        <StatCard
          label="Active"
          value={loading ? '—' : (stats?.agents.active ?? 0)}
          hint={loading ? '' : `${stats?.agents.active ?? 0} of ${stats?.agents.total ?? 0}`}
        />
        <StatCard
          label="Stub"
          value={loading ? '—' : (stats?.agents.stub ?? 0)}
          hint="Version 0.0.0"
        />
        <StatCard
          label="Adapters"
          value={loading ? '—' : (stats?.adapters.total ?? 0)}
          hint={
            loading
              ? ''
              : `${stats?.adapters.configured ?? 0} configured · ${(stats?.adapters.total ?? 0) - (stats?.adapters.configured ?? 0)} pending`
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-8">
          {agents ? (
            <AgentTable agents={agents.agents} />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
              {loading ? 'Loading agents…' : 'No agent data.'}
            </div>
          )}

          <section>
            <header className="mb-3 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Adapter Status</h2>
              <span className="text-xs text-slate-500">
                {adapters ? `${adapters.filter((a) => a.configured).length} of ${adapters.length} configured` : ''}
              </span>
            </header>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {(adapters ?? []).map((a) => (
                <AdapterCard key={a.id} adapter={a} />
              ))}
            </div>
          </section>
        </div>

        <HealthSidebar health={health} loading={loading} />
      </div>
    </div>
  );
}
