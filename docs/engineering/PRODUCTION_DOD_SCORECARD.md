# Production DoD Scorecard

**PASS means default-enforced on the normal money-path API — not “a class exists if you wire it.”**

| Enforcement | Meaning |
|---|---|
| `default` | Normal call path cannot bypass the control |
| `opt-in` | Control exists but callers can skip it |
| `unwired` | Primitive only; not on live paths |

Covered money-path surfaces: Connect `createAdapter` (TripPro/Sabre/Navitaire/Amadeus/HAIP), Duffel, Hotelbeds, orchestrator live approvals, MCP mutation tools in live mode.

| # | Criterion | Status | Enforcement | Evidence |
|---|---|---|---|---|
| 1 | Mutations safe | PASS | default | `GuardedConnectAdapter` via `createAdapter()` (HAIP self-guarded); Duffel/Hotelbeds/HAIP/`MoneyPathExecutor`; TripPro SOAP ticket/cancel via `fetchOnce`; Amadeus cancel rethrows ambiguous errors. Drills: `duffel/.../money-path.test.ts`, `hotelbeds/.../money-path.test.ts`, `haip/.../money-path.test.ts`, `trippro/.../money-path.test.ts`, `amadeus/.../cancel-money-path.test.ts` — 503 → one wire call; replay → zero; `OUTCOME_UNKNOWN` |
| 2 | Money state survives crash | PASS | default | Effect ledger replay; `listUnresolved` includes aged `pending`; live refuses ephemeral ledgers (`money-path-executor.test.ts`) |
| 3 | Persistence can do #2 | PASS | default (single-host) | Store-declared durability; reject ephemeral→durable upgrade; `FileEffectLedger` live book; File CAS exclusive lockfile around RMW (`cas-persistence.test.ts` flock tests). **Caveat:** File CAS is single-host durable reference — not a distributed multi-region DB; multi-node deployers inject their own CAS. |
| 4 | Supplier backpressure real | PASS | default | `BaseAdapter` RL+CB on by default; Duffel/Hotelbeds RL+CB on `request()`; HAIP mutations go through `withRetry` (unsafe → maxRetries 0) so RL+CB engage; TripPro cancel via `withRetry`; RateLimiter serializes waiters — `rate-limiter.test.ts` (10@limit1), `haip/.../money-path.test.ts` (breaker opens) |
| 5 | Live tickets not invented | PASS | default | `issueTickets` liveMode guard; Duffel maps order documents only |
| 6 | Irreversible LLM gate has teeth | PASS | default | Orchestrator: `createHmac` + `v1.` + durable single-use; live refuses ephemeral token store. MCP live: `create_booking`/`request_ticketing`/`cancel_booking` require consume before adapter (`mcp-live-approval.test.ts`) |
| 7 | Reversal works | PASS | default | `executeReversal` requires shared executor; void/refund fail closed; Amadeus ambiguous cancel not ledger-succeeded; Duffel flight / Hotelbeds activity+transfer cancel refuse |
| 8 | Ops see/stop damage | PASS | default | Process-global `MutationOpsCollector` + kill switch; `effectType`→stage 1:1; `OTAIP_MUTATION_KILL_SWITCH=1` |

**Score: 8 / 8 PASS** under **default-enforced** definition (library drills + fault injection), with File CAS scoped as single-host durable reference.

Still not a turnkey OTA/TMC: no real credentials in repo; Duffel flight cancel unsupported by design; Hotelbeds activity/transfer cancel fail closed pending DOMAIN_QUESTION; Connect `BookingPipeline`/`PaymentHandoff` remain labeled stubs. Live supplier credentials and multi-node CAS remain deployer-owned.
