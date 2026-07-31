# Production DoD Scorecard

Criteria text only. Update when drills land.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Mutations safe | PASS | `MutationExecutor` + `BaseAdapter` disableUnsafeAutoRetry; tests in `packages/connect/src/__tests__/mutation-executor.test.ts`, `base-adapter-resilience.test.ts` |
| 2 | Money state survives crash | PASS | `DurablePaymentConfirmationStateMachine`, effect ledger replay, concurrent idempotency tests |
| 3 | Persistence can do #2 | PASS | CAS APIs + `FileCompareAndSwapPersistenceAdapter` + `LiveSafetyMode` |
| 4 | Supplier backpressure real | PASS | `RateLimiter` + `CircuitBreaker` on `BaseAdapter`; 429 in `fetchWithTimeout` |
| 5 | Live tickets not invented | PASS | `issueTickets` liveMode guard + `supplier_ticket_numbers` |
| 6 | Irreversible LLM gate has teeth | PASS | Bound approval default policy; `uncontracted_mutation` orchestrator reason |
| 7 | Reversal works | PASS | `executeReversal` via `MutationExecutor` |
| 8 | Ops see/stop damage | PASS | `MutationOpsCollector`, `listUnknown`, `MutationKillSwitch` |

**Score: 8 / 8 PASS** (library drills). Live supplier credentials remain deployer-owned and must not be committed.
