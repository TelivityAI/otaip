/**
 * Mirrors of the JSON shapes the OTAIP backend returns. Hand-written
 * (not generated) so the front end stays decoupled from the server's
 * internal types.
 */

export interface DiscoveredAgent {
  id: string;
  name: string;
  stage: string;
  version: string;
  source_path: string;
  contract_status: 'active' | 'stub';
}

export interface AgentRollup {
  agents: DiscoveredAgent[];
  domain_groups: Record<string, { total: number; active: number; stub: number }>;
  totals: { total: number; active: number; stub: number };
}

export interface AgentGraphNode {
  id: string;
  name: string;
  stage: string;
  version: string;
  contract_status: 'active' | 'stub';
  has_contract: boolean;
  source_path: string;
}

export interface AgentGraphEdge {
  source: string;
  target: string;
  kind: 'workflow' | 'package';
  label: string;
}

export interface PackageDep {
  from_package: string;
  to_package: string;
  from_stage: string;
  to_stage: string;
}

export interface AgentGraph {
  generated_by: string;
  total_nodes: number;
  total_edges: number;
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
  package_deps: PackageDep[];
}

export interface AdapterDescriptor {
  id: string;
  name: string;
  type: string;
  auth: string;
  configured: boolean;
  env_vars: string[];
}

export interface HealthReport {
  status: 'ok';
  uptime_seconds: number;
  node_version: string;
  otaip_version: string;
  last_request_at: string | null;
  request_count: number;
}

export interface PlatformStats {
  agents: { total: number; active: number; stub: number };
  adapters: { total: number; configured: number };
}

export interface PlaygroundCatalog {
  agents: DiscoveredAgent[];
  executable_ids: string[];
  schemas: Record<string, { description: string; example_input: unknown }>;
}

export interface PlaygroundSearchResult {
  offers: Array<{
    offer_id: string;
    source: string;
    price: { total: number; currency: string };
    itinerary: {
      segments: Array<{
        carrier: string;
        flight_number: string;
        origin: string;
        destination: string;
        departure_time: string;
        arrival_time: string;
        duration_minutes: number;
      }>;
      total_duration_minutes: number;
      connection_count: number;
    };
  }>;
  totalFound: number;
  sources: string[];
  duration_ms: number;
}

export interface PlaygroundAgentResult {
  agent_id: string;
  output: unknown;
  duration_ms: number;
}

export interface PlaygroundAdapterResult {
  operation: 'search' | 'price' | 'isAvailable';
  output: unknown;
  duration_ms: number;
}

export interface ApiError {
  error: string;
  hint?: string;
  agent_id?: string;
  message?: string;
  details?: string[];
}
