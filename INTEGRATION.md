# OTAIP Integration Guide

How to run a contracted OTAIP agent against a **live distribution supplier** through
the six pipeline gates, and how to read the run's **execution + gate trace** back by id.

This guide covers exactly one proven path, end to end:

> **Agent 1.1 — Availability Search → Duffel NDC sandbox → real offers → durable trace**

It is implemented in a single caller-facing package, [`@otaip/integration`](packages/integration),
which wires the **real** components together with **no parallel execution or validation path**:

```
runAvailabilitySearch()                    ← packages/integration
  └─ AvailabilitySearch (Agent 1.1)        ← @otaip/agents-search   (unchanged)
       └─ DuffelAdapter (DistributionAdapter) ← @otaip/adapter-duffel (live Duffel REST)
  └─ PipelineOrchestrator.runAgent()       ← @otaip/core            (the six gates)
       └─ availabilitySearchContract        ← @otaip/agents-search   (Zod + semantic gate)
       └─ ReferenceAgentDataProvider        ← @otaip/agents-reference (OurAirports data)
  └─ agent.executed + adapter.health events → EventStore (in-memory or FileEventStore)
```

The gates, event types, and unified output model are the existing ones in `@otaip/core`.
The integration package only adds the glue function, a durable file-backed `EventStore`,
and a by-id trace reader.

---

## 1. Adapter execution — run Agent 1.1 via Duffel

**Mechanism:** in-process (package import). There is no HTTP server in this path.

```ts
import { runAvailabilitySearch, getRunTrace } from '@otaip/integration';

const result = await runAvailabilitySearch(
  {
    origin: 'JFK',          // IATA, 3 letters
    destination: 'LHR',     // IATA, 3 letters
    departure_date: '2026-07-23', // ISO YYYY-MM-DD, must be in the future
    passengers: [{ type: 'ADT', count: 1 }],
    cabin_class: 'economy', // economy | premium_economy | business | first
    currency: 'GBP',        // optional ISO 4217 (see sandbox note below)
    max_results: 3,
    sort_by: 'price',
  },
  {
    duffelApiKey: process.env.DUFFEL_API_KEY, // see "Credentials" below
    // eventStore, reference, adapter, now are all optional — sensible defaults
  },
);

if (result.ok) {
  console.log(result.output.offers.length, 'offers'); // unified SearchOffer[]
} else {
  console.error(result.failure.reason, result.failure.issues); // gate rejection
}
```

### Input shape — `AvailabilitySearchInput`

The input is Agent 1.1's own contract input (`@otaip/agents-search`), validated by the
`schema_in` Zod gate and the `semantic_in` gate before the adapter is ever called:

| Field            | Type                                   | Required | Notes |
|------------------|----------------------------------------|----------|-------|
| `origin`         | `string` (len 3)                       | yes      | resolved against reference data (semantic gate) |
| `destination`    | `string` (len 3)                       | yes      | must differ from `origin` |
| `departure_date` | `string` `YYYY-MM-DD`                  | yes      | must not be in the past (semantic gate) |
| `return_date`    | `string` `YYYY-MM-DD`                  | no       | if set, must be ≥ `departure_date` |
| `passengers`     | `{ type: 'ADT'\|'CHD'\|'INF'\|…; count: number }[]` | yes | ≥ 1 |
| `cabin_class`    | `'economy'\|'premium_economy'\|'business'\|'first'` | no | |
| `currency`       | `string` (len 3)                       | no       | ISO 4217 |
| `max_connections`, `direct_only`, `max_results`, `sort_by`, `sort_order`, `sources` | various | no | see [types.ts](packages/agents/search/src/availability-search/types.ts) |

### Credentials-injection contract

The Duffel API key is read **once, at adapter construction**, from either:

1. **`options.duffelApiKey`** passed to `runAvailabilitySearch`, **or**
2. **`process.env.DUFFEL_API_KEY`** if (1) is omitted (the `DuffelAdapter` default).

A `duffel_test_…` key targets the **sandbox**; a `duffel_live_…` key targets **production**.
The environment is determined by the key prefix, not by code.

**The key is server-side only.** It is never written to an event, a trace, a log line, or
the returned payload. The trace contains only `OtaipEvent` objects (gate booleans, timing,
adapter id, status) — there is no field that can carry a credential or PII. The offline test
[`run-search.test.ts`](packages/integration/src/__tests__/run-search.test.ts) asserts the
on-disk trace file never matches `/duffel_test_|duffel_live_|Bearer/`.

To target a different supplier or a recorded-fixture server, inject a pre-built adapter:
`runAvailabilitySearch(input, { adapter: myAdapter })` (then `duffelApiKey` is ignored).

### Output shape — `RunSearchResult`

```ts
interface RunSearchResult {
  sessionId: string;                  // use this to read the trace back
  ok: boolean;                        // true ⇔ every gate passed
  output?: AvailabilitySearchOutput;  // present iff ok (the unified model)
  failure?: { reason: string; failureClass: 'infra'|'execution'|'validation'; issues: SemanticIssue[] };
  trace: RunTrace;                    // also durably in eventStore
  eventStore: EventStore;             // the store this run wrote to
}
```

