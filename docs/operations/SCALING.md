# Scaling Guide

## Architecture characteristics

OTAIP agents are **stateless** by default. Each `execute()` call is self-contained — it takes input, produces output, and holds no state between calls. This makes horizontal scaling straightforward.

## Bottlenecks

The primary bottleneck is **external API rate limits**, not OTAIP computation:

| Supplier | Typical rate limit | OTAIP mitigation |
|----------|-------------------|------------------|
| Duffel | ~100 req/s | `BaseAdapter` optional `RateLimiter` + circuit breaker |
| Sabre | Varies by contract | `BaseAdapter` circuit breaker + unsafe-op no auto-retry |
| Amadeus | ~10 TPS (self-service) | `BaseAdapter` rate limiter (configure per adapter instance) |
| Navitaire | Session-based | Session manager in adapter + shared resilience path |

Agent 3.5 (`ApiAbstraction`) also has an in-process circuit breaker for mock/handler injection — it is **not** the live Connect HTTP path.

## Horizontal scaling

Most agents are stateless:
1. Run multiple instances behind a load balancer
2. Each instance gets its own adapter connections
3. Money-path state requires a shared CAS-capable store (see below)

## Stateful agents

Agents / components that hold state across calls:
- **Agent 2.4 (Offer Builder)**: TTL-managed offer store
- **Agent 3.6 (Order Management)**: Order lifecycle state
- **PaymentConfirmationStateMachine** / durable wrapper: pay→confirm aggregate
- **Effect ledger / command store**: mutation idempotency

For multi-instance deployments, inject a shared `CompareAndSwapPersistenceAdapter` (and command/effect ledger backends). Plain get/set KV without CAS is insufficient for idempotency. Live mode refuses irreversible ops on ephemeral stores — see `LiveSafetyMode` and [PRODUCTION_DOD.md](../engineering/PRODUCTION_DOD.md).

## Memory profile

Most agents are lightweight (~10MB per agent instance). The main memory consumers are:
- Reference data (airport database): ~50MB shared across agents
- Offer cache (Agent 2.4): grows with active offers, bounded by TTL
- Knowledge base (Agent 9.2): ~1MB for seed documents

## Monitoring

Use the `PlatformHealthAggregator` from `@otaip/agents-platform` to aggregate health across all agents. Wire it to your existing monitoring (Prometheus, Datadog, etc.).

Use the `TelemetryProvider` from `@otaip/core` to emit spans for each agent execution. The `NoopTelemetryProvider` has zero overhead when no backend is configured.
