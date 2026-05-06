import type { HealthReport } from '../api/types';

interface HealthSidebarProps {
  health: HealthReport | null;
  loading: boolean;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function HealthSidebar({ health, loading }: HealthSidebarProps) {
  return (
    <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Health</h2>
      <dl className="mt-3 space-y-2 text-xs">
        <Row label="OTAIP" value={loading ? '…' : (health?.otaip_version ?? '—')} />
        <Row label="Node" value={loading ? '…' : (health?.node_version ?? '—')} />
        <Row label="Uptime" value={loading ? '…' : health ? formatUptime(health.uptime_seconds) : '—'} />
        <Row label="Requests" value={loading ? '…' : String(health?.request_count ?? 0)} />
        <Row
          label="Last request"
          value={loading ? '…' : health?.last_request_at ? new Date(health.last_request_at).toLocaleTimeString() : '—'}
        />
      </dl>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-mono text-slate-800">{value}</dd>
    </div>
  );
}
