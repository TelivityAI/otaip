# Agent Boundaries

Many OTAIP stages contain sibling agents with adjacent responsibilities. This guide
states **which agent owns which responsibility** — the intent, field, or operation that
assigns a request to exactly one agent — derived from the agent contracts.

Use it to assign a request to the right agent: find the relevant agents, and the
**Boundary** line is the deciding signal. Each agent is identified by its `readonly id`
(the binding identifier).

> Scope note: every boundary here is derived from the agents' own contracts in
> `packages/`. When a contract is genuinely ambiguous it is called out inline.

---

## Orchestration vs. single-purpose — Agent 9.1

This one ownership rule covers the most agents. **9.1 Orchestrator** owns a request **only**
when it requires a multi-step, multi-agent workflow — its contract defines exactly these
pipelines: `search-to-price`, `book-to-ticket`, `full booking`, `exchange flow`,
`refund flow` (with conditional/parallel steps and error handling). **A single concrete
operation belongs to its specific agent, never 9.1.**

| Belongs to 9.1 (multi-step) | Belongs to the specific agent (single op) |
|---|---|
| "search → price → book → ticket this end to end" | one availability query → **1.1** |
| "reconcile, then refund, then update loyalty" | one BSP reconciliation → **7.1** |
| "run the exchange flow (assess + reissue + collect)" | one pre-ticket audit → **6.2** |
| any chain that hands output between ≥2 agents | profile read / apply-to-PNR → **8.1** |
| | mid-office PNR QC / deadline scan → **8.3** |

Note: an agent that internally composes others is **not** automatically 9.1. For example
**5.5 Self-Service Rebooking** composes 1.1 + 5.1, but it is a single named capability
("present priced rebooking alternatives") — still 5.5, not 9.1. The 9.1 signal is the
*user asking for a multi-stage pipeline*, not an agent happening to call others.

---

## Reference data (0.x)

| Pair | A | B | Boundary |
|---|---|---|---|
| 0.1 ↔ 0.6 | **0.1 Airport/City Code Resolver** — IATA/ICAO airport & city codes, multi-airport cities | **0.6 Currency & Tax Code Resolver** — ISO 4217 currency + IATA tax/surcharge codes | A resolves a *place* code; B resolves a *money/tax* code |
| 0.3 ↔ 0.6 | **0.3 Fare Basis Code Decoder** — decodes fare basis into cabin, restrictions, advance-purchase, penalties | 0.6 Currency & Tax Code Resolver | A decodes a *fare basis*; B resolves a *currency/tax* code |
| 0.3 ↔ 3.3 | 0.3 Fare Basis Code Decoder | **3.3 PNR Validation** — pre-ticketing PNR checks | A *decodes a code*; B *validates a PNR* |

Examples: "What does fare basis YEE3M mean?" → 0.3 · "Is YQ a tax or a surcharge?" → 0.6 ·
"What airport is LGW?" → 0.1

---

## Search & shopping (1.x)

| Pair | A | B | Boundary |
|---|---|---|---|
| 1.1 ↔ 1.6 | **1.1 Availability Search** — queries adapters in parallel, normalizes, sorts availability | **1.6 Multi-Source Aggregator** — aggregates, dedupes, and ranks *already-fetched* results | A *fetches* availability; B *merges/ranks* results from multiple sources |
| 1.1 ↔ 1.3 | 1.1 Availability Search | **1.3 Connection Builder** — validates connections against MCT, scores quality, checks interline | A finds flights; B *builds/validates connections* |
| 1.8 ↔ 1.4 | **1.8 AI Travel Advisor** — rule-based recommendation engine; preference-weighted ranking with explanations | **1.4 Fare Shopping** — multi-source fare *comparison*, class mapping, branded families | A *recommends/ranks "best for me"*; B *compares/lists fares* |
| 1.5 ↔ 1.2/1.3/1.4 | **1.5 Ancillary Shopping** — baggage, seats, meals, lounge, wifi, priority | schedule (1.2) / connections (1.3) / fares (1.4) | A searches *add-ons*; the others search flights/fares/schedule |