`output` is the existing unified output model — `AvailabilitySearchOutput` with
`offers: SearchOffer[]` (`offer_id`, `source`, `itinerary`, `price`, …), `total_raw_offers`,
`source_status[]`, `truncated`. The Duffel adapter normalizes the raw NDC response into this
model; nothing here forks the shape.

`failureClass` distinguishes an infrastructure/setup problem (`infra`) from a real agent
execution error (`execution`) from a genuine contract-gate rejection (`validation`) — so a
caller never mistakes a wiring bug for a data/model rejection.

> **Runtime note:** the default `ReferenceAgentDataProvider` loads airport data from
> `${process.cwd()}/data/reference/airports.json`. Run `pnpm run data:download` once, and
> invoke from the **repo root** (or pass your own `reference` provider). If the data is
> missing, the run fails at the semantic gate, not silently.

---

## 2. Trace read — fetch a run's trace by id

**Mechanism:** in-process API over the same `EventStore` the run wrote to.

```ts
import { getRunTrace, FileEventStore } from '@otaip/integration';

// Durable: a DIFFERENT process can re-open the same file and read the trace by id.
const store = await FileEventStore.open('./traces/run.jsonl');
const result = await runAvailabilitySearch(input, { eventStore: store });

// …later, anywhere with access to the file:
const reopened = await FileEventStore.open('./traces/run.jsonl');
const trace = await getRunTrace(reopened, result.sessionId);
```

`getRunTrace(store, sessionId)` is a pure projection over the event store (no re-execution).
Auth for the trace is **the same as filesystem access to the JSONL file** (or to whichever
`EventStore` backend you supply) — there is no separate auth surface in this in-process path.

### Trace response shape — `RunTrace`

```ts
interface RunTrace {
  sessionId: string;
  outcome: 'ok' | 'rejected' | 'empty';
  agentExecutions: {
    agentId: string; success: boolean; confidence: number; durationMs: number;
    timestamp: string; gateResults: { gate: string; passed: boolean }[];
  }[];
  adapterHealth: { adapterId: string; status: 'healthy'|'degraded'|'unhealthy'; latencyMs?: number; timestamp: string }[];
  events: OtaipEvent[]; // raw, chronological — the durable source of truth
}
```

