# Failure Modes by Stage

Expected failure scenarios, what the agents return, and what consuming applications should do.

## Stage 1 — Search

| Failure | Agent behavior | Consumer action |
|---------|---------------|----------------|
| Adapter timeout | Returns partial results from responding adapters | Show available results, indicate some sources unavailable |
| All adapters down | Returns empty results with `confidence: 0` | Show "no results" with retry option |
| Invalid search parameters | Throws `AgentInputValidationError` | Display validation error to user |
| Supplier rate limit | Agent 3.5 circuit breaker opens | Retry after backoff, consider caching |

## Stage 2 — Pricing

| Failure | Agent behavior | Consumer action |
|---------|---------------|----------------|
| Fare rule not found | Returns result with `confidence < 0.5` and warning | Flag to user, offer manual override |
| Tax calculation gap | Returns partial tax with warning listing missing jurisdictions | Display "estimated taxes" disclaimer |
| Offer expired (TTL) | Agent 2.4 returns null for expired offers | Re-search and re-price |
| Currency conversion unavailable | Throws `AgentDataUnavailableError` | Show price in original currency only |

## Stage 3 — Booking

| Failure | Agent behavior | Consumer action |
|---------|---------------|----------------|
| PNR creation failure | Throws with GDS error code in metadata | Display booking failure, suggest retry |
| Queue full | Agent 3.4 returns degraded status | Process synchronously instead of queuing |
| TTL expiry during booking | Agent 3.3 validation flags TTL issue | Re-price before booking |
| Payment rejection | Agent 3.7 returns failure with FOP error | Prompt for alternative payment method |

## Stage 4 — Ticketing

| Failure | Agent behavior | Consumer action |
|---------|---------------|----------------|
| Ticket issuance rejection | Returns error with airline rejection reason | Escalate to manual ticketing |
| Void window expired | Agent 4.3 refuses void operation | Route to exchange or refund flow |
| EMD issuance failure | Returns error with RFIC/RFISC mismatch details | Retry with corrected codes |

## Stage 5 — Exchange

| Failure | Agent behavior | Consumer action |
|---------|---------------|----------------|
| No reissue fare available | Returns error with fare eligibility details | Inform user, suggest alternative dates |
| Waiver code without typed effect | Fails closed (`waiver_effect` required) | Supply `waiver_effect` per docs/knowledge-base/waiver-typology.md |
| Involuntary rebook — no flights available | Returns empty reprotection options | Escalate to manual reprotection |

## Stage 6 — Settlement

| Failure | Agent behavior | Consumer action |
|---------|---------------|----------------|
| Refund rejected by carrier | Returns rejection with reason code | Review fare rules, escalate if involuntary |
| ADM received | Agent 6.3 logs with dispute deadline | Review within 15-day window |
| Commission dispute | Agent 7.3 flags variance | Review against contracted rates |

## Stage 7 — Reconciliation

| Failure | Agent behavior | Consumer action |
|---------|---------------|----------------|
| HOT file parse failure | Throws `AgentDataUnavailableError` with format details | Check file format, contact BSP |
| Discrepancy detected | Returns discrepancy list with match details | Review and dispute within deadline |
| Remittance deadline approaching | Returns warning with days remaining | Prioritize resolution |

## General patterns

All agents follow these conventions:
- **Input validation errors**: `AgentInputValidationError` with field name and reason
- **External data unavailable**: `AgentDataUnavailableError` with source name
- **Not initialized**: `AgentNotInitializedError` — call `initialize()` first
- **Confidence scoring**: Low confidence (< 0.5) indicates uncertain results that should be flagged
- **Warnings array**: Non-fatal issues are surfaced in `output.warnings[]`
