# Adapter Status

## Standalone Adapters

| Adapter | Package | Search | Price | Book | Ticket | Cancel | Status |
|---------|---------|--------|-------|------|--------|--------|--------|
| Duffel | `@otaip/adapter-duffel` | Yes | Yes | Yes | Via order `documents` / `getOrder` (no separate ticket API) | Cars only (no flight order cancel API in adapter) | library (requires credentials) |

## Connect Framework Adapters

Connect adapters implement real HTTP calls, request/response mapping, authentication, and unit tests. Maturity: **library** / sandbox-tested with mocks — not supplier-certified in CI.

`BaseAdapter` provides shared retry (safe ops only by default), optional rate limiting, circuit breaker, and 429 handling. Unsafe mutations should go through `MutationExecutor`.

| Adapter | Search | Price | Book | Ticket | Cancel | Auth |
|---------|--------|-------|------|--------|--------|------|
| Sabre (GDS) | Yes | Yes | Yes | Yes | Yes | OAuth2 |
| Amadeus | Yes | Yes | Yes | No | Yes | SDK (OAuth) |
| Navitaire | Yes | Yes | Yes | Yes | Yes | JWT + Session |
| TripPro/Mondee | Yes | Yes | Yes | Yes | Yes | API Key + Token |
| HAIP (Hotel PMS) | Yes | N/A | Yes | N/A | Yes | Auth header |

`BookingPipeline` / `PaymentHandoff` in `packages/connect/src/pipeline/` are **stubs** — not production money paths.

## Channel Generators

| Channel | Format | Valid | Tests |
|---------|--------|-------|-------|
| ChatGPT (Custom GPT) | OpenAPI 3.1 | Yes | Yes |
| Claude (MCP Server) | MCP Protocol | Yes | Yes |

## Roadmap

| Adapter | Coverage | API Type |
|---------|----------|----------|
| Verteil | AF, Finnair, SAS, Oman Air + others | REST (pure NDC) |
| Accelya | LH Group, American NDC | REST (Farelogix-based) |

## Notes

- All Connect adapters have been tested against mock/sandbox APIs. Production validation requires your own credentials.
- The Duffel adapter has both a MockDuffelAdapter (for testing) and a live DuffelAdapter.
- Navitaire uses stateful sessions — the adapter manages session lifecycle automatically.
- HAIP is hotel-only (PMS integration for property management).
