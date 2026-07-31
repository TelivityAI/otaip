# Production DoD Scorecard

**PASS means default-enforced on the normal money-path API — not “a class exists if you wire it.”**

| Enforcement | Meaning |
|---|---|
| `default` | Normal call path cannot bypass the control |
| `opt-in` | Control exists but callers can skip it |
| `unwired` | Primitive only; not on live paths |

Covered money-path surfaces: Connect `createAdapter` (including HAIP), Duffel, Hotelbeds, orchestrator live approvals.

| # | Criterion | Status | Enforcement | Evidence |
|---|---|---|---|---|
| 1 | Mutations safe | PASS | default | `GuardedConnectAdapter` via `createAdapter()`; Duffel/Hotelbeds/HAIP mutations via `MoneyPathExecutor` + `fetchOnce` on unsafe Hotelbeds/Duffel paths; HAIP registered in `createAdapter`. Drills: `packages/adapters/duffel/src/__tests__/money-path.test.ts`, `packages/adapters/hotelbeds/src/__tests__/money-path.test.ts`, `packages/connect/src/suppliers/haip/__tests__/money-path.test.ts`, `packages/connect/src/__tests__/guarded-adapter.test.ts` — 503/timeout → one wire call; replay → zero additional; `OUTCOME_UNKNOWN` |
| 2 | Money state survives crash | PASS | default | Effect ledger replay + concurrent idempotency; `listUnresolved` includes aged `pending` crash-left records (`money-path-executor.test.ts`). Live refuses ephemeral ledgers. |
| 3 | Persistence can do #2 | PASS | default | Store-declared `durability` on `EffectLedger` / CAS adapters; `InMemory*=ephemeral`, `File*=durable`; `MoneyPathExecutor` reads ledger durability and rejects ephemeral→durable upgrade; `FileEffectLedger` live book drill in `money-path-executor.test.ts` |
| 4 | Supplier backpressure real | PASS | default | `BaseAdapter` RL+CB on by default; Duffel/Hotelbeds RL+CB on `request()`; `RateLimiter` serializes concurrent waiters — `rate-limiter.test.ts` (10@limit1) |
| 5 | Live tickets not invented | PASS | default | `issueTickets` liveMode guard; example OTA Duffel path uses order documents only (no synthetic serials in live) |
| 6 | Irreversible LLM gate has teeth | PASS | default | `action_class` before `execute` for mutations; tokens use `createHmac('sha256')` with `v1.` prefix (`bound-approval.test.ts`); `CasBoundApprovalTokenStore` durable single-use; live orchestrator refuses ephemeral token store; forged/legacy-hash-concat/replay-across-CAS-instances/expired/wrong-hash rejected (`approval-before-execute.test.ts`, `bound-approval.test.ts`) |
| 7 | Reversal works | PASS | default | `executeReversal` requires shared `MutationExecutor` (no `liveMode:false` fresh-ledger default); `void`/`refund` fail closed; cancel idempotent across shared executor (`mutation-executor.test.ts`); Duffel flight cancel / Hotelbeds activity+transfer cancel refuse rather than invent |
| 8 | Ops see/stop damage | PASS | default | Process-global `MutationOpsCollector` + kill switch on `MoneyPathExecutor`; `effectType`→`BookingFailureStage` 1:1 (refund→`refund`); env `OTAIP_MUTATION_KILL_SWITCH=1`; orchestrator uses same switch |

**Score: 8 / 8 PASS** under **default-enforced** definition (library drills + fault injection).

Still not a turnkey OTA/TMC: no real credentials in repo; Duffel flight cancel unsupported by design; Hotelbeds activity/transfer cancel fail closed pending DOMAIN_QUESTION; Connect `BookingPipeline`/`PaymentHandoff` remain labeled stubs. Live supplier credentials remain deployer-owned.
