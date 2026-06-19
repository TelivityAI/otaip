# @otaip/adapter-duffel — product coverage roadmap

**Goal:** `@otaip/adapter-duffel` should cover all Duffel products, so downstream
consumers never have to reimplement Duffel plumbing. This file tracks which
products are implemented in this adapter and what is still missing.

**Rule:** when a Duffel product integration is implemented here, document its
full spec in the matching section below — Duffel API resource paths, the
search→book flow, request/response (wire) shapes, mapper logic, env/auth, and
gotchas — enough that the adapter can be built from the doc alone.

Duffel products (per https://duffel.com/docs/api/overview/welcome):
Flights, Stays, Cars, Payments.

---

## 1. Flights — ✅ DONE
`DuffelAdapter` (search/price), `DuffelOrderBridge` (orders), `capabilities.ts`
(`supportsOrders: true`). This is the reference pattern to mirror for the others.

## 2. Payments / Cards — 🟡 PARTIAL → finish
- Orders are created via `DuffelOrderBridge`, but **paying** for the order is not
  wired here yet.
- **TODO:** add the Duffel **pay-for-order** flow (balance payment / `payments`)
  and, if used, **Duffel Cards** (virtual card issuing to pay suppliers).
- **Document when built:** the Duffel payment resource path(s), the
  order-create-with-payment vs hold-then-pay sequence, the payment object shape
  (`type: balance` etc.), and how the order confirmation/ticket numbers come back.

## 3. Stays (hotels) — ❌ NOT STARTED
- No Stays code in this adapter yet.
- **TODO:** add a `DuffelStaysAdapter` (search + rates + book) mirroring
  `DuffelAdapter`, with a stays mapper + types, and extend `capabilities.ts`.
- **Document when built:** `/stays/...` resource paths, the
  search → rates → quote → book flow, wire shapes, mapper, gotchas.

## 4. Cars (car hire) — 🟡 SCAFFOLDED → finish
- Already present: `cars-types.ts` (full `Car*` / `DuffelCars*Wire` types),
  `cars-mapper.ts`. Types are exported from `index.ts`.
- **MISSING:** the actual cars **adapter** (search/quote/book functions calling
  Duffel) is not implemented/exported, and `capabilities.ts` doesn't advertise cars.
- **TODO:** implement `DuffelCarsAdapter` using the existing types + mapper; wire
  search → quote → book; export it; update capabilities.
- **Document when built:** `/cars/...` resource paths, the
  search→quote→book flow, how it uses the existing `cars-types`/`cars-mapper`, gotchas.
