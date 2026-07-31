# Production DoD Scorecard

**PASS means default-enforced on the normal money-path API — not “a class exists if you wire it.”**

| Enforcement | Meaning |
|---|---|
| `default` | Normal call path cannot bypass the control |
| `opt-in` | Control exists but callers can skip it |
| `unwired` | Primitive only; not on live paths |

| # | Criterion | Status | Enforcement | Evidence |
|---|---|---|---|---|
| 1 | Mutations safe | PASS | default | `GuardedConnectAdapter` via `createAdapter()`; Duffel `book`/`bookCar`/`cancelCar` via `MoneyPathExecutor` + `fetchOnce` on unsafe POSTs; drills in `packages/adapters/duffel/src/__tests__/money-path.test.ts`, `packages/connect/src/__tests__/guarded-adapter.test.ts` |
| 2 | Money state survives crash | PASS | default* | Effect ledger replay + concurrent idempotency; durable SM uses `compareAndSet` OCC (`DurablePaymentConfirmationStateMachine`); *live mode refuses ephemeral stores |
| 3 | Persistence can do #2 | PASS | default | CAS APIs + `FileCompareAndSwapPersistenceAdapter`; `MoneyPathExecutor` / live mode refuse ephemeral/mock irreversible ops |
| 4 | Supplier backpressure real | PASS | default | `BaseAdapter` rate limiter on by default + CB; Duffel per-credential RL+CB on HTTP path |
| 5 | Live tickets not invented | PASS | default | `issueTickets` liveMode guard; example OTA Duffel path uses order documents only (no synthetic serials in live) |
| 6 | Irreversible LLM gate has teeth | PASS | default | `action_class` **before** `execute` for mutations; live mode requires HMAC secret + single-use consume; shape-only banned in live (`approval-before-execute.test.ts`) |
| 7 | Reversal works | PASS | default | `cancel` via executor; `void`/`refund` **fail closed** (`UnsupportedReversalError`) — no cancel alias; Duffel flight cancel refuses |
| 8 | Ops see/stop damage | PASS | default | `MutationOpsCollector` + process kill switch wired into `MoneyPathExecutor`; env `OTAIP_MUTATION_KILL_SWITCH=1`; orchestrator uses same switch |

**Score: 8 / 8 PASS** under **default-enforced** definition (library drills + fault injection).

Still not a turnkey OTA/TMC: no real credentials in repo, Duffel flight cancel unsupported by design, Connect `BookingPipeline`/`PaymentHandoff` remain labeled stubs. Live supplier credentials remain deployer-owned.
