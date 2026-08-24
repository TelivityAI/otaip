# Stage 2 -- Pricing Agents

**Package:** `@otaip/agents-pricing`

Fare rules, fare construction, tax calculation, offer building, corporate policy validation, and (coming soon) dynamic pricing and revenue management.

---

### Agent 2.1 -- Fare Rule Agent

**ID:** `2.1`
**Class:** `FareRuleAgent`
**Status:** Implemented

Parses ATPCO fare rules (categories 1-20) into human-readable structured format using curated tariff snapshot data.

**Input (`FareRuleInput`):**
- `fare_basis` -- fare basis code
- `carrier` -- marketing carrier IATA code
- `origin` -- origin IATA code
- `destination` -- destination IATA code
- `travel_date?` -- ISO date for date-based rule filtering
- `categories?` -- specific ATPCO categories 1-50 (all if omitted)

**Output (`FareRuleOutput`):**
- `rules` -- `FareRuleResult[]` with parsed categories, penalty summary, advance purchase, min/max stay, seasonality
- `total_rules` -- count of matched rules
- `valid_for_date` -- whether fare is valid for the specified travel date
- `in_blackout` -- whether travel date falls in a blackout period

---

### Agent 2.2 -- Fare Construction

**ID:** `2.2`
**Class:** `FareConstruction`
**Status:** Implemented

NUC × IROE construction with published TPM/MPM, Resolution **024d** (HX/NX) rounding, and fail-closed HIP/BHC/CTM hooks. All financial math uses `decimal.js`.

Licensed IROE / 024d / TPM-MPM data are **not** shipped in the package. Pass them via `data_sources`. Missing IROE, TPM, or 024d → `DomainInputRequired`. Haversine-as-TPM and banker's rounding are banned.

**KB:** `docs/knowledge-base/fare-construction-data-dependencies.md`

**Input (`FareConstructionInput`):**
- `journey_type` -- `'OW' | 'RT' | 'CT'` (one-way, round-trip, circle-trip)
- `components` -- fare components (origin, destination, carrier, fare basis, NUC amount)
- `selling_currency` -- ISO 4217 currency
- `point_of_sale?` -- country for IROE selection context
- `data_sources?` -- licensed `{ iroe, rounding_024d, mileage }` (required for a constructed fare)

**Output (`FareConstructionResult`):**
- Success (`FareConstructionOutput`): `total_nuc`, `iroe` (alias `roe`), `local_amount` after 024d, `rounding_method` (`HX`|`NX`), published `mileage_checks`, HIP/BHC/CTM sketches, `audit_trail`
- Or `DomainInputRequired` when licensed data is missing

---

### Agent 2.3 -- Tax Calculation

**ID:** `2.3`
**Class:** `TaxCalculation`
**Status:** Implemented

Per-segment tax computation with exemption engine, ~30 countries, ~50 tax codes, currency conversion. All financial math uses `decimal.js`.

**FX note:** Ticket-tax / payment currency conversion must use licensed **ICER** (IATA Consolidated Exchange Rate, daily) — **not** IROE. IROE is fare construction only (Res 024c / Agent 2.2). See [IATA Exchange Rates](https://www.iata.org/en/services/finance/xrates/) and `docs/knowledge-base/fare-construction-data-dependencies.md`. The bundled `currency_conversions` map is demo-only; production must fail closed on missing ICER.

**Input (`TaxCalculationInput`):**
- `segments` -- itinerary segments (origin/destination airports and countries, carrier, cabin class, base fare NUC)
- `passenger_type` -- `'adult' | 'child' | 'infant' | 'crew' | 'diplomatic'`
- `is_transit` -- whether transit/connection (< 24h same ticket)
- `is_involuntary` -- whether involuntary reroute
- `total_base_fare_nuc` -- total base fare for percentage-based taxes
- `selling_currency` -- ISO 4217

**Output (`TaxCalculationOutput`):**
- `taxes` -- `AppliedTax[]` (code, name, country, type, amounts, segment indices, interlineable, exempt status)
- `total_tax` -- total in selling currency
- `breakdown` -- by country, interlineable/non-interlineable totals
- `exemptions_applied` -- list of exemption reasons
- `segments_processed` -- count

---

### Agent 2.4 -- Offer Builder

**ID:** `2.4`
**Class:** `OfferBuilderAgent`
**Status:** Implemented

Builds, caches, validates, and manages pricing offers with TTL expiration. Supports in-memory or pluggable persistence.

**Input (`OfferBuilderInput`):**
- `operation` -- `'buildOffer' | 'getOffer' | 'validateOffer' | 'markUsed' | 'expireOffer' | 'cleanExpired'`
- `buildInput?` -- segments, fare, taxes, ancillaries, passenger count, pricing source, TTL
- `offerId?` -- for get/validate/mark/expire operations
- `currentTime?` -- ISO timestamp override

**Output (`OfferBuilderOutput`):**
- `offer?` -- full offer record with pricing breakdown, TTL, status
- `valid?` -- offer validity result
- `reason?` -- validation failure reason
- `cleanedCount?` -- number of expired offers cleaned

**Constructor:** `new OfferBuilderAgent({ persistence?: PersistenceAdapter })`

---

### Agent 2.5 -- Corporate Policy Validation

**ID:** `2.5`
**Class:** `CorporatePolicyValidationAgent`
**Status:** Implemented

Validates flight offers against corporate travel policies: cabin class limits, fare ceilings, blocked carriers, advance booking requirements. Supports bypass codes.

**Input (`PolicyValidationInput`):**
- `offer` -- offer details (cabin, fare amount, carrier, fare basis, advance booking days, segments)
- `policy` -- corporate policy (cabin rules, fare rules, booking rules, bypass codes)
- `bypassCode?` -- authorization code to bypass soft violations

**Output (`PolicyValidationOutput`):**
- `result` -- `'APPROVED' | 'SOFT_VIOLATION' | 'HARD_VIOLATION'`
- `violations` -- `PolicyViolation[]` with rule, severity, detail
- `bypassApplied` -- whether bypass was used

---

### Agent 2.6 -- Dynamic Pricing

**ID:** `2.6`
**Class:** `DynamicPricingAgent`
**Status:** Coming Soon (stub)

Revenue management integration for dynamic fare adjustments. Requires revenue management integration before implementation can proceed.

---

### Agent 2.7 -- Revenue Management

**ID:** `2.7`
**Class:** `RevenueManagementAgent`
**Status:** Coming Soon (stub)

Revenue management system integration. Requires revenue management domain input before implementation can proceed.
