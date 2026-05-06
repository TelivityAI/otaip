import type { AdapterDescriptor } from '../api/types';
import Badge from './Badge';

interface AdapterCardProps {
  adapter: AdapterDescriptor;
}

export default function AdapterCard({ adapter }: AdapterCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${adapter.configured ? 'bg-emerald-500' : 'bg-slate-300'}`}
              aria-hidden
            />
            <h3 className="text-sm font-semibold text-slate-900">{adapter.name}</h3>
          </div>
          <div className="mt-1 text-xs text-slate-500">{adapter.type}</div>
        </div>
        {adapter.configured ? (
          <Badge tone="green">Configured</Badge>
        ) : (
          <Badge tone="slate">Not configured</Badge>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <dt className="text-slate-500">Auth</dt>
        <dd className="text-right text-slate-700">{adapter.auth}</dd>
        <dt className="text-slate-500">Env</dt>
        <dd className="text-right font-mono text-[11px] text-slate-700">
          {adapter.env_vars.join(', ')}
        </dd>
      </dl>
    </div>
  );
}
