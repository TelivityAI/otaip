# Fare Construction — Data Dependencies (Agent 2.2)

Authoritative contracts for NUC × IROE construction (Resolution **024c**),
published TPM/MPM, and IATA Resolution **024d** currency rounding. This
document describes **what to ingest**, not the proprietary table contents.

Do **not** commit IROE rates, ICER rates, 024d rounding tables, or TPM/MPM
datasets to this repository. Licensed feeds belong in deployment secrets /
private object storage and are passed into agents at runtime.

**IATA exchange-rate products (do not conflate):**
[IATA Exchange Rates](https://www.iata.org/en/services/finance/xrates/)

| Product | Cadence | Use in OTAIP |
|---|---|---|
| **IROE** (IATA Rates of Exchange) | Monthly (5-day average ending on the 10th) | **Fare / rate construction only** — NUC ↔ local under Res **024c**. Agent 2.2. |
| **ICER** (IATA Consolidated Exchange Rate) | Daily (BSR-style) | **Payment / tax / fee** conversion to alternate currencies of payment. Agent 2.3 tax aggregation and ticketing payment FX — **not** IROE. |

---

## Formula (high level)

1. Construct / sum fare components in **NUC** (Neutral Unit of Construction).
2. Convert total NUC → local currency of sale / COC using **IROE**
   (IATA Rate of Exchange, Res **024c**): `local = NUC × IROE`.
3. Apply **Resolution 024d** rounding (method **HX** or **NX**, per currency
   unit published in the IROE / 024d table).
4. Mileage-system checks (HIP / BHC / CTM) and MPM excess surcharges require
   **published TPM** (and MPM) — never great-circle / haversine substitutes.

Ticket taxes and payment-currency conversion are **out of scope for IROE**.
Those paths ingest **ICER** (see below).

---

## Explicit bans

| Ban | Why |
|---|---|
| **No hardcoded IROE** in production code or shipped packages | IROE is published monthly by IATA; hardcoded rates go stale immediately and produce wrong local-currency fares. |
| **No IROE as ticket-tax / payment FX** | Tax and payment conversions use **ICER**, not IROE. Do not wire Agent 2.3 (or payment) to `data_sources.iroe`. |
| **No haversine / great-circle as TPM** | TPM is a published ticketed-point mileage from the IATA TPM Manual (non-stop / through scheduled services). It is **not** geodesic distance. HIP/BHC/CTM and MPM excess depend on exact published TPM. |
| **No banker's rounding as “IATA rounding”** | Resolution **024d** uses per-currency units with methods **HX** (round up to next higher unit) or **NX** (round to nearest unit). IEEE banker's / half-to-even rounding is not a substitute. |
| **No equal-sector proration as TPM proration** | IATA proration uses TPM-based allocation, not equal split. |
| **No inventing HIP / BHC / CTM comparison rules** | Those checks need filed intermediate fares / directionality / CT minima from ATPCO / carrier filings. Surface `DOMAIN_INPUT_REQUIRED` / `missing_inputs` instead. |

---

## Data dependency 1 — IROE (IATA Rate of Exchange) — fare construction only

| Field | Contract |
|---|---|
| **What** | Per-currency conversion factor: NUC → local currency (and inverse for published local → NUC). |
| **Resolution context** | Fare construction conversion under Res **024c**; rounding units/methods under Res **024d**. |
| **Source** | [IATA Rates of Exchange (IROE)](https://www.iata.org/en/services/finance/xrates/) — monthly electronic data file. |
| **Cadence** | Monthly (average of five banking days ending on the 10th). |
| **Ingestion shape** | `Record<ISO4217, decimal-string>` plus optional `effective_date` / period metadata at the feed boundary (`FareConstructionInput.data_sources.iroe`). |
| **Fail-closed** | If the selling currency has no IROE entry → return `DomainInputRequired` with `missing: ['iroe_table_entry:{CCY}']`. **Never** fall back to `1.0`. |
| **Not for** | Ticket-tax aggregation, payment-currency conversion, interline billing FX. |

Contributor note: purchase / subscribe via IATA (IROE). Do not vendor the
rate file into git.

---

## Data dependency — ICER (tax / payment FX) — not Agent 2.2

| Field | Contract |
|---|---|
| **What** | Daily exchange rates (sometimes called BSR) for converting fares, **taxes**, and **fees** to alternate currencies of payment. |
| **Source** | [IATA Consolidated Exchange Rate (ICER)](https://www.iata.org/en/services/finance/xrates/) — official industry source for international payment currency conversions used in pricing and ticketing. |
| **Cadence** | Daily electronic data file. |
| **Consumers** | Agent 2.3 Tax Calculation (and payment / ticketing FX paths). **Must not** consume IROE. |
| **Fail-closed** | Missing ICER for a currency pair → `DomainInputRequired` / halt conversion. **Never** invent rates or silently use `1.0`. |
| **Commit to git?** | **No** proprietary ICER files. |

Agent 2.3 currently still has a demo `currency_conversions` map marked
TEST/DEMO ONLY, with `DOMAIN_QUESTION` markers to ingest ICER and fail
closed. Do not “fix” that map by pointing it at IROE.

---

## Data dependency 2 — Resolution 024d rounding table

| Field | Contract |
|---|---|
| **What** | Per-currency **rounding unit** and **method**. |
| **Methods** | **HX** — round up to the next higher unit (unless already exact). **NX** — round to the nearest unit. |
| **Source** | IATA Resolution **024d** (Currency Names, Codes, Rounding Units…) as carried with IROE / Passenger Standards Conference Tariffs materials. |
| **Ingestion shape** | `Record<ISO4217, { unit: decimal-string; method: 'HX' \| 'NX' }>`. |
| **Fail-closed** | If the selling currency has no 024d entry → `DomainInputRequired` with `missing: ['rounding_024d:{CCY}']`. **No** default `0.01` unit. **No** banker's rounding fallback. |

The engine may implement the **mechanical** meaning of HX/NX once the
unit + method are supplied. It must **not** invent which currency uses
which unit or method.

---

## Data dependency 3 — TPM / MPM

| Field | Contract |
|---|---|
| **What** | **TPM** — Ticketed Point Mileage per coupon / city pair. **MPM** — Maximum Permitted Mileage for the fare component / routing. |
| **TPM definition** | Distance covered by one flight coupon, based on non-stop or through scheduled air services (IATA TPM Manual). Official source covers 65,000+ city pairs; updates monthly (`.txt` / API for system integration). |
| **Reference** | [IATA Ticketed Point Mileage (TPM)](https://www.iata.org/en/publications/manuals/mileage/ticketed-point-mileage-tpm/) — also MPM Manual, City Code Directory (CCD). |
| **Ingestion shape** | City-pair rows `{ origin, destination, tpm, mpm }` from the licensed TPM/MPM feed (airport or city codes per CCD / multi-airport rules — do not invent). |
| **Fail-closed** | If any fare component lacks a published TPM (and MPM when excess checks run) → `DomainInputRequired` with `missing: ['tpm:{ORG}-{DST}']` (and/or `mpm:…`). **Never** approximate with haversine. |

Contributor note: license the TPM Manual (and MPM Manual) from IATA.
Integrate via their `.txt` / API delivery. Do **not** commit proprietary
mileage tables to this repo.

---

## Fail-closed policy (runtime)

When any of IROE, 024d rounding, or TPM/MPM required for the itinerary is
absent:

1. Halt fare construction.
2. Return `DomainInputRequired` (`status: 'DOMAIN_INPUT_REQUIRED'`) listing
   machine-readable `missing` keys and references to the licensed sources.
3. Set agent `confidence` to `0` and surface warnings — do not emit a
   local-currency amount.

Silent approximation is a CLAUDE.md Agent 2.2 violation.

For tax / payment FX, the same fail-closed rule applies to **ICER** (Agent
2.3+) — independently of IROE.

---

## Minimal interface sketch — HIP / BHC / CTM

These are **mileage-system** checks. Comparison rules are **not**
implemented here; callers / future work supply filed data and apply the
published ATPCO / IATA algorithms.

```typescript
/** Inputs required before HIP can run — do not invent comparison rules. */
interface HipCheckRequirements {
  /** Filed NUC fares for every intermediate point pair on the routing. */
  intermediate_point_fares: Array<{
    origin: string;
    destination: string;
    carrier: string;
    nuc_amount: string;
  }>;
  // TODO: DOMAIN_QUESTION: exact HIP comparison order / directionality /
  // NUC-vs-local rules per ATPCO Fare Construction guide for this carrier.
}

/** Inputs required before BHC can run. */
interface BhcCheckRequirements {
  /** Geographic / direction analysis for each fare component vs journey. */
  geographic_direction_analysis: unknown;
  // TODO: DOMAIN_QUESTION: published BHC directionality rule set for this
  // journey type — do not use "city revisited" string heuristics.
}

/** Inputs required before CTM can run (circle trips). */
interface CtmCheckRequirements {
  /** Half round-trip / CT minimum fare amounts per component as filed. */
  circle_trip_minima_nuc: Array<{ component_index: number; ctm_nuc: string }>;
  // TODO: DOMAIN_QUESTION: CTM measurement and comparison vs constructed
  // total — carrier / ATPCO specific.
}
```

Until those inputs exist, Agent 2.2 reports `detected: false` /
`applies: false` with `missing_inputs` populated — it does **not** invent
HIP amounts, backhaul hits, or CT minima.

---

## Licensed sources checklist (contributors)

| Need | Where to obtain (buy / subscribe) | Commit to git? |
|---|---|---|
| IROE (fare construction / Res 024c) | [IATA Exchange Rates — IROE](https://www.iata.org/en/services/finance/xrates/) | **No** |
| ICER (tax / payment FX) | [IATA Exchange Rates — ICER](https://www.iata.org/en/services/finance/xrates/) | **No** |
| 024d units + HX/NX | Resolution 024d via IATA Passenger Standards / IROE materials | **No** |
| TPM city-pair mileages | [IATA TPM Manual](https://www.iata.org/en/publications/manuals/mileage/ticketed-point-mileage-tpm/) (`.txt` / API) | **No** |
| MPM | IATA Maximum Permitted Mileage Manual | **No** |
| City / multi-airport codes | IATA City Code Directory (CCD) | **No** |
| HIP intermediate fares | ATPCO fare filings / carrier fare construction data | **No** |

Test fixtures under
`packages/agents/pricing/src/fare-construction/__tests__/fixtures/` are
**invented** numbers for unit tests only. They must carry a
`TEST FIXTURE — do not use in production` banner and must never be loaded
by the production engine module graph.

---

## Related code

- `packages/agents/pricing/src/fare-construction/` — Agent 2.2 (IROE + 024d + TPM)
- `packages/agents/pricing/src/tax-calculation/` — Agent 2.3 (ICER for FX; not IROE)
- `@otaip/core` `DomainInputRequired` / `domainInputRequired`
- `CLAUDE.md` — Agent 2.2 anti-rationalization guards
- [IATA Exchange Rates](https://www.iata.org/en/services/finance/xrates/) — IROE vs ICER product split
