import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type {
  DiscoveredAgent,
  PlaygroundCatalog,
  PlaygroundSearchResult,
  PlaygroundAgentResult,
  PlaygroundAdapterResult,
} from '../api/types';
import Badge from '../components/Badge';
import JsonViewer from '../components/JsonViewer';

type Mode = 'search' | 'agent' | 'adapter';

interface HistoryEntry {
  id: number;
  at: string;
  mode: Mode;
  label: string;
  status: 'ok' | 'error';
  duration_ms: number;
  request: unknown;
  response: unknown;
}

export default function Playground() {
  const [mode, setMode] = useState<Mode>('search');
  const [catalog, setCatalog] = useState<PlaygroundCatalog | null>(null);
  const [response, setResponse] = useState<unknown>(null);
  const [responseStatus, setResponseStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [responseTab, setResponseTab] = useState<'formatted' | 'raw' | 'timeline'>('raw');
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.catalog().then((c) => {
      if (!cancelled) setCatalog(c);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function pushHistory(entry: Omit<HistoryEntry, 'id' | 'at'>) {
    setHistory((h) => [
      { id: Date.now(), at: new Date().toISOString(), ...entry },
      ...h,
    ].slice(0, 10));
  }

  async function execute(label: string, request: unknown, run: () => Promise<{ output: unknown; duration_ms: number }>) {
    setResponseStatus('loading');
    setResponse(null);
    setDuration(null);
    try {
      const { output, duration_ms } = await run();
      setResponse(output);
      setResponseStatus('ok');
      setDuration(duration_ms);
      setResponseTab('raw');
      pushHistory({ mode, label, status: 'ok', duration_ms, request, response: output });
    } catch (err) {
      const detail = err instanceof Error
        ? { message: err.message, ...(typeof (err as { body?: unknown }).body === 'object' ? { body: (err as { body?: unknown }).body } : {}) }
        : { message: String(err) };
      setResponse(detail);
      setResponseStatus('error');
      setDuration(null);
      pushHistory({ mode, label, status: 'error', duration_ms: 0, request, response: detail });
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Playground</h1>
        <p className="mt-1 text-sm text-slate-600">
          Run searches, agents, and adapter operations against this OTAIP instance.
        </p>
      </header>

      <div className="flex items-center gap-2">
        {(['search', 'agent', 'adapter'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              mode === m
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {m[0]?.toUpperCase()}{m.slice(1)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_3fr]">
        {/* Left — request builder + history */}
        <div className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            {mode === 'search' && (
              <SearchPanel
                onExecute={(req) =>
                  execute(`search ${req.origin}→${req.destination}`, req, async () => {
                    const r = await api.search(req);
                    return { output: r as unknown, duration_ms: r.duration_ms };
                  })
                }
              />
            )}
            {mode === 'agent' && (
              <AgentPanel
                catalog={catalog}
                onExecute={(agent_id, input, label) =>
                  execute(label, { agent_id, input }, async () => {
                    const r = await api.runAgent(agent_id, input);
                    return { output: r as unknown, duration_ms: r.duration_ms };
                  })
                }
              />
            )}
            {mode === 'adapter' && (
              <AdapterPanel
                onExecute={(operation, input, label) =>
                  execute(label, { operation, input }, async () => {
                    const r = await api.runAdapter(operation, input);
                    return { output: r as unknown, duration_ms: r.duration_ms };
                  })
                }
              />
            )}
          </section>

          <HistoryPanel
            history={history}
            onReplay={(entry) => {
              setMode(entry.mode);
              setResponse(entry.response);
              setResponseStatus(entry.status);
              setDuration(entry.duration_ms);
            }}
          />
        </div>

        {/* Right — response */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <header className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Response</h2>
            <div className="flex items-center gap-2 text-xs">
              {duration !== null ? (
                <span className="font-mono text-slate-500">{duration}ms</span>
              ) : null}
              {responseStatus === 'loading' ? <Badge tone="blue">Running…</Badge> : null}
              {responseStatus === 'ok' ? <Badge tone="green">OK</Badge> : null}
              {responseStatus === 'error' ? <Badge tone="red">Error</Badge> : null}
            </div>
          </header>

          <div className="mt-3 flex gap-2 border-b border-slate-200 text-sm">
            {(['formatted', 'raw', 'timeline'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setResponseTab(tab)}
                className={`-mb-px border-b-2 px-2 py-1.5 ${
                  responseTab === tab
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab[0]?.toUpperCase()}{tab.slice(1)}
              </button>
            ))}
          </div>

          <div className="mt-3 min-h-[16rem]">
            {responseStatus === 'idle' ? (
              <p className="text-sm text-slate-500">Run a request to see the response here.</p>
            ) : responseTab === 'raw' || responseTab === 'formatted' ? (
              <>
                {responseTab === 'formatted' ? (
                  <FormattedResponse mode={mode} value={response} />
                ) : null}
                {responseTab === 'formatted' ? <div className="my-3 h-px bg-slate-100" /> : null}
                <JsonViewer value={response} />
              </>
            ) : (
              <Timeline mode={mode} duration={duration} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search mode — typed form
// ---------------------------------------------------------------------------

interface SearchPanelProps {
  onExecute: (req: {
    origin: string;
    destination: string;
    date: string;
    passengers: number;
    cabinClass?: 'economy' | 'premium_economy' | 'business' | 'first';
  }) => Promise<void>;
}

function SearchPanel({ onExecute }: SearchPanelProps) {
  const [origin, setOrigin] = useState('JFK');
  const [destination, setDestination] = useState('LAX');
  const [date, setDate] = useState(twoWeeksOut());
  const [passengers, setPassengers] = useState(1);
  const [cabin, setCabin] = useState<'economy' | 'premium_economy' | 'business' | 'first'>('economy');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onExecute({ origin: origin.toUpperCase(), destination: destination.toUpperCase(), date, passengers, cabinClass: cabin });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">Flight search</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Origin (IATA)">
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} maxLength={3} className={INPUT} />
        </Field>
        <Field label="Destination (IATA)">
          <input value={destination} onChange={(e) => setDestination(e.target.value)} maxLength={3} className={INPUT} />
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
        </Field>
        <Field label="Passengers">
          <input
            type="number"
            min={1}
            max={9}
            value={passengers}
            onChange={(e) => setPassengers(Number(e.target.value))}
            className={INPUT}
          />
        </Field>
        <Field label="Cabin class">
          <select value={cabin} onChange={(e) => setCabin(e.target.value as typeof cabin)} className={INPUT}>
            <option value="economy">Economy</option>
            <option value="premium_economy">Premium economy</option>
            <option value="business">Business</option>
            <option value="first">First</option>
          </select>
        </Field>
      </div>
      <button type="submit" disabled={busy} className={BTN}>
        {busy ? 'Searching…' : 'Execute search'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Agent mode — picker + JSON editor
// ---------------------------------------------------------------------------

interface AgentPanelProps {
  catalog: PlaygroundCatalog | null;
  onExecute: (agent_id: string, input: unknown, label: string) => Promise<void>;
}

function AgentPanel({ catalog, onExecute }: AgentPanelProps) {
  const [agentId, setAgentId] = useState('0.1');
  const [json, setJson] = useState('{\n  "code": "JFK",\n  "code_type": "iata"\n}');
  const [busy, setBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const selected = catalog?.agents.find((a) => a.id === agentId) ?? null;
  const executable = catalog?.executable_ids.includes(agentId) ?? false;

  // Seed the editor when the agent changes if we have a hint
  useEffect(() => {
    const hint = catalog?.schemas[agentId];
    if (hint) setJson(JSON.stringify(hint.example_input, null, 2));
  }, [catalog, agentId]);

  const grouped = useMemo<Array<[string, DiscoveredAgent[]]>>(() => {
    if (!catalog) return [];
    const map: Record<string, DiscoveredAgent[]> = {};
    for (const a of catalog.agents) (map[a.stage] ??= []).push(a);
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [catalog]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setParseError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON');
      return;
    }
    setBusy(true);
    try {
      await onExecute(agentId, parsed, `${agentId} ${selected?.name ?? ''}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">Agent</h3>
      <Field label="Agent">
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={INPUT}>
          {grouped.map(([stage, list]) => (
            <optgroup key={stage} label={stage}>
              {list.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} — {a.name}
                  {a.contract_status === 'stub' ? ' (stub)' : ''}
                  {catalog?.executable_ids.includes(a.id) ? ' ✓' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      {selected ? (
        <div className="text-xs text-slate-500">
          <span className="font-mono">{selected.source_path}</span>
        </div>
      ) : null}
      {!executable ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          This agent isn't yet wired for playground execution. The picker can find it; submitting will return 501.
          See <span className="font-mono">executable_ids</span> in the catalog for the agents this build can run.
        </div>
      ) : null}
      <Field label="Input JSON">
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={8}
          className={`${INPUT} font-mono text-xs`}
          spellCheck={false}
        />
      </Field>
      {parseError ? <div className="text-xs text-red-700">{parseError}</div> : null}
      <button type="submit" disabled={busy} className={BTN}>
        {busy ? 'Running…' : 'Execute agent'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Adapter mode
// ---------------------------------------------------------------------------

interface AdapterPanelProps {
  onExecute: (
    operation: 'search' | 'price' | 'isAvailable',
    input: unknown,
    label: string,
  ) => Promise<void>;
}

function AdapterPanel({ onExecute }: AdapterPanelProps) {
  const [operation, setOperation] = useState<'search' | 'price' | 'isAvailable'>('isAvailable');
  const [json, setJson] = useState('{}');
  const [busy, setBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    if (operation === 'isAvailable') setJson('{}');
    if (operation === 'search') {
      setJson(JSON.stringify({
        segments: [{ origin: 'JFK', destination: 'LAX', departure_date: twoWeeksOut() }],
        passengers: [{ type: 'ADT', count: 1 }],
        cabin_class: 'economy',
      }, null, 2));
    }
    if (operation === 'price') setJson(JSON.stringify({ offer_id: 'paste-an-offer-id-here', source: 'duffel', passengers: [{ type: 'ADT', count: 1 }] }, null, 2));
  }, [operation]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setParseError(null);
    let parsed: unknown = undefined;
    if (operation !== 'isAvailable') {
      try {
        parsed = JSON.parse(json);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Invalid JSON');
        return;
      }
    }
    setBusy(true);
    try {
      await onExecute(operation, parsed, `adapter.${operation}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">Adapter</h3>
      <Field label="Operation">
        <select value={operation} onChange={(e) => setOperation(e.target.value as typeof operation)} className={INPUT}>
          <option value="isAvailable">isAvailable</option>
          <option value="search">search</option>
          <option value="price">price</option>
        </select>
      </Field>
      {operation !== 'isAvailable' ? (
        <Field label="Input JSON">
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={8}
            className={`${INPUT} font-mono text-xs`}
            spellCheck={false}
          />
        </Field>
      ) : null}
      {parseError ? <div className="text-xs text-red-700">{parseError}</div> : null}
      <button type="submit" disabled={busy} className={BTN}>
        {busy ? 'Running…' : 'Execute'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function HistoryPanel({
  history,
  onReplay,
}: {
  history: HistoryEntry[];
  onReplay: (entry: HistoryEntry) => void;
}) {
  if (history.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-white p-5 text-center text-xs text-slate-500">
        Request history (last 10) will appear here.
      </div>
    );
  }
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-200 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        History
      </header>
      <ul className="divide-y divide-slate-100">
        {history.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onReplay(entry)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-slate-50"
            >
              <span className="w-12 font-mono text-slate-500">{new Date(entry.at).toLocaleTimeString()}</span>
              <span className={`w-12 font-mono text-[10px] uppercase ${entry.status === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>
                {entry.status}
              </span>
              <span className="w-16 font-mono text-slate-500">{entry.mode}</span>
              <span className="flex-1 truncate text-slate-700">{entry.label}</span>
              {entry.duration_ms > 0 ? (
                <span className="font-mono text-slate-400">{entry.duration_ms}ms</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Formatted view + timeline
// ---------------------------------------------------------------------------

function FormattedResponse({ mode, value }: { mode: Mode; value: unknown }) {
  if (!value || typeof value !== 'object') return null;
  if (mode === 'search' && 'offers' in (value as object)) {
    const r = value as PlaygroundSearchResult;
    if (r.offers.length === 0) return <div className="text-sm text-slate-500">No offers returned.</div>;
    return (
      <div className="space-y-2">
        {r.offers.slice(0, 8).map((o) => {
          const seg = o.itinerary?.segments?.[0];
          return (
            <div key={o.offer_id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-slate-500">
                  {o.source} · {o.offer_id.slice(0, 14)}…
                </span>
                <span className="font-semibold tabular-nums">
                  {o.price.total} {o.price.currency}
                </span>
              </div>
              {seg ? (
                <div className="mt-1 text-xs text-slate-600">
                  {seg.carrier}{seg.flight_number} · {seg.origin} → {seg.destination} ·{' '}
                  {new Date(seg.departure_time).toLocaleTimeString()} →{' '}
                  {new Date(seg.arrival_time).toLocaleTimeString()} · {o.itinerary.connection_count} stop{o.itinerary.connection_count === 1 ? '' : 's'}
                </div>
              ) : null}
            </div>
          );
        })}
        {r.offers.length > 8 ? (
          <div className="text-xs text-slate-500">+ {r.offers.length - 8} more in raw view</div>
        ) : null}
      </div>
    );
  }
  if (mode === 'agent' && 'output' in (value as object)) {
    const out = (value as PlaygroundAgentResult).output;
    return (
      <div className="text-sm text-slate-600">
        Agent returned in {(value as PlaygroundAgentResult).duration_ms}ms. See raw view for full output.
        {typeof out === 'object' && out && 'data' in (out as object) ? (
          <span className="ml-1 font-mono text-xs">
            {Object.keys((out as { data: object }).data).join(', ')}
          </span>
        ) : null}
      </div>
    );
  }
  if (mode === 'adapter' && 'operation' in (value as object)) {
    const r = value as PlaygroundAdapterResult;
    return (
      <div className="text-sm text-slate-600">
        Adapter operation <span className="font-mono">{r.operation}</span> returned in {r.duration_ms}ms.
      </div>
    );
  }
  return null;
}

function Timeline({ mode, duration }: { mode: Mode; duration: number | null }) {
  if (duration === null) return <div className="text-sm text-slate-500">No timing data yet.</div>;
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-slate-500">{mode} request</span>
        <span className="font-mono text-slate-700">{duration}ms</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-sky-500"
          style={{ width: `${Math.min(100, Math.max(2, (duration / 5000) * 100))}%` }}
        />
      </div>
      <div className="text-[11px] text-slate-500">
        Sub-agent timing breakdowns will land here once the playground exposes pipeline traces.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared form bits
// ---------------------------------------------------------------------------

const INPUT =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-slate-500 focus:outline-none';

const BTN =
  'rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function twoWeeksOut(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}
