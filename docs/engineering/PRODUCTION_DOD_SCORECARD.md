# Production DoD Scorecard

**PASS means default-enforced on the normal money-path API — not “a class exists if you wire it.”**

OTAIP is a **platform** for building OTA / TMC / airline distribution stacks. This scorecard measures **platform money-path readiness** for builders — not whether the repo contains a finished consumer OTA.

| Enforcement | Meaning |
|---|---|
| `default` | Normal call path cannot bypass the control |
| `opt-in` | Control exists but callers can skip it |
| `unwired` | Primitive only; not on live paths |

Covered money-path surfaces: Connect `createAdapter` (TripPro/Sabre/Navitaire/Amadeus/HAIP), Duffel, Hotelbeds, orchestrator live approvals, MCP mutation tools in live mode.

| # | Criterion | Status | Enforcement | Evidence |
|---|---|---|---|---|
| 1 | Mutations safe | PASS | default | `createAdapter()` → `GuardedConnectAdapter` (HAIP self-guarded); live refuses raw Connect adapters (`live-refuse-raw-adapter.test.ts`). Drills: Sabre/Navitaire/TripPro/Amadeus/HAIP/Duffel/Hotelbeds money-path tests — 503 → one wire; replay → zero; `OUTCOME_UNKNOWN` |
| 2 | Money state survives crash | PASS | default | Effect ledger replay; `listUnresolved` includes aged `pending`; live refuses ephemeral ledgers (`money-path-executor.test.ts`) |
| 3 | Persistence can do #2 | PASS | default (single-host) | Store-declared durability; `FileEffectLedger` + File CAS lockfile (`cas-persistence.test.ts`). **Reference store:** single-host File CAS — multi-node deployers inject their own CAS |
| 4 | Supplier backpressure real | PASS | default | `BaseAdapter` RL+CB on by default; Duffel/Hotelbeds RL+CB on `request()`; HAIP/TripPro mutations via `withRetry` (unsafe → maxRetries 0) — `rate-limiter.test.ts`, `haip/.../money-path.test.ts` |
| 5 | Live tickets not invented | PASS | default | `issueTickets` liveMode guard; Duffel maps order documents only |
| 6 | Irreversible LLM gate has teeth | PASS | default | Orchestrator HMAC + durable single-use. MCP live: no tmpdir fallback; requires inject or `OTAIP_MCP_APPROVAL_STORE_PATH`; tokens bind via `mcpMutationApprovalInput(tool, args)` so ticket≠cancel; restart-replay refuses consumed jti (`mcp-live-approval.test.ts`) |
| 7 | Reversal works | PASS | default | `executeReversal` shared executor; void/refund fail closed without capability; Duffel air cancel via order_cancellations confirm (once); Hotelbeds activity/transfer hard cancel once (`money-path` / adapter cancel drills) |
| 8 | Ops see/stop damage | PASS | default | Durable damage visibility = `FileEffectLedger.listUnresolved` across fresh instance (`file-ledger-crash-visibility.test.ts`) + `OTAIP_MUTATION_KILL_SWITCH=1`. `MutationOpsCollector` is in-process only |

**Score: 8 / 8 PASS** under **default-enforced platform money-path** definition (fault-injection drills + single-host File CAS reference).

**Platform ready for builders.** Product app (OTA/TMC/airline UX), live credentials, PSP checkout, and multi-node CAS are deployer-owned on top of OTAIP. Connect `BookingPipeline` / `PaymentHandoff` remain labeled stubs (optional product-layer orchestration, not required for adapter money-path).