Examples: "Recommend the best flight for me" → 1.8 · "Compare fares for this route" → 1.4 ·
"What baggage can I add?" → 1.5 · "Is a 45-min connection at FRA legal?" → 1.3

---

## Pricing & booking (2.x, 3.x)

| Pair | A | B | Boundary |
|---|---|---|---|
| 2.1 ↔ 3.3 | **2.1 Fare Rule Agent** — parses ATPCO rules (cat 1–20) into structured form | 3.3 PNR Validation | A *reads/decodes fare rules*; B *validates a PNR* |
| 2.4 ↔ 3.6 | **2.4 Offer Builder** — builds, caches, and validates priced offers with TTL | **3.6 Order Management** — order lifecycle: create/modify/cancel/list, status transitions | A is the *pre-purchase offer artifact*; B is the *committed order lifecycle* |
| 2.4 ↔ 3.7 | 2.4 Offer Builder | **3.7 Payment Processing** — PCI-safe form-of-payment builder + transaction recorder | A *assembles/holds the offer*; B *charges for it* |
| 3.1 ↔ 3.5 | **3.1 GDS/NDC Router** — routes a booking to GDS/NDC/direct by carrier, codeshare, NDC capability | **3.5 API Abstraction** — universal HTTP client (circuit breaker, retry, rate limit, IATA error normalization) | A decides *which channel*; B handles *how the HTTP call is made* |
| 3.1 ↔ 3.7 | 3.1 GDS/NDC Router | 3.7 Payment Processing | A *selects a channel*; B *collects/records payment* |
| 3.2 ↔ 3.6 | **3.2 PNR Builder** — constructs GDS PNR command syntax (Amadeus/Sabre/Travelport) | 3.6 Order Management | A *generates command syntax*; B *acts on an order's lifecycle* |
| 3.2 ↔ 3.3 | 3.2 PNR Builder | 3.3 PNR Validation | A *builds* the PNR; B *checks an existing PNR is correct* |
| 3.2 ↔ 20.6 | 3.2 PNR Builder (air/GDS) | **20.6 Hotel Modification & Cancellation** | A is *air PNR commands*; B is a *hotel reservation change* |
| 3.8 ↔ 3.6 | **3.8 PNR Retrieval** — retrieves a booking by *record locator* across adapters (read-only) | 3.6 Order Management | A is a *single-locator fetch*; B is *order list/cancel/modify* |
| 3.8 ↔ 20.7 | 3.8 PNR Retrieval | **20.7 Confirmation Verification** — cross-checks CRS↔PMS before arrival | A is *GDS retrieval*; B is *cross-system hotel verification* |
| 3.4 (queues) | **3.4 Queue Management** — GDS *PNR queue* monitoring/processing | (vs 5.6 below) | A is the GDS *work queue*; a passenger *waitlist* is 5.6 |

Examples: "Generate the Amadeus PNR commands" → 3.2 · "Cancel order ABC123" → 3.6 ·
"Pull up booking by locator XYZ789" → 3.8 · "Which channel for this codeshare?" → 3.1 ·
"Process the card payment" → 3.7

---

## Ticketing (4.x)

| Pair | A | B | Boundary |
|---|---|---|---|
| 4.1 ↔ 4.3 | **4.1 Ticket Issuance** — ETR generation, conjunction tickets, BSP reporting | **4.3 Void Agent** — void within carrier window, BSP/ARC cut-off check | A *issues* a ticket; B *voids an issued ticket* |
| 4.1 ↔ 3.7 | 4.1 Ticket Issuance | 3.7 Payment Processing | A *issues the ETR*; B *records the form of payment* |
| 4.1 ↔ 3.3 | 4.1 Ticket Issuance | 3.3 PNR Validation | A *issues*; B *confirms ticket-ready* |

Examples: "Issue the e-ticket" → 4.1 · "Void this ticket before the cut-off" → 4.3

---

## Exchange & disruption (5.x)

