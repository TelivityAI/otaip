# OTAIP Production Definition of Done

Binary scorecard for open-core money-path readiness. Catalog growth (more agents/adapters) does not move this bar.

**PASS = default-enforced on the normal money-path API.** A class that exists but is optional or bypassable is FAIL / PARTIAL — see [PRODUCTION_DOD_SCORECARD.md](./PRODUCTION_DOD_SCORECARD.md).

**Current score: see [PRODUCTION_DOD_SCORECARD.md](./PRODUCTION_DOD_SCORECARD.md).**

## Criteria (all must PASS)

| # | Criterion | PASS only if |
|---|---|---|
| 1 | Mutations safe | Book/ticket/cancel not blindly retried after ambiguous failure on the **default** adapter/Duffel path; `OUTCOME_UNKNOWN` → reconcile via `getBookingStatus` / `getOrder`; fault-injection tests |
| 2 | Money state survives crash | Pay→confirm + order durable with CAS/OCC (not plain overwrite); same idempotency key → one supplier effect; replay returns prior result |
| 3 | Persistence can do #2 | CAS / command uniqueness / OCC APIs; reference durable impl; **live mode refuses** irreversible ops on in-memory/mock **by default** |
| 4 | Supplier backpressure real | `RateLimiter` + circuit breaker **on by default** on live adapter HTTP path (including Duffel); 429 handling |
| 5 | Live tickets not invented | Live mode blocks hash/mock serials; ticket identity from supplier response |
| 6 | Irreversible LLM gate has teeth | Bound approval **before** side effects; HMAC + single-use in live mode; uncontracted mutations blocked |
| 7 | Reversal works | Cancel via same ledger/idempotency rules; void/refund fail closed unless capability exists (no silent cancel alias); sandbox tests |
| 8 | Ops see/stop damage | Failure-by-stage + unknown-outcome age on the mutation path; kill switch stops new mutations |

## Key modules

| Area | Location |
|---|---|
| CAS persistence | `@otaip/core` `CompareAndSwapPersistenceAdapter`, `InMemoryVersionedAggregateStore`, `FileCompareAndSwapPersistenceAdapter` |
| Command store / effect ledger | `@otaip/core` `InMemoryCommandStore`, `InMemoryEffectLedger` |
| Live safety / kill switch | `@otaip/core` `LiveSafetyMode`, `MutationKillSwitch` |
| Bound approvals | `@otaip/core` `issueBoundApprovalToken`, `createBoundApprovalPolicy` |
| Op classification + mutations | `@otaip/connect` `classifyAdapterOperation`, `MutationExecutor`, `executeReversal` |
| Adapter resilience | `@otaip/connect` `BaseAdapter` (rate limit, circuit breaker, no unsafe auto-retry) |
| Durable pay-confirm | `@otaip/agents-booking` `DurablePaymentConfirmationStateMachine` |
| PNR retrieval ports | `@otaip/agents-booking` `PnrRetrieval` + `bookingStatusPort` / `orderPort` |
| Live ticket guard | `@otaip/agents-ticketing` `issueTickets(..., { liveMode })` + `supplier_ticket_numbers` |

## Secrets

Never commit API keys, live credentials, or payment secrets. Inject via environment in the deploying application.
