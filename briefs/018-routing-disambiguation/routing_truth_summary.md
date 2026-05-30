# Routing Disambiguation Truth — Boundary Summary (Brief 018)

Authored against each agent's `readonly id` + JSDoc/contract description in this repo.
Companion data: [`routing_truth.jsonl`](./routing_truth.jsonl) (116 labeled utterances).
**Nothing here invents domain logic** — every boundary is quoted/derived from a real
contract. Genuinely ambiguous pairs are FLAGGED with what's missing, not guessed.

Each `correct_agent_id` / `confused_with` below uses the binding `readonly id`. See the
**Doc-drift finding** at the end re: the 9.x JSDoc/README being stale (cosmetic only).

---

## GROUP A — Orchestrator over-capture (highest leverage)

**The one rule that fixes ~5 agents:** Agent **9.1 Orchestrator** owns a request *only*
when it requires a **multi-step, multi-agent named workflow** — its contract defines
exactly these pipelines: `search-to-price`, `book-to-ticket`, `full booking`,
`exchange flow`, `refund flow` (with conditional/parallel steps and stop/skip/continue
error handling). **A single concrete operation belongs to its specific agent, never 9.1.**

| Belongs to 9.1 (multi-step) | Does NOT belong to 9.1 (single-purpose) |
|---|---|
| "search → price → book → ticket this end to end" | One availability query → **1.1** |
| "reconcile BSP, then refund, then update loyalty" | One BSP HOT-file reconciliation → **7.1** |
| "run the exchange flow (assess + reissue + collect)" | One pre-ticket ADM audit → **6.2** |
| any chain that hands output between ≥2 agents | profile read / apply-to-PNR → **8.1** |
| | mid-office PNR QC / TTL scan → **8.3** |

**Useful contrast (teach the model this):** Agent **5.5 Self-Service Rebooking** *also*
orchestrates two agents (1.1 + 5.1) internally — but it is a **specific, named flow**
("present priced rebooking alternatives"), so it is **5.5, not 9.1**. Internal fan-out ≠
general orchestration. The 9.1 signal is *the user asking for a multi-stage pipeline*,
not *an agent happening to call others*.

| Pair | A (specific) | B (9.1) | Boundary signal |
|---|---|---|---|
| 6.2↔9.1 | 6.2 ADM Prevention — "pre-ticketing audit: 9 checks to prevent ADMs" | 9.1 Orchestrator | One audit pass vs a pipeline that ends in ticketing |
| 7.1↔9.1 | 7.1 BSP Reconciliation — "matches agency records vs BSP HOT files" | 9.1 | One reconciliation vs a settlement chain |
| 8.1↔9.1 | 8.1 Traveler Profile — "preferences/docs/loyalty; apply-to-PNR" | 9.1 | Profile CRUD/prefill vs plan-price-book-for-traveler |
| 1.1↔9.1 | 1.1 Availability Search — "queries adapters in parallel, normalizes, sorts" | 9.1 | A search (even across many adapters) vs search→…→ticket |
| 8.3↔9.1 | 8.3 Mid-Office — "PNR quality checks, TTL monitoring" | 9.1 | One QC sweep vs an automated multi-stage nightly run |

---

## GROUP B — Booking/pricing cluster (the original 14 vs the new siblings)

