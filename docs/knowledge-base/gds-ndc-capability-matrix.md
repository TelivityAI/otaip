# GDS / NDC channel capability matrix

**Authoritative for Agent 3.1 (GDS/NDC Router).**  
Issue: [#142](https://github.com/TelivityAI/otaip/issues/142).  
Companion CSV: [`gds-ndc-capability-matrix.csv`](./gds-ndc-capability-matrix.csv).

---

## Rule (non-negotiable)

**Routing is per `(carrier, vendor, transaction)`, never a single airline → channel map.**

“Airline X supports NDC” does **not** mean every transaction routes to NDC. The same carrier may shop on NDC, book on NDC, and still require GDS (or Direct/API) for groups, corporate/private fares, or post-booking servicing — and that split can differ by **vendor** (Sabre Offer/Order vs Amadeus Self-Service vs Duffel vs airline direct).

Do **not** invent NDC schema versions. Do **not** default every carrier to `21.3`. If the version/profile is not evidenced for that carrier×vendor, write `unknown`.

---

## What Res 787 is (and is not)

[IATA Resolution 787 — Enhanced Airline Distribution](https://www.iata.org/contentassets/6de4dce5f38b45ce82b0db42acd23d1c/ndc-resolution-787.pdf) is the **industry process standard** for Offer/Order distribution. It defines the business dialogues:

| Res 787 section | Process | Matrix transaction labels |
| --- | --- | --- |
| §3.1.1 | Authenticate & Shop → product offer | `Shop` |
| §3.1.2 | Order (commit / pay / fulfill / document) | `OrderCreate` |
| §3.1.3 | Change (modify, add, cancel, refund) | `OrderChange`, `OrderCancel`, `Servicing` |

**Res 787 is not a carrier×channel parity matrix.** It does not say which airline uses GDS vs NDC for which transaction. That operational record is what *this* matrix holds. Schema versions (17.2 / 18.1 / 21.3 / 24.1 / vendor profiles) are implementation choices per carrier×vendor — never a global default.

Extended labels used by OTAs/TMCs (not named as separate Res 787 processes, but common channel forks):

| Label | Meaning |
| --- | --- |
| `Groups` | Group PNR / group inventory / group contracts |
| `Corporate` | Corporate / private / negotiated fares |

---

## Columns

| Column | Values |
| --- | --- |
| `carrier` | Anonymized id (`ANON-*`) or real IATA when publicly evidenced. Prefer anonymized in this seed. |
| `vendor` | `sabre` \| `amadeus` \| `duffel` \| `navitaire` \| `trippro` \| `airline_direct` \| `unknown` |
| `transaction` | `Shop` \| `OrderCreate` \| `OrderChange` \| `OrderCancel` \| `Servicing` \| `Groups` \| `Corporate` |
| `channel` | `NDC` \| `GDS` \| `Direct/API` \| `Either` \| `unknown` |
| `ndc_version_notes` | Carrier×vendor schema/profile note, or `unknown`. Never invent. |
| `fallback` | Next channel if primary unavailable, or `none` / `unknown` |
| `source` | Public doc path or URL that justifies the cell |
| `confidence` | `adapter_doc` \| `vendor_public` \| `unknown` |

Machine-readable form: same columns in [`gds-ndc-capability-matrix.csv`](./gds-ndc-capability-matrix.csv).

---

## Sabre Offer/Order REST surface (vendor reference)

Public Sabre NDC / Offer & Order guide:  
https://developer.sabre.com/guide/ndc/ndc.html

Sabre documents an NDC-enabled **REST/JSON Offer and Order** API set (not a claim that every Sabre-hosted carrier supports every call). Current-release APIs listed on that guide:

| API | Endpoint | Maps to matrix transaction |
| --- | --- | --- |
| Bargain Finder Max (shop, may return NDC offers) | `v5/offers/shop` | `Shop` |
| Offer Price | `v1/offers/price` | `Shop` (price confirmation) |
| Order Create | `v1/orders/create` | `OrderCreate` |
| Order Cancel (pre-fulfillment) | `v1/orders/cancel` | `OrderCancel` |
| Order Reprice | `v1/offers/repriceOrder` | `Servicing` |
| Order Change (fulfill / mixed-content cancel) | `v1/orders/change` | `OrderChange` / `Servicing` |
| Order View | `v1/orders/view` | `Servicing` |
| Offer Cancel Reshop | `v1/offers/reshop/cancelOrder` | `OrderCancel` / `Servicing` |
| Order Cancel Void & Refund | `v1/orders/cancel` | `OrderCancel` / `Servicing` |
| Offer Reshop Shop | `v1/offers/reshop/shop` | `Servicing` |
| Order Change Exchange | `v1/orders/change/exchange` | `OrderChange` / `Servicing` |
| Order Sync | `v1/orders/sync` | `Servicing` |

**Implication for routing:** even on Sabre, shop vs fulfill vs exchange are **different API calls**. Carrier participation in each call is not implied by “content is NDC on Sabre.” Per-carrier enablement remains `unknown` until evidenced — do not copy this vendor API list into every carrier row as if it were carrier capability.

Sabre also documents that classic ticketing cryptic/LLS commands are **not** valid against NDC air segments created via Offer/Order — another reason channel choice must be per transaction, not per airline.

---

## Seed matrix (public / anonymized)

Sources limited to this repo’s adapter docs + the Sabre public guide above. Cells without evidence are `unknown`.

### ANON-NDC-AGG (Duffel path) — Shop ≠ Servicing

Participating airline inventory reached through Duffel’s NDC aggregator. Adapter implements search / price / book; flight cancel and exchange are **not** implemented in the adapter (`docs/adapters/duffel.md`, `docs/architecture/ADAPTER_STATUS.md`).

| transaction | channel | ndc_version_notes | fallback | source |
| --- | --- | --- | --- | --- |
| Shop | NDC | unknown (Duffel API version header ≠ IATA NDC schema version) | GDS | `docs/adapters/duffel.md` |
| OrderCreate | NDC | unknown | GDS | `docs/adapters/duffel.md` |
| OrderChange | unknown | unknown | GDS | adapter: exchange not implemented |
| OrderCancel | unknown | unknown | GDS | adapter: flight cancel not implemented |
| Servicing | GDS | n/a | none | shop≠servicing: post-booking not on Duffel adapter path |
| Groups | unknown | unknown | GDS | no public evidence |
| Corporate | unknown | unknown | GDS | no public evidence |

### ANON-SABRE-OO (Sabre Offer/Order path)

Carrier distributing NDC content via Sabre Offer/Order REST. Vendor API surface exists (table above); **per-carrier** enablement of each endpoint is `unknown` unless separately contracted.

| transaction | channel | ndc_version_notes | fallback | source |
| --- | --- | --- | --- | --- |
| Shop | Either | unknown (BFM may return NDC + ATPCO; schema per airline unknown) | GDS | Sabre NDC guide + `docs/adapters/sabre.md` |
| OrderCreate | NDC | unknown | GDS | Sabre `v1/orders/create` |
| OrderChange | NDC | unknown | GDS | Sabre `v1/orders/change` (+ exchange) |
| OrderCancel | NDC | unknown | GDS | Sabre `v1/orders/cancel` |
| Servicing | NDC | unknown | GDS | Order View / Reshop / Sync |
| Groups | unknown | unknown | GDS | no public evidence — often still classic GDS |
| Corporate | unknown | unknown | GDS | no public evidence |

### ANON-GDS-SS (Amadeus Self-Service path)

Full GDS Self-Service shopping/booking/cancel; ticketing / exchange / refund **not** available on Self-Service tier (`docs/adapters/amadeus.md`).

| transaction | channel | ndc_version_notes | fallback | source |
| --- | --- | --- | --- | --- |
| Shop | GDS | n/a | none | `docs/adapters/amadeus.md` |
| OrderCreate | GDS | n/a | none | Flight Orders create |
| OrderChange | unknown | n/a | none | exchange not in Self-Service |
| OrderCancel | GDS | n/a | none | Flight Orders delete |
| Servicing | unknown | n/a | none | refund/exchange not in Self-Service |
| Groups | unknown | n/a | none | no public evidence |
| Corporate | unknown | n/a | none | no public evidence |

### ANON-LCC-DIRECT (Navitaire / OOSD path)

Direct/API (LCC platform). Order model via AIDM 24.1-style OrderOperations when `supportsOrders` (`docs/adapters/navitaire.md`, `docs/adapters/oosd-navitaire.md`).

| transaction | channel | ndc_version_notes | fallback | source |
| --- | --- | --- | --- | --- |
| Shop | Direct/API | n/a (AIDM order model, not classic NDC XML version) | none | navitaire + oosd docs |
| OrderCreate | Direct/API | n/a | none | `orderCreate` / commit flow |
| OrderChange | Direct/API | n/a | none | `orderChange` declared |
| OrderCancel | Direct/API | n/a | none | `orderCancel` / cancel flow |
| Servicing | Direct/API | n/a | none | retrieve + events |
| Groups | unknown | n/a | none | no public evidence |
| Corporate | unknown | n/a | none | no public evidence |

### ANON-AGG-DUAL (TripPro dual-host) — Shop ≠ Servicing

Aggregator: REST for search/price/book; SOAP PNR path for retrieve / ticket / cancel (`docs/adapters/trippro.md`).

| transaction | channel | ndc_version_notes | fallback | source |
| --- | --- | --- | --- | --- |
| Shop | Either | unknown (upstream may be GDS or NDC) | GDS | trippro REST search |
| OrderCreate | Either | unknown | GDS | trippro REST book |
| OrderChange | unknown | unknown | GDS | exchange not implemented |
| OrderCancel | GDS | n/a | none | SOAP CancelPNR |
| Servicing | GDS | n/a | none | SOAP ReadPNR / OrderTicket — **shop≠servicing** |
| Groups | unknown | unknown | GDS | no public evidence |
| Corporate | unknown | unknown | GDS | no public evidence |

---

## When GDS remains mandatory (even for “NDC airlines”)

From CLAUDE.md Agent 3.1 guards + adapter limits — treat as routing heuristics that still require a matrix row (do not hard-code as universal law):

1. **Groups** — often still classic GDS / special desks.
2. **Corporate / private fares** — frequently GDS-filed or agency-desk only.
3. **Post-booking servicing** — cancel / exchange / void / refund may be GDS or a different NDC profile than shop.
4. **Mixed content PNRs** — Sabre documents Order Change specifically for canceling NDC when other air content exists in the PNR.
5. **Adapter gaps** — vendor marketing “NDC” while this repo’s adapter only implements Shop/OrderCreate (Duffel) forces a GDS (or unknown) servicing path until the adapter/API is proven.

---

## Codeshare / plating

Res 787 §3.1.2.4 requires interline reservation/ticketing data exchange when space is confirmed — it does **not** say whether marketing or operating channel wins for routing.

OTAIP Agent 3.1 today (`carrier-channels.json` + `router-engine.ts`):

| Rule | Behavior |
| --- | --- |
| Default | Prefer **operating** carrier’s matrix/config when `operating_carrier ≠ marketing_carrier` and operating has a row |
| Fallback | **Marketing** carrier when operating has no matrix/config |
| Plating | **Not in input today** |

### Proposed plating notes (for Agent 3.1 consumers)

| Situation | Who wins for channel lookup |
| --- | --- |
| Simple codeshare, free-sale, same plating as marketing | Operating carrier channel for inventory; marketing for offer display identity |
| Blocked-space / hard block | // TODO: DOMAIN_QUESTION: blocked-space codeshare — marketing vs operating channel? |
| Plating carrier ≠ marketing and ≠ operating | Lookup by **`plating_carrier`** when provided; do not invent |
| Dual-channel required | Return non-unified routing; do not collapse to one airline→channel |

---

## Proposed Agent 3.1 input fields (matrix consumption)

These fields let 3.1 consume the matrix **without** a single airline→channel map. Existing engine fields are noted.

| Field | Required | Maps to / status |
| --- | --- | --- |
| `transaction_type` | yes | Prefer matrix labels `Shop` \| `OrderCreate` \| `OrderChange` \| `OrderCancel` \| `Servicing` \| `Groups` \| `Corporate`. Today’s engine enum aliases: `shopping`←Shop, `booking`←OrderCreate, `servicing`←OrderChange/OrderCancel/Servicing, `group`←Groups, `corporate`←Corporate, plus `ticketing` for document issuance |
| `segments[].marketing_carrier` | yes | Matrix `carrier` key (after resolving anonymized→IATA in deployment data) |
| `segments[].operating_carrier` | no | Codeshare operating-first lookup |
| `plating_carrier` | no (**proposed**) | When set, matrix lookup uses plating for channel; // TODO: DOMAIN_QUESTION until plating rules confirmed |
| `vendor` | no (**proposed**, strongly recommended) | Matrix `vendor` dimension — without it, multiple vendor rows for one carrier are ambiguous |
| `preferred_channel` | no | Existing override; only applied if channel is in the matrix row’s allowed set |
| `preferred_gds` | no | Existing; only meaningful when channel is `GDS` |
| `include_fallbacks` | yes | Existing; use matrix `fallback` column |
| `capability_matrix` | no (**proposed**) | Inline rows (CSV-shaped) for the request — preferred over baked airline maps |
| `capability_overrides` | no | Existing escape hatch: `Record<carrier, Partial<Record<TransactionType, CarrierChannelConfig>>>` |

### Lookup algorithm (normative for consumers)

1. Resolve routing carrier (operating → marketing; plating if `plating_carrier` set — see DOMAIN_QUESTION).
2. Require `transaction_type` (Res 787 / matrix label or engine alias).
3. Look up `(carrier, vendor, transaction)` in the matrix.
4. If `channel` is `unknown` → `domain_input_required` (do not guess).
5. If `channel` is known → build primary + fallback; set `ndc_version` **only** when `ndc_version_notes` is a concrete schema id, else `null`.
6. Never apply a carrier’s Shop channel to Servicing/Groups/Corporate without a separate row.

Reference implementation: `packages/agents/booking/src/gds-ndc-router/capability-matrix.ts`.

---

## Open DOMAIN_QUESTIONS

1. Per-carrier enablement of each Sabre Offer/Order endpoint (guide lists vendor APIs, not airline participation).
2. Plating-carrier precedence vs marketing/operating for channel selection.
3. Whether `Groups` / `Corporate` should remain separate transactions or become fare-attribute filters on Shop/OrderCreate.
4. How Duffel `Duffel-Version` maps (if at all) to IATA NDC schema versions for a given airline.
5. Ingestion path for production matrix rows (CSV in KB vs registry service) — seed only here.

---

## Anti-patterns (CLAUDE.md Agent 3.1)

| Do not | Do |
| --- | --- |
| `carrier → NDC` for all transactions | `(carrier, vendor, transaction) → channel` |
| Default NDC version to `21.3` | Leave `unknown` / `null` until evidenced |
| Treat Res 787 as a parity checklist | Use Res 787 for process names; matrix for channel facts |
| Parse GDS fare displays as capability | Use structured matrix + vendor public API lists |
