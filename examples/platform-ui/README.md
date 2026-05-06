# OTAIP Platform UI

A small React + Vite app that gives developers a visual control plane for an OTAIP instance — agent registry, adapter status, and an interactive Playground for exercising agents and adapters.

This is **not** the OTA reference app (`examples/ota`). The OTA app is a flight booking demo; this one is OTAIP's own dashboard.

## Quick start

```bash
# From the repo root
pnpm install

# Terminal 1: OTA Fastify server (provides the /api/* routes)
pnpm --filter @otaip/ota-example dev

# Terminal 2: Vite dev server
pnpm --filter @otaip/platform-ui dev
```

Open <http://localhost:5173> in your browser. The Vite proxy forwards `/api` to `http://localhost:3000` (override with `OTA_SERVER_URL`).

## What's here

- **Dashboard** — total/active/stub agent counts, full agent registry with filter/sort/group-by-domain, adapter cards driven by env-var presence, health sidebar (uptime, request count, OTAIP version).
- **Playground** — three modes:
  - **Search**: full flight-search form against the configured adapter.
  - **Agent**: picker over every discovered agent. Whitelisted agents (v1: `0.1` AirportCodeResolver) execute end-to-end; everything else returns a clear `501` with a "not yet wired" hint.
  - **Adapter**: direct `search` / `price` / `isAvailable` calls against the configured adapter.
- Response viewer with **Formatted / Raw / Timeline** tabs and a **last-10 request history** that replays into the response panel on click.

## Why no auth / single port

This is a local developer tool. Running both the OTA server and the platform UI on `localhost` keeps the surface small. Production deployment (serving the built `dist/` from Fastify) is a separate concern, deferred to a future PR.

## Backend routes consumed

```
GET  /api/platform/agents      # discovery + per-domain rollups
GET  /api/platform/adapters    # adapter list with env-derived configured flags
GET  /api/platform/health      # uptime, node, OTAIP version, request counter
GET  /api/platform/stats       # aggregate counts

GET  /api/playground/catalog   # full agent list + executable_ids whitelist
POST /api/playground/search    # canonical search through SearchService
POST /api/playground/agent     # execute a whitelisted agent (501 otherwise)
POST /api/playground/adapter   # search / price / isAvailable on the configured adapter
```

All routes are read-only. State-mutating booking flows (`/api/book`, `/api/pay`, etc.) are intentionally not exposed through the playground.