| Pair | A | B | Boundary signal |
|---|---|---|---|
| 3.2↔3.6 | **3.2 PNR Builder** — "constructs GDS-ready PNR *commands* (Amadeus/Sabre/Travelport)" | **3.6 Order Management** — "order lifecycle: create/modify/cancel/list, status transitions" | Generating command *syntax* (3.2) vs acting on an *order object's lifecycle* (3.6) |
| 3.2↔3.3 | 3.2 PNR Builder | **3.3 PNR Validation** — "pre-ticketing validation, 13 checks" | Build the PNR (3.2) vs check an existing PNR is correct (3.3) |
| 3.2↔20.6 | 3.2 PNR Builder (flights/GDS) | **20.6 Hotel Modification** — "post-booking hotel changes" | Air PNR commands (3.2) vs hotel reservation change (20.6) |
| 3.1↔3.5 | **3.1 GDS/NDC Router** — "routes to correct channel by carrier/codeshare/NDC capability" | **3.5 API Abstraction** — "universal HTTP client: circuit breaker, retry, rate limit, IATA error normalization" | *Which channel* to use (3.1) vs *how to make the HTTP call* (3.5) |
| 3.1↔3.7 | 3.1 GDS/NDC Router | **3.7 Payment Processing** — "PCI-safe FOP builder + txn recorder" | Channel selection (3.1) vs collecting/recording payment (3.7) |
| 2.4↔3.7 | **2.4 Offer Builder** — "builds/caches/validates offers with TTL" | 3.7 Payment | Assemble & hold the priced offer (2.4) vs charge for it (3.7) |
| 2.4↔3.6 | 2.4 Offer Builder | 3.6 Order Management | Offer (pre-purchase artifact) vs order (committed lifecycle) |
| 3.8↔3.6 | **3.8 PNR Retrieval** — "retrieves a booking by *record locator* across adapters; read-only" | 3.6 Order Management | Single-locator fetch (3.8) vs order list/cancel/modify (3.6) |
| 3.8↔20.7 | 3.8 PNR Retrieval | **20.7 Confirmation Verification** — "cross-checks CRS↔PMS before arrival" | GDS retrieval (3.8) vs cross-system hotel verify (20.7) |
| 2.1↔3.3 | **2.1 Fare Rule** — "parses ATPCO rules (cat 1–20) to human-readable" | 3.3 PNR Validation | Read/decode fare *rules* (2.1) vs validate a *PNR* (3.3) |
| 2.1↔3.7 | 2.1 Fare Rule | 3.7 Payment | Rule interpretation vs payment |
| 4.1↔4.3 | **4.1 Ticket Issuance** — "ETR generation, conjunction tickets, BSP reporting" | **4.3 Void Agent** — "void within carrier window, BSP/ARC cut-off check" | Issue a ticket (4.1) vs void an issued ticket (4.3) |
| 4.1↔3.7 | 4.1 Ticket Issuance | 3.7 Payment | Issue the ETR vs record the FOP |
| 4.1↔3.3 | 4.1 Ticket Issuance | 3.3 PNR Validation | Issue vs confirm ticket-ready |

---

## GROUP C — Disruption / rebooking (5.x)

> Note: docs label 5.5 and 5.6 "Coming Soon (stub)", but the **code is implemented** with
> clear contracts. Authored from the code (the binding source). Doc status is stale — see
> Doc-drift finding.

| Pair | A | B | Boundary signal |
|---|---|---|---|
| 5.5↔5.1 | **5.5 Self-Service Rebooking** — "orchestrates 1.1+5.1 to *present priced alternatives*; does NOT execute the reissue" | **5.1 Change Management** — "Cat 31 voluntary-change *assessment*: fee, fare diff, residual" | Customer-facing list of priced options (5.5) vs back-office cost calc for one change (5.1) |
| 5.5↔5.2 | 5.5 Self-Service Rebooking | **5.2 Exchange/Reissue** — "*executes* reissue, GDS exchange command, residual/tax carryforward" | Present options (5.5) vs *do* the reissue (5.2) |
| 5.5↔5.3 | 5.5 Self-Service Rebooking | **5.3 Involuntary Rebook** — "carrier-initiated schedule change, EU261/US-DOT entitlements" | Passenger-initiated self-service (5.5) vs carrier-initiated reprotection (5.3) |
| 5.6↔3.4 | **5.6 Waitlist Management** — "passenger waitlist: add/clear/queryStatus/expire, priority scoring" | **3.4 Queue Management** — "*GDS PNR queue* monitoring/processing" | Passenger seat *waitlist* (5.6) vs GDS *work queue* of PNRs (3.4) — "queue" is the trap word |
| 5.6↔3.5 | 5.6 Waitlist Management | 3.5 API Abstraction | Waitlist state ops vs HTTP transport |
| 5.6↔3.7 | 5.6 Waitlist Management | 3.7 Payment | Waitlist clearance vs charging the cleared passenger |

---

## GROUP D — 9.x family + 9.x vs 8.x

