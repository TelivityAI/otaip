# OTAIP — Open Travel AI Platform

The full airline and hotel booking lifecycle — search, pricing, booking, ticketing, exchange, refund, and BSP/ARC settlement — modeled as typed, testable agents with a pipeline contract system that prevents LLM hallucinations at every step.

**75 agents. 6 distribution adapters. 14 pipeline-contracted agents. 3,342 tests. TypeScript strict.**

```bash
pnpm add @otaip/core @otaip/agents-booking @otaip/connect
```

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![CI](https://github.com/telivity-otaip/otaip/actions/workflows/ci.yml/badge.svg)](https://github.com/telivity-otaip/otaip/actions)
[![Tests](https://img.shields.io/badge/tests-3342%20passing-brightgreen)](https://github.com/telivity-otaip/otaip/actions)

---

## Build on OTAIP

What you can build with this platform:

- **An OTA** — search, book, ticket across multiple suppliers with automatic channel fallback
- **A TMC back-office** — mid-office automation, duty of care, corporate policy enforcement
- **An airline distribution layer** — NDC + GDS routing with capability-registry-driven scoring
- **A hotel booking platform** — HAIP adapter + 7 lodging agents (search through confirmation)
- **A travel AI assistant** — AgentLoop + pipeline validator + MCP/OpenAPI tool generation
- **Governance tooling** — performance audit, routing audit, recommendations, configurable alerts

---

## Quick Start

```bash
git clone https://github.com/telivity-otaip/otaip.git
cd otaip
pnpm install --frozen-lockfile
pnpm run data:download       # one-time: airport reference data
pnpm test                    # 3,342 tests
pnpm lint                    # 0 errors
pnpm -r run typecheck        # 16 packages, all green
```

> Note: lifecycle scripts are disabled (`ignore-scripts=true`) for supply-chain safety, so the airport reference data is fetched explicitly via `pnpm run data:download` rather than via a `postinstall` hook.

Run the full pipeline demo (requires `ANTHROPIC_API_KEY`):

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
pnpm --filter @otaip/demo book:full
```

See [docs/getting-started.md](docs/getting-started.md) for the complete setup guide.

---

## CLI

```bash
npx @otaip/cli agents                          # List all 75 agents
npx @otaip/cli agents --stage 3                # Filter by booking stage
npx @otaip/cli validate --agent 1.1 --input '{"origin":"JFK","destination":"LHR","departure_date":"2026-05-01","passengers":[{"type":"ADT","count":1}]}'
npx @otaip/cli search --from JFK --to LHR --date 2026-05-01
```

---

## Distribution Adapters

Six production adapters spanning GDS, NDC, LCC, aggregator, and hospitality channels. Real supplier API integrations with auth, rate limiting, and error normalization — not toy wrappers.

| Adapter | Type | Channel | Auth | Capabilities | Tests |
|---------|------|---------|------|-------------|-------|
| **Amadeus** | GDS | EDIFACT/REST | OAuth2 | Search, Price, Book, Status | 83 |
| **Sabre** | GDS | REST (BFM v5) | OAuth2 ATK | Search, Price, Book, Cancel, Status | 101 |
| **Navitaire** | LCC | REST (dotREZ) | JWT | Search, Price, Book, Ticket, Cancel | 109 |
| **TripPro/Mondee** | Aggregator | REST+SOAP | Dual token | Search, Price, Book, Cancel, Status | 73 |
| **Duffel** | NDC | REST | API token | Search, Price, Book, Cancel, Ticket | 32 |
| **HAIP** | Hospitality | REST | Bearer | Search, Book, Cancel | 58 |

**456 adapter tests total.** Each adapter implements the `ConnectAdapter` interface and declares a static `ChannelCapability` manifest for the capability registry.

See [docs/adapters/](docs/adapters/) for per-adapter documentation.

---

## Agent Domains

75 agents across 12 operational stages. Every agent implements `Agent<TInput, TOutput>` — typed inputs, typed outputs, confidence scores. No framework lock-in, no LLM required.

| Stage | Domain | Package | Agents | Description |
|-------|--------|---------|--------|-------------|
| 0 | Reference Data | `@otaip/agents-reference` | 7 | Airport/airline codes, fare basis, class of service, equipment, currency/tax, country regulatory |
| 1 | Search & Shop | `@otaip/agents-search` | 8 | Availability search, schedule, connections, fare shopping, ancillaries, multi-source aggregation |
| 1.9 | Offer Evaluation | `@otaip/core` | 1 | Multi-dimensional offer scoring with traveler constraints |
| 2 | Select & Price | `@otaip/agents-pricing` | 7 | Fare rules (ATPCO Cat 1-20), fare construction (NUC/ROE), tax calculation, offer builder, corporate policy |
| 3 | Book & Order | `@otaip/agents-booking` | 8 | GDS/NDC routing, PNR builder, validation, queue management, API abstraction, order management, payment, retrieval |
| 4 | Ticket & Fulfill | `@otaip/agents-ticketing` | 5 | Ticket issuance (ETR), EMD, void, itinerary delivery, document verification |
| 5 | Change & Exchange | `@otaip/agents-exchange` | 6 | Change management (Cat 31), exchange/reissue, involuntary rebook (EU261/US DOT), disruption, waitlist |
| 6 | Refund & Settlement | `@otaip/agents-settlement` | 6 | Refund processing (Cat 33), ADM prevention, ADM/ACM lifecycle, customer comms, feedback/complaint, loyalty |
| 7 | BSP/ARC Reconciliation | `@otaip/agents-reconciliation` | 6 | BSP HOT file, ARC IAR, commission management, interline, financial reporting, revenue accounting |
| 8 | TMC & Agency | `@otaip/agents-tmc` | 5 | Traveler profiles, corporate accounts, mid-office, reporting, duty of care |
| 9 | Platform | `@otaip/agents-platform` | 9 | Orchestrator, knowledge, monitoring, audit, plugin manager, performance audit, routing audit, recommendations, alerts |
| 20 | Lodging | `@otaip/agents-lodging` | 7 | Hotel search, property dedup, content normalization, rate comparison, booking, modification, confirmation verification |

See [docs/agents.md](docs/agents.md) for the complete agent table with IDs, class names, and contract status.

---

## Pipeline Contract System

The pipeline validator enforces six gates on every LLM-orchestrated call: schema conformance, semantic validation, intent lock, cross-agent consistency, confidence gating, and action classification. An LLM cannot fabricate an offer ID, change the destination mid-flow, or ticket without approval.

Every agent that participates in an LLM-orchestrated flow declares an `AgentContract` — Zod schemas, semantic validation, action classification, and confidence thresholds. The `PipelineOrchestrator` enforces six gates on every call:

```
LLM tool call
    |
    v
[1. Schema conformance]     Zod parse — structural hallucinations impossible
[2. Semantic validation]    Domain checks — "Is this airport code real?"
[3. Intent lock]            "You can't change the destination mid-flow"
[4. Cross-agent consistency] "This offer ID must exist in the search results"
    |
    v  (agent executes)
    |
[5. Confidence gating]     Output confidence meets threshold for action type
[6. Action classification]  Irreversible actions require approval token
```

14 agents are currently contracted (reference, search, pricing, booking, ticketing, governance). The remaining 61 work as standalone agents called directly — no breaking changes.

```typescript
import { PipelineOrchestrator, agentToTool } from '@otaip/core';

// Bridge contracted agents into LLM tools
const tool = agentToTool(contract, agent, orchestrator, session);
// Every tool.execute() runs through all 6 gates
```

See [docs/architecture.md](docs/architecture.md) for the full architecture overview.

---

## Domain Expertise

OTAIP agents encode real industry logic: ATPCO fare rules (Categories 1-33), NUC/ROE fare construction with HIP/BHC/CTM checks, BSP HOT file reconciliation, ADM prevention (9 pre-ticketing checks), NDC/EDIFACT normalization, IRROPS rebooking with EU261 and US DOT compliance, void window enforcement, married segment integrity, and payment-to-ticketing state machines with BSP finality rules.

---

## Project Structure

```
packages/
  core/                     Base types, pipeline validator, event store, tool bridge
  connect/                  Adapter framework + Amadeus, Sabre, Navitaire, TripPro, HAIP
  adapters/duffel/          Standalone Duffel NDC adapter
  agents/
    reference/              Stage 0: airport codes, airline codes, fare basis, etc.
    search/                 Stage 1: availability, fare shopping, connections
    pricing/                Stage 2: fare rules, tax calc, offer builder
    booking/                Stage 3: PNR, routing, payment, order management
    ticketing/              Stage 4: issuance, EMD, void
    exchange/               Stage 5: changes, reissue, involuntary rebook
    settlement/             Stage 6: refunds, ADM, loyalty
    reconciliation/         Stage 7: BSP, ARC, commission, reporting
    lodging/                Stage 20: hotel booking lifecycle
  agents-tmc/               Stage 8: TMC operations
  agents-platform/          Stage 9: orchestrator, monitoring, governance
  cli/                      CLI tool (otaip search/price/book/agents/validate)
demo/                       5 interactive demos (Duffel, Amadeus, Sabre, direct, full pipeline)
docs/                       Architecture, agents, adapters, getting started
```

---

## Documentation

- [Architecture Overview](docs/architecture.md) — pipeline validator, capability registry, event store
- [Complete Agent Reference](docs/agents.md) — all 75 agents with IDs, descriptions, contract status
- [Getting Started](docs/getting-started.md) — clone to working demo in 5 minutes
- [Adapter: Amadeus](docs/adapters/amadeus.md)
- [Adapter: Sabre](docs/adapters/sabre.md)
- [Adapter: Navitaire](docs/adapters/navitaire.md)
- [Adapter: TripPro/Mondee](docs/adapters/trippro.md)
- [Adapter: Duffel](docs/adapters/duffel.md)
- [Adapter: HAIP](docs/adapters/haip.md)

---

## Tech Stack

- **TypeScript** (`strict: true`, plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`; `exactOptionalPropertyTypes` is off — enabling it would require call-site changes across dozens of files, tracked as a separate cleanup)
- **Node.js** >=24
- **pnpm** 10+ (workspace monorepo, 16 packages)
- **Vitest** for testing (3,342 tests)
- **tsup** for building (ESM + DTS)
- **ESLint** + **Prettier** for linting/formatting
- **Zod** 4 for schema validation + JSON Schema generation

---

## Versioning

Pre-v1.0, every release is a patch bump (`0.6.0 → 0.6.1 → 0.6.2 → …`). See [VERSIONING.md](VERSIONING.md) for the policy and the history of the early version jumps.

---

## Contributing

Apache 2.0 licensed. PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Every agent implements the `Agent<TInput, TOutput>` interface from `@otaip/core`. Agents are stateless, testable, and composable. New agents follow the pattern in `packages/agents/reference/src/airport-code-resolver/`.

---

## License

[Apache License 2.0](LICENSE)