The underlying events are the existing core types: `agent.executed` (gate results + timing,
emitted exactly as the `agentToTool` bridge does) and `adapter.health` (derived from the real
search's per-source status). `EventStore.query({ sessionId })` / `.aggregate()` are the
existing core APIs; `FileEventStore` reuses core's `InMemoryEventStore` for them and only adds
durable JSONL persistence.

---

## 3. Package versions & environment

All packages are workspace version **`0.7.2`** (Node **≥ 24.14.1**, pnpm 10):

| Package                  | Role |
|--------------------------|------|
| `@otaip/integration@0.7.2` | the entry point in this guide (new) |
| `@otaip/core@0.7.2`        | gates, event types, unified model |
| `@otaip/adapter-duffel@0.7.2` | live Duffel REST adapter |
| `@otaip/agents-search@0.7.2`  | Agent 1.1 + contract |
| `@otaip/agents-reference@0.7.2` | airport/airline reference provider |

**Environment variables a caller must set:**

| Var | Required | Purpose |
|-----|----------|---------|
| `DUFFEL_API_KEY` | yes (unless `options.duffelApiKey` is passed) | Duffel token; `duffel_test_…` = sandbox, `duffel_live_…` = production |

One-time data setup: `pnpm run data:download` (populates `data/reference/` from OurAirports;
gitignored). No other new env vars are introduced.

### Reproduce the proof yourself

```bash
pnpm install
pnpm run data:download                     # one-time reference data
export DUFFEL_API_KEY=duffel_test_xxx      # your sandbox key
pnpm exec tsx packages/integration/scripts/duffel-search.ts   # run from repo root
```

Source: [`scripts/duffel-search.ts`](packages/integration/scripts/duffel-search.ts).

---

## 4. Sandbox proof (real Duffel sandbox, keys redacted)

Captured **2026-06-23** against `https://api.duffel.com` with a `duffel_test_…` key
(`live_mode: false`). Route **JFK → LHR**, `2026-07-23`, 1 ADT, economy.

### 4a. Request the adapter POSTs to `POST /air/offer_requests?return_offers=true`

```json
{
  "data": {
    "slices": [{ "origin": "JFK", "destination": "LHR", "departure_date": "2026-07-23" }],
    "passengers": [{ "type": "adult" }],
    "cabin_class": "economy",
    "return_offers": true
  }
}
```

Headers (key redacted): `Authorization: Bearer duffel_test_***REDACTED***`,
`Duffel-Version: v2`, `Content-Type: application/json`.

### 4b. Real Duffel response (first offer, trimmed — `live_mode: false` confirms sandbox)

```json
{
  "offer_request_id": "orq_0000B7dFlto81bmCx4mQXw",
  "offer": {
    "id": "off_0000B7dFlu2f9ZP1g9a2CY",
    "total_amount": "215.74",
    "total_currency": "USD",
    "base_amount": "182.83",
    "tax_amount": "32.91",
    "live_mode": false,
    "slices": [{
      "origin": "JFK", "destination": "LHR", "duration": "PT7H58M",
      "segments": [{
        "marketing_carrier": "ZZ", "flight_number": "7611",
        "origin": "JFK", "destination": "LHR",
        "departing_at": "2026-07-23T17:01:00", "arriving_at": "2026-07-24T05:59:00",
        "cabin": "economy"
      }]
    }]
  },
  "total_offers": 168
}
```

### 4c. Normalized output via `runAvailabilitySearch` (gates PASS, 168 raw offers → top 3)

```
Gate outcome: PASS (all gates)
Session id:   sess_mqqxj2pe_bsunoc
Raw offers:   168   |   returned: 3

  1. off_0000B7dF1KBJAIvVkG0qB8  BA0107  JFK→LHR  dep 2026-07-23T17:01:00  215.15 USD  (0 stop(s), 478m)
  2. off_0000B7dF1KAxBcdvj9qYcs  ZZ7611  JFK→LHR  dep 2026-07-23T17:01:00  228.95 USD  (0 stop(s), 478m)
  3. off_0000B7dF1KBJAIvVkG0qBB  IB3177  JFK→LHR  dep 2026-07-23T17:01:00  229.96 USD  (0 stop(s), 478m)

source_status: [{ "source": "duffel", "success": true, "offer_count": 168, "response_time_ms": 2054 }]
```

> **Sandbox note (honest):** `currency: 'GBP'` was requested but the Duffel sandbox returned
> offers in **USD**. The unified model faithfully reports whatever the supplier returns; OTAIP
> does not coerce it. `ZZ` is Duffel's sandbox test airline ("Duffel Airways"); real carriers
> (BA, IB) also appear because the sandbox blends fixture and live-schedule data.

### 4d. Real emitted trace for that run (durable JSONL, read back by session id)

The exact two lines written to `traces/duffel-jfk-lhr-2026-07-23.jsonl` — no secrets, no PII:

```json
{"eventId":"evt_mqqxj4aj_1","type":"agent.executed","timestamp":"2026-06-23T17:39:50.779Z","sessionId":"sess_mqqxj2pe_bsunoc","agentId":"1.1","inputHash":"6fcd2f57","confidence":1,"durationMs":2057,"success":true,"gateResults":[{"gate":"intent_lock","passed":true},{"gate":"schema_in","passed":true},{"gate":"semantic_in","passed":true},{"gate":"cross_agent","passed":true},{"gate":"execute","passed":true},{"gate":"schema_out","passed":true},{"gate":"confidence","passed":true},{"gate":"action_class","passed":true}]}
{"eventId":"evt_mqqxj4ak_2","type":"adapter.health","timestamp":"2026-06-23T17:39:50.780Z","sessionId":"sess_mqqxj2pe_bsunoc","adapterId":"duffel","status":"healthy","latencyMs":2054}
```

`getRunTrace(store, 'sess_mqqxj2pe_bsunoc')` projects this into:

```json
{
  "sessionId": "sess_mqqxj2pe_bsunoc",
  "outcome": "ok",
  "agentExecutions": [{
    "agentId": "1.1", "success": true, "confidence": 1, "durationMs": 2057,
    "timestamp": "2026-06-23T17:39:50.779Z",
    "gateResults": [
      { "gate": "intent_lock", "passed": true }, { "gate": "schema_in", "passed": true },
      { "gate": "semantic_in", "passed": true }, { "gate": "cross_agent", "passed": true },
      { "gate": "execute", "passed": true }, { "gate": "schema_out", "passed": true },
      { "gate": "confidence", "passed": true }, { "gate": "action_class", "passed": true }
    ]
  }],
  "adapterHealth": [{ "adapterId": "duffel", "status": "healthy", "latencyMs": 2054, "timestamp": "2026-06-23T17:39:50.780Z" }]
}
```

---

## What runs end to end vs. what does not

- ✅ **Live**: Duffel sandbox **availability search** (Agent 1.1) → real, normalized offers,
  through all six gates, with a durable, re-readable trace. Verified above and by the live e2e
  test [`duffel-e2e.test.ts`](packages/adapters/duffel/src/__tests__/duffel-e2e.test.ts)
  (runs when `DUFFEL_API_KEY` is set; skipped otherwise).
- ⛔ **Not claimed**: booking/ticketing against a live supplier. The Duffel adapter has
  `book()`, but creating real orders needs more than a sandbox search key (payment/balance
  setup, passenger PII handling, order-management lifecycle) and is **not** proven here. It is
  left unstubbed rather than presented as a working "live" result.

### Note for maintainers

The previous `duffel-e2e.test.ts` was **stale**: it constructed `new DuffelAdapter({ apiKey })`
(the real constructor is positional `(apiKey?, baseUrl?)` with `DUFFEL_API_KEY` fallback) and
asserted on `offer.total_price` / `offer.itineraries`, which the unified model does not have
(`offer.price` / `offer.itinerary`). It could not compile or pass against the shipped adapter.
It has been corrected to the real API and unified output model, and now passes live (3/3).