| Pair | A | B | Boundary |
|---|---|---|---|
| 5.5 ↔ 5.1 | **5.5 Self-Service Rebooking** — composes 1.1 + 5.1 to *present priced alternatives*; does NOT execute the reissue | **5.1 Change Management** — Cat 31 voluntary-change *assessment* (fee, fare difference, residual) | A is a *customer-facing list of priced options*; B is the *cost calc for one change* |
| 5.5 ↔ 5.2 | 5.5 Self-Service Rebooking | **5.2 Exchange/Reissue** — *executes* the reissue, residual, tax carryforward, GDS exchange command | A *presents options*; B *performs the reissue* |
| 5.5 ↔ 5.3 | 5.5 Self-Service Rebooking | **5.3 Involuntary Rebook** — carrier-initiated schedule change, protection, EU261/US-DOT | A is *passenger-initiated self-service*; B is *carrier-initiated reprotection* |
| 5.6 ↔ 3.4 | **5.6 Waitlist Management** — passenger waitlist: add / clear / queryStatus / expire, priority scoring | 3.4 Queue Management | A is a *passenger seat waitlist*; B is a *GDS work queue of PNRs* — both are called a "queue" but they are different systems |

Examples: "Show my rebooking options with prices" → 5.5 · "What's the change fee to move
flights?" → 5.1 · "Reissue the ticket onto the new flight" → 5.2 · "Add me to the waitlist"
→ 5.6

---

## Platform (8.x, 9.x)

| Pair | A | B | Boundary |
|---|---|---|---|
| 9.8 ↔ 9.9 | **9.8 Recommendation** — produces recommendations from audit reports | **9.9 Alert** — threshold-based alerts computed over recorded events | A is *prescriptive "what to do"*; B is *"a threshold was breached"* |
| 9.3 ↔ 9.9 | **9.3 Monitoring & Alerting** — agent health, latency p50/p95, error rates, SLA | 9.9 Alert | A = *live agent-infra health & SLA* alerts; B = *event-metric threshold* alerts |
| 9.7 ↔ 8.4 | **9.7 Routing Audit** — analyses recorded routing decisions and outcomes (read-only) | **8.4 Reporting & Analytics** — aggregates transaction data: volume, revenue, spend by traveler/dept | A is *internal routing-quality analysis*; B is *business/financial reporting* |
| 9.7 ↔ 9.4 | 9.7 Routing Audit | **9.4 Audit & Compliance** — audit trail, PII redaction, GDPR/PCI/IATA flags | A audits *routing decisions*; B is the *compliance/PII audit trail* |
| 8.5 ↔ 9.5 | **8.5 Duty of Care** — locates travelers in active itineraries during disruptions, risk assessment | **9.5 Plugin Manager** — register/enable third-party agent plugins, capability discovery | A is *traveler safety/location*; B is *platform plugin administration* |

> 9.x identifiers follow `readonly id` (9.6 Performance Audit, 9.7 Routing Audit,
> 9.8 Recommendation, 9.9 Alert).

---

## Lodging (20.x) and the 1.7 boundary

| Pair | A | B | Boundary |
|---|---|---|---|
| 20.1 ↔ 20.2 | **20.1 Hotel Search Aggregator** — multi-source hotel availability (GDS hotel, Amadeus Hotel, Hotelbeds, Duffel Stays, channel managers) | **20.2 Property Deduplication** — merges duplicate properties into canonical records | A *searches*; B *deduplicates results* (it never searches) |
| 1.7 ↔ 20.1 | **1.7 Hotel & Car Search** — owns car rental search | 20.1 Hotel Search Aggregator | **Hotel search intent is owned by 20.1** for all hotel queries (standalone or in-trip); 1.7 owns cars and may compose with 20.1 for a combined hotel+car trip but does not own hotel intent |
| 1.7 ↔ 20.2 | 1.7 Hotel & Car Search | 20.2 Property Deduplication | A *searches*; B *deduplicates* results — a search request is always A |

Rule of thumb: **any car involvement → 1.7; standalone hotel → 20.1; dedup → 20.2.**

Examples: "Find a hotel for next weekend" → 20.1 · "Rent a car at LAX" → 1.7 ·
"Find a hotel **and a car** in Denver" → 1.7 · "Merge these duplicate properties" → 20.2
