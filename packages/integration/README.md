# @otaip/integration

The caller-facing seam: run a contracted OTAIP agent against a **live distribution
adapter** through the six pipeline gates, and read the run's **execution + gate trace**
back by id.

Proven path: **Agent 1.1 (Availability Search) → Duffel NDC sandbox → real offers → durable trace.**

```ts
import { runAvailabilitySearch, getRunTrace, FileEventStore } from '@otaip/integration';

const store = await FileEventStore.open('./traces/run.jsonl');
const res = await runAvailabilitySearch(
  { origin: 'JFK', destination: 'LHR', departure_date: '2026-07-23',
    passengers: [{ type: 'ADT', count: 1 }], cabin_class: 'economy' },
  { duffelApiKey: process.env.DUFFEL_API_KEY, eventStore: store },
);

if (res.ok) console.log(res.output.offers.length, 'offers');

const trace = await getRunTrace(store, res.sessionId); // by-id read-back
```

- Reuses the real `PipelineOrchestrator`, gates, event types, and unified output model
  from `@otaip/core` — **no parallel execution or validation path**.
- The Duffel API key is read only at adapter construction; it never enters events, traces,
  logs, or returned payloads.

Full contract, credentials policy, and live sandbox proof: see
[`INTEGRATION.md`](../../INTEGRATION.md) at the repo root.

Live proof script (needs a `duffel_test_…` key, run from repo root):

```bash
pnpm run data:download
export DUFFEL_API_KEY=duffel_test_xxx
pnpm exec tsx packages/integration/scripts/duffel-search.ts
```