| Pair | A | B | Boundary signal |
|---|---|---|---|
| 9.8↔9.9 | **9.8 Recommendation** — "accepts performance/routing audit reports, produces *recommendations*" | **9.9 Alert** — "queries EventStore, computes metrics vs thresholds, produces *alerts*" | Prescriptive "what to do" (9.8) vs "a threshold was breached" (9.9) |
| 9.7↔8.4 | **9.7 Routing Audit** — "analyses *routing decisions/outcomes* from EventStore; read-only" | **8.4 Reporting & Analytics** — "aggregates *transaction* data: volume, revenue, spend by traveler/dept" | Internal routing-quality analysis (9.7) vs business/financial reports (8.4) |
| 9.7↔9.4 | 9.7 Routing Audit | **9.4 Audit & Compliance** — "audit trail, SHA-256 hashing, PII redaction, GDPR/PCI/IATA flags" | Routing-decision audit (9.7) vs compliance/PII audit trail (9.4) |
| 8.5↔9.5 | **8.5 Duty of Care** — "locates travelers in active itineraries during disruptions, risk assessment" | **9.5 Plugin Manager** — "register/enable third-party agent plugins, capability discovery" | Traveler safety/location (8.5) vs platform plugin admin (9.5) — unrelated; lexical "manage" trap |
| **9.3↔9.9** | **9.3 Monitoring & Alerting** — "tracks *agent* health, latency p50/p95, error rates, SLA" | 9.9 Alert | **FLAG (partial overlap)** — see below |

---

## GROUP E — Reference (0.x) + Search (1.x)

| Pair | A | B | Boundary signal |
|---|---|---|---|
| 0.3↔0.6 | **0.3 Fare Basis Decoder** — "decodes fare basis: cabin, restrictions, AP, penalties" | **0.6 Currency & Tax Resolver** — "ISO 4217 currency + IATA tax/surcharge codes" | Fare basis string (0.3) vs currency/tax code (0.6) |
| 0.3↔3.3 | 0.3 Fare Basis Decoder | 3.3 PNR Validation | Decode a code (0.3) vs validate a PNR (3.3) |
| 0.1↔0.6 | **0.1 Airport/City Resolver** — "IATA/ICAO airport & city codes, multi-airport cities" | 0.6 Currency & Tax | Place code (0.1) vs money/tax code (0.6) |
| 1.8↔1.4 | **1.8 AI Travel Advisor** — "rule-based *recommendation* engine; preference-weighted scoring, ranked picks w/ explanations; **NOT an LLM**" | **1.4 Fare Shopping** — "multi-source fare *comparison*, class mapping, branded families" | "Best *for me* / recommend / rank" (1.8) vs "compare fares / show options" (1.4) |
| 1.1↔1.6 | 1.1 Availability Search | **1.6 Multi-Source Aggregator** — "aggregate, dedupe, rank across adapters" | Query availability (1.1) vs aggregate+dedupe results (1.6) |
| 1.1↔1.3 | 1.1 Availability Search | **1.3 Connection Builder** — "MCT validation, connection scoring, interline" | Find flights (1.1) vs build/validate connections (1.3) |
| 1.2/1.3/1.4↔1.5 | 1.2 Schedule / 1.3 Connection / 1.4 Fare Shopping | **1.5 Ancillary Shopping** — "baggage, seats, meals, lounge, wifi, priority" | Flights/fares/schedule vs *add-ons* (1.5) |

---

## GROUP F — Stale-label check (RELABEL vs TRAIN)

| Pair | Verdict | Reason (from contracts) |
|---|---|---|
| **1.7 → 20.2** | **TRAIN** | 20.2 Property Deduplication only *merges* 20.1's output ("takes raw multi-source hotel results from 20.1") — it **never performs search**. A hotel-search utterance routed to 20.2 is a true misroute. Disambiguation data produced. |
| **1.7 → 20.1** | **AMBIGUOUS / partial RELABEL — FLAG** | See below. |

### 1.7 ↔ 20.1 — FLAGGED (contracts do not resolve it)
- **1.7 Hotel & Car Search** (stage 1): "multi-adapter search aggregator … fans out to
  injected **hotel and car** adapters." Pattern mirrors 1.6.
- **20.1 Hotel Search Aggregator** (stage 20): "multi-source **hotel** availability across
  GDS hotel segments, direct APIs (Amadeus Hotel, Hotelbeds, Duffel Stays), channel
  managers." Feeds the 20.2→20.4 lodging pipeline.
- **Both independently claim hotel search. Neither contract declares a
  supersession/deprecation relationship.** So a definitive RELABEL is *not* authorized by
  the contracts.
- **What I *can* state firmly (and did encode):**
  - **Car-rental** utterances → **1.7** (no car agent exists in stage 20). Not a relabel.
  - **Dedup** → **20.2** (never search).
  - **Multi-source lodging-vertical hotel search** (named lodging sources / feeds the
    dedup→rate pipeline) → **20.1**.
