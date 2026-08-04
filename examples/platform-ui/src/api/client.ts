/**
 * Tiny typed fetch wrapper. Vite proxies `/api` to the OTA server in dev,
 * so callers never hard-code an origin.
 */

import type {
  AgentRollup,
  AgentGraph,
  AdapterDescriptor,
  ApiError,
  HealthReport,
  PlatformStats,
  PlaygroundAdapterResult,
  PlaygroundAgentResult,
  PlaygroundCatalog,
  PlaygroundSearchResult,
} from './types';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = body as ApiError | string | null;
    const message = typeof err === 'string'
      ? err
      : (err && typeof err === 'object' && 'error' in err && typeof err.error === 'string')
        ? err.error
        : `Request failed with ${res.status}`;
    const e = new Error(message) as Error & { status?: number; body?: unknown };
    e.status = res.status;
    e.body = body;
    throw e;
  }
  return body as T;
}

export const api = {
  // Platform — read-only telemetry
  agents: () => request<AgentRollup>('/api/platform/agents'),
  agentGraph: () => request<AgentGraph>('/api/platform/agent-graph'),
  adapters: () => request<{ adapters: AdapterDescriptor[] }>('/api/platform/adapters'),
  health: () => request<HealthReport>('/api/platform/health'),
  stats: () => request<PlatformStats>('/api/platform/stats'),

  // Playground
  catalog: () => request<PlaygroundCatalog>('/api/playground/catalog'),
  search: (body: {
    origin: string;
    destination: string;
    date: string;
    returnDate?: string;
    passengers: number;
    cabinClass?: string;
  }) =>
    request<PlaygroundSearchResult>('/api/playground/search', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  runAgent: (agent_id: string, input: unknown) =>
    request<PlaygroundAgentResult>('/api/playground/agent', {
      method: 'POST',
      body: JSON.stringify({ agent_id, input }),
    }),
  runAdapter: (operation: 'search' | 'price' | 'isAvailable', input?: unknown) =>
    request<PlaygroundAdapterResult>('/api/playground/adapter', {
      method: 'POST',
      body: JSON.stringify({ operation, input }),
    }),
};
