# Ligare — Connect Travel Inventory to ChatGPT

Ligare is a demo of [OTAIP](../../README.md): it takes a real supplier adapter
(**Duffel Test**) and exposes it as **ChatGPT Custom GPT Actions**, so you can
search and book flights from inside a chat.

> **Sandbox only.** Everything runs on Duffel Test. Flights and bookings are
> simulated — not real tickets, no real money.

It ships **two demos from one codebase**:

- **`pnpm ligare`** — a single-command, self-narrating developer demo: wraps
  Duffel as a `ConnectAdapter`, generates the ChatGPT/MCP tools from it, runs a
  live Duffel Test search, and serves the OpenAPI spec a GPT can import.
- **The hosted "Telivity Ligare" GPT** — the same backend, published once to the
  ChatGPT store, so anyone can search/book sandbox flights with zero signup.

## How it works

```
ChatGPT (Telivity Ligare GPT) ──HTTPS──► Fastify server
   (runs on the user's own model)          ├─ GET  /openapi.json   (the GPT's Action, generated)
                                            ├─ POST /flights/search ─┐
                                            ├─ POST /flights/price   ├─► DuffelConnectAdapter ─► DuffelAdapter ─► Duffel TEST
                                            ├─ POST /bookings        ┘
                                            ├─ GET  /bookings/:id
                                            ├─ GET  /health
                                            ├─ GET  /              (Telivity landing page)
                                            └─ POST /leads         (email capture)
```

The published GPT runs on the user's own ChatGPT model, so this backend needs
**no OpenAI key** and incurs **no token cost** — it only serves the Duffel
Actions. The one piece of real code is [`src/duffel-connect-adapter.ts`](./src/duffel-connect-adapter.ts),
which bridges Duffel's low-level `DistributionAdapter` to OTAIP's high-level
`ConnectAdapter` so the spec and the routes share one source of truth.

## Quick start (developer demo)

```bash
cp examples/ligare/.env.example examples/ligare/.env
# edit .env → set DUFFEL_API_KEY=duffel_test_...   (https://app.duffel.com, test mode)

pnpm install
pnpm -r build           # build the @otaip/* workspace deps
pnpm ligare             # narrated demo + live server
```

Without a `DUFFEL_API_KEY` the demo still runs — it prints the generated tools
and serves `/openapi.json`, and skips the live search.

## Publish the GPT (one-time)

OpenAI has no API to publish a GPT, so this is a one-time manual step:

1. Deploy this server so `https://ligare.telivity.app/openapi.json` is reachable.
2. In ChatGPT: **Create a GPT → Configure → Actions → Import from URL** →
   `https://ligare.telivity.app/openapi.json`. Add the name, logo, and
   instructions, then **Publish**.
3. Paste the published GPT URL into `GPT_URL` in `.env` so the landing page’s
   **Try Live Demo** button points at it.

## Want your own inventory?

The greyed-out story: Ligare supports Sabre, Amadeus, Navitaire, Duffel and more
through OTAIP's adapters. Connecting *your* inventory uses *your* supplier
credentials — that’s the white-glove product, not this sandbox demo.

## Env

| Var | Purpose |
| --- | --- |
| `DUFFEL_API_KEY` | Duffel **Test** key. Required for live search/price/book. |
| `PORT` | Server port (default 3000). |
| `PUBLIC_BASE_URL` | Base URL advertised in the OpenAPI `servers` block. |
| `GPT_URL` | Published GPT link for the landing page button. |
