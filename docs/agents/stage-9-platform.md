# Stage 9 -- Platform Agents

**Package:** `@otaip/agents-platform`

Multi-agent orchestration, knowledge retrieval, monitoring/alerting, audit/compliance, plugin management, and platform health aggregation.

---

### Agent 9.1 -- Orchestrator

**ID:** `9.1`
**Class:** `Orchestrator`
**Status:** Implemented

Multi-agent workflow coordination. Defines named workflows (search-to-price, book-to-ticket, full booking, exchange flow, refund flow) as step sequences. Supports conditional steps, parallel execution, error handling (stop/skip/continue), and pipeline building.

**Input (`OrchestratorInput`):**
- `workflow` -- workflow name
- `input` -- workflow input data
- `options?` -- `stop_on_error?`, `timeout_ms?`

**Output (`OrchestratorOutput`):**
- `workflow` -- workflow name
- `status` -- `'completed' | 'failed' | 'partial'`
- `steps` -- per-step results (agent ID, status, duration, output/error)
- `total_duration_ms`
- `final_output?` -- last step output

**Constructor:** Accepts injectable `StepExecutor` for testing without real agent imports.

---

### Agent 9.2 -- Knowledge Retrieval

**ID:** `9.2`
**Class:** `KnowledgeRetrieval`
**Status:** Implemented

RAG (Retrieval-Augmented Generation) over the travel knowledge base. Indexes documents by topic, supports BM25 + vector hybrid search with injectable embedding provider.

**Input (`KnowledgeInput`):**
- `operation` -- `'query' | 'index_document' | 'list_topics' | 'get_document'`
- Query: query string, topic filter, max results
- Index: document ID, title, content, tags, topic

**Output (`KnowledgeOutput`):**
- `results?` -- ranked results with relevance score, excerpt, full content
- `document?` -- specific document
- `topics?` -- available topic list
- `query_time_ms?`

---

### Agent 9.3 -- Monitoring & Alerting

**ID:** `9.3`
**Class:** `MonitoringAlerting`
**Status:** Implemented

Agent health monitoring: latency tracking (p50/p95), error rates, SLA compliance reporting. Records metrics, fires alerts on threshold violations, supports alert acknowledgment.

**Input (`MonitoringInput`):**
- `operation` -- `'record_metric' | 'get_health' | 'list_alerts' | 'acknowledge_alert' | 'get_sla_report'`
- Metric: agent ID, metric type (latency_ms/error/success/timeout), value
- Alert: alert ID for acknowledgment

**Output (`MonitoringOutput`):**
- `health?` -- agent health (status, p50/p95 latency, error rate, total calls)
- `alerts?` -- alert list with severity and fired timestamp
- `slaReport?` -- availability percent, p95 latency, error count

---

### Agent 9.4 -- Audit & Compliance

**ID:** `9.4`
**Class:** `AuditCompliance`
**Status:** Implemented

Audit trail logging with SHA-256 payload hashing, PII redaction (credit cards, passports, emails, phone numbers, DOB), GDPR/PCI/IATA compliance issue flagging, and compliance reporting.

**Input (`AuditInput`):**
- `operation` -- `'log_event' | 'query_audit_log' | 'flag_compliance_issue' | 'get_compliance_report' | 'redact_pii'`
- Event: type (agent_decision, data_access, booking_created, etc.), agent ID, user/session ID, payload
- Compliance: issue type, description, severity, affected records

**Output (`AuditOutput`):**
- `entry?` -- audit log entry with hash, PII redaction flag, retention days
- `entries?` -- query results
- `issue?` -- flagged compliance issue
- `report?` -- compliance report (events with PII, redaction counts, open issues by severity)
- `redactedPayload?` -- PII-redacted data

---

### Agent 9.5 -- Plugin Manager

**ID:** `9.5`
**Class:** `PluginManager`
**Status:** Implemented

Third-party agent extension management: register/unregister plugins, enable/disable, capability discovery, and plugin metadata management.

**Input (`PluginInput`):**
- `operation` -- `'register_plugin' | 'unregister_plugin' | 'list_plugins' | 'get_plugin' | 'discover_capabilities' | 'enable_plugin' | 'disable_plugin'`
- Plugin data: name, version, description, author, capabilities, agent IDs, metadata

**Output (`PluginOutput`):**
- `plugin?` -- plugin record
- `plugins?` -- plugin list
- `capabilities?` -- capability-to-plugin mapping
- `message?` -- operation result message

---

### Agent 9.6 -- Performance Audit

**ID:** `9.6`
**Class:** `PerformanceAuditAgent`
**Status:** Implemented

Aggregates agent execution metrics from the EventStore within a given time window and identifies degraded agents. Read-only -- no side effects.

---

### Agent 9.7 -- Routing Audit

**ID:** `9.7`
**Class:** `RoutingAuditAgent`
**Status:** Implemented

Analyses routing decisions and outcomes from the EventStore within a given time window. Read-only -- no side effects.

---

### Agent 9.8 -- Recommendation

**ID:** `9.8`
**Class:** `RecommendationAgent`
**Status:** Implemented

Accepts performance and routing audit reports and produces deterministic recommendations. Read-only -- no side effects.

---

### Agent 9.9 -- Alert

**ID:** `9.9`
**Class:** `AlertAgent`
**Status:** Implemented

Queries EventStore events, computes metrics against configurable thresholds, and produces alerts. Read-only -- no side effects.

---

### Platform Health Aggregator (Utility)

**Class:** `PlatformHealthAggregator`
**Note:** This is a utility class, not an Agent. It does not implement the Agent interface.

Checks health of all registered agents and returns aggregate platform status.

**Usage:**
```typescript
const aggregator = new PlatformHealthAggregator(agentMap);
const health = await aggregator.check();
// health.status => 'healthy' | 'degraded' | 'unhealthy'
```