- **What's MISSING (owner must add to the contracts, then the bench label follows):**
  An explicit ownership note answering: *Does 20.1 supersede 1.7's hotel role?* Options the
  owner should pick from and write down:
  1. **20.1 owns all hotel search; 1.7 is car-only now** → then relabel bench's
     hotel-only `1.7→20.1` cases to 20.1 and narrow 1.7's contract to cars.
  2. **1.7 is the flights-context combined entry; 20.1 is the lodging-vertical owner** →
     keep both, and the boundary is *context* (mixed-trip quick search vs dedicated
     lodging) — which is **not currently expressed in either contract** and so cannot be
     learned reliably until written.
  3. **1.7 is deprecated** → mark it and route all of 1.7 to 20.1 (+ a car agent).
  - Until one is chosen, bare "find a hotel for next weekend" is **genuinely undecidable**
    from the contracts and was deliberately **excluded** from `routing_truth.jsonl` (it
    would teach noise). Only the clearly-separable cases were encoded.

---

## RELABEL list (for the bench owner)

| Bench pair | Verdict | Action |
|---|---|---|
| 1.7 → 20.2 | TRAIN | Keep label as 1.7 (or 20.1 per below); 20.2 is dedup-only. Train against it. |
| 1.7 → 20.1 (hotel-only) | **RELABEL — but BLOCKED on owner decision** | Do **not** relabel yet. Resolve the 1.7/20.1 ownership question above first; the correct label is whichever the owner declares. Encoded only the unambiguous car→1.7, multi-source-lodging→20.1 cases. |
| All other A–E pairs | TRAIN | Genuine same-stage confusions; disambiguation data produced. |

No other "wrong" target in groups A–E is a newer agent that supersedes the original — they
are all genuine siblings, so all TRAIN (no relabels).

---

## Ambiguity flags (what's missing from the contracts)

1. **1.7 vs 20.1 hotel-search ownership** — no supersession declared. (Details above.)
   *Blocks* a clean bench relabel and a clean "find a hotel" routing decision.
2. **9.3 Monitoring & Alerting vs 9.9 Alert** — both "alert." Best contract-grounded
   boundary: **9.3 = live agent-infra health/latency/SLA**; **9.9 = generic threshold
   alerting over recorded EventStore events**. Residual overlap: an utterance like "alert
   me when an agent degrades" sits on the seam (agent-health *and* a threshold alert).
   **Missing:** whether 9.3's alerting is meant to be subsumed by 9.9, or 9.3 owns
   *agent-health* alerts while 9.9 owns *business/event* alerts. Encoded only clearly-
   separable cases (agent latency/SLA → 9.3; event-metric thresholds → 9.9).

---

## Doc-drift finding (cosmetic — NOT a relabel, fix separately)

The 9.x platform agents have **stale doc identifiers** that disagree with the binding
`readonly id`:

| Source file | JSDoc header says | `readonly id` (binding truth) | Name |
|---|---|---|---|
| `packages/agents-platform/src/routing-audit/index.ts` | "Agent 9.6" | **9.7** | Routing Audit |
| `packages/agents-platform/src/recommendation/index.ts` | "Agent 9.7" | **9.8** | Recommendation |
| `packages/agents-platform/src/alert/index.ts` | "Agent 9.8" | **9.9** | Alert |

Additionally, `docs/agents/README.md` lists only 9.1–9.5 and **omits 9.6 (Performance
Audit), 9.7, 9.8, 9.9** entirely.

**Verified cosmetic / not load-bearing** (read-only grep during authoring):
- No `*.json` / `*.jsonl` / registry file keys off the stale `9.6–9.9` ids.
- Canonical accessor is `readonly id` (`packages/core/src/types/agent.ts:26`); the
  Orchestrator references agents by their `readonly id` string.
- ⇒ The drift never reached the model, bench, or any corpus. This routing truth (authored
  against `readonly id`) is unaffected.

**Recommended follow-up (separate small commit, out of scope here):** correct the three
JSDoc headers to match `readonly id`, and add 9.6–9.9 to `docs/agents/README.md`. Also
update the stage-5 docs that mark **5.5/5.6 as "Coming Soon (stub)"** — the code is
implemented. Keeping this out of the data deliverable avoids scope-spread.
