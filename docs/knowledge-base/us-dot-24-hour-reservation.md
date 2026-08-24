# US DOT 24-Hour Reservation Rule (14 CFR § 259.5(b)(4))

**Authoritative source:** 14 CFR Part 259, [CFR-2025-title14-vol4 Part 259](https://www.govinfo.gov/content/pkg/CFR-2025-title14-vol4/pdf/CFR-2025-title14-vol4-part259.pdf)  
**Primary text:** 14 CFR § 259.5(b)(4)  
**Scope:** 14 CFR § 259.2  

Do **not** invent carrier policies. If a carrier’s cancel-vs-hold election is not verified from a public carrier or DOT page, mark **`unknown`**.

---

## What the regulation requires

Each covered carrier’s Customer Service Plan must address:

> Allowing reservations to be held at the quoted fare without payment, **or** cancelled without penalty, for at least twenty-four hours after the reservation is made **if the reservation is made one week or more prior to a flight's departure**.

— 14 CFR § 259.5(b)(4)

### Hard rules (do not collapse these)

| Rule | Meaning for Agent 5.1 |
| --- | --- |
| **Hold OR cancel** | Carrier chooses **one** compliance path. Do **not** assume both. |
| **≥ 7 days before departure** | Reservation must be made **one week or more** prior to the flight’s departure. Inside that window → **no** DOT entitlement. |
| **Disclose** | Carrier must disclose the policy (Customer Service Plan / booking flow). |
| **Rule is on airlines** | §259.5 binds covered **air carriers**. Do **not** bake “third-party / OTA never qualifies” as the statute. Agency / NDC / GDS channel coverage follows the **carrier’s disclosed policy**; until verified, mark **unknown**. |
| **Not free change / reissue** | DOT does **not** require free itinerary *changes*. Do not map this rule to Cat 31 `is_free_change`. |

### Part 259 applicability (geography / carrier coverage)

Per § 259.2 (paraphrase of published text only):

- **U.S. certificated / commuter** carriers: covered flights when operating scheduled passenger or public charter service with aircraft originally designed for **30+** seats.
- **Foreign** air carriers: flights **to and from** the U.S. under the same 30+ seat condition (with stated charter exceptions).

Caller must supply whether Part 259 applies to the ticket. Do not invent coverage from airport codes alone.

---

## Applicability checklist (Agent 5.1)

Use in order. Any hard fail → not eligible under DOT 24h.

1. **Part 259 in scope?** (`part_259_applicable === true`) — else unknown / insufficient.
2. **Channel covered by carrier disclosure?** Use matrix `channels_covered` from the carrier CSP. Unverified `agency` / `ndc` / `gds` / `unknown` → `channel_coverage_unknown` (not a statutory third-party bar).
3. **Booked ≥ 7 days before departure?** If departure is inside 7 days of booking → **ineligible** (`departure_within_7_days`).
4. **Within 24 hours of reservation?** Clock starts at reservation / purchase time per carrier disclosure.
5. **Carrier remedy known?** `cancel` | `hold` | `unknown` from matrix below. Never guess.
6. **Entitlement shape:**
   - `cancel` → penalty-free **cancel/refund** (not free reissue).
   - `hold` → **unpaid** 24h fare hold (pre-payment). Not a post-purchase free change.
   - `unknown` → surface unknown; do not waive fees.

### Booking-time vs post-booking detection (OTA practice)

| When | Typical signal | Notes |
| --- | --- | --- |
| **At shopping / hold** | Carrier offers unpaid hold UI or requires payment | Hold path is pre-ticket; Agent 5.1 change assessment often N/A. |
| **At purchase confirmation** | Disclosure of 24h cancel/refund | Record `booking_date`, `original_departure_date`, channel, carrier. |
| **Post-booking (care)** | Hours since booking + days to departure + remedy | Eligible cancel ≠ Cat 31 free change. Route refunds vs reissue separately. |

---

## Carrier remedy matrix

**Values:** `cancel` | `hold` | `unknown`  
**Verification date:** ISO date of last human check of a **public** source.  
**Policy:** Prefer primary carrier Customer Service Plan / Conditions of Carriage / official refund pages. Secondary blogs do **not** count.

| Carrier | IATA | Remedy | Channels covered (CSP) | Last verified | Public source | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| American Airlines | AA | `cancel` | `airline_direct` | 2026-08-24 | [aa.com Customer Service Plan — 24-hour refund](https://www.aa.com/i18n/customer-service/support/customer-service-plan.html) | CSP discloses aa.com / AA Reservations. Agency/NDC/GDS **unknown** until CSP text verifies. |
| Delta Air Lines | DL | `cancel` | `airline_direct` | 2026-08-24 | [delta.com Customer Commitment — Risk-Free Cancellation](https://www.delta.com/us/en/legal/customer-commitment) | Direct cancel path verified. Agency/NDC/GDS **unknown**. |
| Southwest Airlines | WN | `cancel` | `airline_direct` | 2026-08-24 | [Southwest Customer Service Plan (PDF)](https://www.southwest.com/swa-resources/pdfs/corporate-commitments/customer-service-plan.pdf) | CSP §4 cancel path. Agency/NDC/GDS **unknown**. |
| United Airlines | UA | `unknown` | *(none)* | 2026-08-24 | — | No primary united.com CSP text verified in-repo this pass. |
| Alaska Airlines | AS | `unknown` | *(none)* | 2026-08-24 | — | Not verified from primary public page. |
| JetBlue | B6 | `unknown` | *(none)* | 2026-08-24 | — | Not verified. |
| Spirit | NK | `unknown` | *(none)* | 2026-08-24 | — | Not verified. |
| Frontier | F9 | `unknown` | *(none)* | 2026-08-24 | — | Not verified. |
| Hawaiian | HA | `unknown` | *(none)* | 2026-08-24 | — | Not verified. |
| *(any other)* | * | `unknown` | *(none)* | — | — | Default. |

Machine-readable copy used by Agent 5.1:  
`packages/agents/exchange/src/change-management/data/us-dot-24h-carrier-remedy.json`

---

## Proposed Agent 5.1 fields (implemented)

Do **not** overload `assessment.is_free_change` (Cat 31 filed free-change window).

| Field | Type | Role |
| --- | --- | --- |
| `us_dot_24h.carrier_remedy` | `cancel` \| `hold` \| `unknown` | Carrier election from KB |
| `us_dot_24h.eligible` | `boolean` | Current DOT entitlement (all checks) |
| `us_dot_24h.ineligibility_reasons` | string[] | Explicit failures (e.g. `departure_within_7_days`) |
| `us_dot_24h.entitlement` | `penalty_free_cancel` \| `unpaid_fare_hold` \| `none` \| `unknown` | What DOT would grant — **not** free change |
| `us_dot_24h.days_booking_to_departure` | `number \| null` | Measured window |
| Input `original_ticket.original_departure_date` | ISO date | Required for 7-day check |
| Input `us_dot_24h.booking_channel` | `airline_direct` \| `agency` \| `ndc` \| `gds` \| `unknown` | Compared to carrier `channels_covered` |
| Input `us_dot_24h.part_259_applicable` | `boolean` | Caller-supplied Part 259 scope |

---

## Open domain questions

- // TODO: DOMAIN_QUESTION: timezone for “one week prior” when departure is date-only vs local scheduled time.
- // TODO: DOMAIN_QUESTION: whether codeshare marketing vs operating carrier disclosure controls the remedy election.
- // TODO: DOMAIN_QUESTION: ingestion cadence to re-verify carrier CSP pages (matrix staleness).
- // TODO: DOMAIN_QUESTION: when a carrier CSP explicitly covers agency/NDC/GDS, add those channels to `channels_covered`.
