# OTAIP Reference OTA

A reference flight search application built on the Open Travel AI Platform. Proves OTAIP works end to end with real adapter integration, agent pipelines, and a deployable web UI.

Sprint E covers **search only**. Booking is Sprint F.

## Quick Start

```bash
# From the repo root
pnpm install

# Option A: Run with mock data (no API key needed)
pnpm --filter @otaip/ota-example dev

# Option B: Run with live Duffel sandbox (real search, price, and booking)
cp examples/ota/.env.example examples/ota/.env
# Edit .env and set DUFFEL_API_KEY (free at duffel.com/docs/getting-started)
pnpm --filter @otaip/ota-example dev
```

Open http://localhost:3000 in your browser.

### Live mode (DUFFEL_API_KEY)

When `DUFFEL_API_KEY` is set, search / price / book run against the Duffel
sandbox via `DuffelOtaAdapter` — same path the `pnpm --filter @otaip/demo book`
demo proves works. Payment and ticketing remain in-memory mocks because real
Stripe + e-ticketing are out of scope for the reference OTA. Cancellation is
local-only; sandbox orders stay on Duffel until they expire.

`DUFFEL_API_TOKEN` is still accepted as a deprecated alias for backwards
compatibility.

## What Happens When You Search

1. **Frontend** posts search params to `POST /api/search`
2. **SearchService** optionally validates airport codes using `AirportCodeResolver` (Agent 0.1)
3. **SearchService** calls the configured `DistributionAdapter.search()` (Duffel or Mock)
4. Adapter normalizes results to OTAIP canonical `SearchOffer` schema
5. Results are sorted by price and cached for the offer detail route
6. Frontend renders offer cards with carrier, times, duration, stops, and price

## Architecture

```
Browser (plain HTML + vanilla JS)
  |
  v
Fastify server (src/server.ts)
  |
  +-- POST /api/search  --> SearchService --> DistributionAdapter.search()
  +-- GET /api/offers/:id --> OfferService --> cached offer lookup
  +-- GET /health        --> adapter health check
```

## Customization

- **Swap adapter**: edit `src/config/adapters.ts` to use Amadeus, Travelport, or any `DistributionAdapter`
- **Add agents**: wire additional agents (fare rules, tax calc) into the service layer
- **Modify UI**: edit the plain HTML/JS files in `public/` -- no build step needed

## Tests

```bash
# From repo root
pnpm test -- --filter examples/ota
```
