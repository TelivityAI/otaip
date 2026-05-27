# @otaip/adapter-duffel — product parity roadmap (REMINDER)

**Why this file exists (owner directive, 2026-05-26):** Aviare is building Duffel
product integrations (Payments/Cards, Stays, Cars) against its own code. Those MUST
land here in the shared `@otaip/adapter-duffel` too, so we don't reimplement Duffel
plumbing per-consumer. Until each is built here, this file is the standing reminder
+ the place to paste the concrete build spec captured from the Aviare implementation.

**Rule:** when a Duffel product integration is finished in Aviare, append its full
spec to the matching section below — Duffel API resource paths, search→book flow,
request/response (wire) shapes, mapper logic, env/auth, and gotchas — enough that
this adapter can be built from the doc alone, without re-deriving anything.

Duffel products (confirmed in docs: https://duffel.com/docs/api/overview/welcome):
Flights, Stays, Cars, Payments.

---

## 1. Flights — ✅ DONE
`DuffelAdapter` (search/price), `DuffelOrderBridge` (orders), `capabilities.ts`
(`supportsOrders: true`). This is the reference pattern to mirror for the others.

## 2. Payments / Cards — 🟡 PARTIAL → finish
- Orders are created via `DuffelOrderBridge`, but **paying** for the order is not
  wired here (Aviare currently pays via Stripe Issuing, which we are replacing with
  Duffel).
- **TODO:** add the Duffel **pay-for-order** flow (balance payment / `payments`)
  and, if used, **Duffel Cards** (virtual card issuing to pay suppliers).
- **Paste here when built in Aviare:** the Duffel payment resource path(s), the
  order-create-with-payment vs hold-then-pay sequence, payment object shape
  (`type: balance` etc.), and how the order confirmation/ticket numbers come back.

## 3. Stays (hotels) — ❌ NOT STARTED
- No Stays code in this adapter. Aviare hotels currently go through Hotelbeds
  (blocked on certification) — Duffel Stays is the unblock.
- **TODO:** add a `DuffelStaysAdapter` (search + rates + book) mirroring
  `DuffelAdapter`, with a stays mapper + types, and extend `capabilities.ts`.
- **Paste here when built in Aviare:** `/stays/...` resource paths, the
  search → rates → quote → book flow, wire shapes, mapper, gotchas.

## 4. Cars (car hire) — 🟡 SCAFFOLDED → finish
- Already present: `cars-types.ts` (full `Car*` / `DuffelCars*Wire` types),
  `cars-mapper.ts`. Types are exported from `index.ts`.
- **MISSING:** the actual cars **adapter** (search/quote/book functions calling
  Duffel) is not implemented/exported, and `capabilities.ts` doesn't advertise cars.
- **TODO:** implement `DuffelCarsAdapter` using the existing types + mapper; wire
  search → quote → book; export it; update capabilities.
- **Paste here when built in Aviare:** `/cars/...` resource paths, the
  search→quote→book flow, how it uses the existing `cars-types`/`cars-mapper`, gotchas.

---

_Tracking the Aviare side: builds happen in `aviare` (orchestrator package + tools +
UI cards), then get mirrored here. Keep the two in sync._
