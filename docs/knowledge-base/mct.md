# Minimum Connecting Time (MCT) — Domain Knowledge

Authoritative sources for Connection Builder (Agent 1.3):

- **IATA SSIM Chapter 8** — Presentation, Application and Transfer of Minimum Connecting Time (MCT) data
- **IATA PSC Resolution 765** — administration of MCTs; must be observed by ticketing and reservations outlets and automated reservations systems
- **IATA Minimum Connecting Time User Guide v1.1** — carrier filing / exception process and Record Type 2 mapping  
  https://www.iata.org/contentassets/638f0938b3dd451b872a1d8357755421/minimum-connecting-time-user-guide_version-1.1.pdf

Do **not** invent MCT minutes from “industry folklore,” airport-constant tables, great-circle/haversine distance, or a fake global default table. Real MCT is **carrier-filed** (via data aggregators such as OAG/Cirium), optionally with airport/terminal specificity, and distributed under SSIM Ch.8.

## Definition (passenger)

Shortest time interval required to transfer a passenger and luggage from one flight to a connecting flight at a specific location or metropolitan area (SSIM Ch.8 / PSC Res 765 context in the User Guide).

## Connection status codes (SSIM)

| Code | Meaning                       |
| ---- | ----------------------------- |
| `DD` | Domestic → Domestic           |
| `DI` | Domestic → International      |
| `ID` | International → Domestic      |
| `II` | International → International |

## Resolution hierarchy (most specific wins)

Application order for this platform (aligned with the issue #141 sketch and SSIM “most specific filing wins” practice). Template field order in the carrier submission form is **not** the same as hierarchy priority (User Guide §III).

1. **Carrier override** — arriving carrier + departing carrier (+ optional flight ranges, equipment, codeshare indicators) at the connection airport, for a connection status (`DD`/`DI`/`ID`/`II`), optionally scoped to terminals.
2. **Airport + terminal** — station MCT when a terminal change (or explicit arrival/departure terminal pair) is known.
3. **Airport** — station-level MCT for the connection status when no carrier-pair row matches.
4. **Fail-closed** — if no curated row matches, **do not invent** an IATA global constant. Treat MCT as unavailable and reject the connection for shopping/validation.

Carrier overrides are **required** for trustworthy online builds at hubs. Airport-level rows are only added when taken from a real SSIM/aggregator extract or another cited public source — never as guessed “hub constants.”

## Online vs interline

- **Online** — same marketing/operating carrier context (same carrier pair in the override, typically `arriving_carrier === departing_carrier`).
- **Interline** — different carriers. SSIM filings often need **concurrence** of the receiving carrier for exceptions (User Guide §II). Alliance membership alone does **not** prove an interline MCT exists.

Starter dataset rows are online-only unless an interline row is explicitly checked in with a source citation.

## Starter dataset location

`data/reference/mct/` — curated JSON only. Incomplete by design. Prefer a few validated hub/carrier rows over a fake global table.

## Open DOMAIN_QUESTIONs

1. **DQ-MCT-1 (online vs interline MCT application):** For a given carrier pair at a station, when both online and interline filings exist (or only airport-level filings), which exact SSIM match order and concurrence rules does OTAIP use in production shopping? Unpublished carrier exceptions must not be invented.
2. **DQ-MCT-2 (DI vs ID / mixed):** How should Agent 1.3 map “mixed” domestic↔international legs to `DI` vs `ID` when country-of-airport data is incomplete?
3. **DQ-MCT-3 (codeshare):** When marketing carriers differ but the operating carrier is the same, do we apply operating-carrier MCT (User Guide examples on operating carrier / codeshare indicator) by default?
4. **DQ-MCT-4 (ingestion):** How will full SSIM Ch.8 / aggregator MCT feeds be ingested into `data/reference/mct/` (OAG vs Cirium, refresh cadence, suppression records)?
5. **DQ-MCT-5 (bags / special passenger):** `has_checked_bags` and other passenger conditions — which optional SSIM MCT elements apply, and from which filing?
