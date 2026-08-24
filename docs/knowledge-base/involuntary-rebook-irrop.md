# Involuntary Rebook / IRROP — Domain Knowledge

Authoritative input for Agent **5.3 Involuntary Rebook**. Anything missing is an open `DOMAIN_QUESTION` at the bottom — never invent carrier policy.

**Primary regulation source (EU):** [Regulation (EC) No 261/2004](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32004R0261) (EUR-Lex CELEX:32004R0261).

**US DOT IDB source:** [14 CFR Part 250](https://www.ecfr.gov/current/title-14/chapter-II/subchapter-A/part-250) (oversales / denied boarding only).

---

## 1. IRROP trigger taxonomy

| Trigger | Meaning | Measurement point | Involuntary without carrier policy? |
| --- | --- | --- | --- |
| `TIME_CHANGE` | Schedule retimes the flight | **Carrier-defined**: departure delay **or** arrival delay — never assume which | **No.** Threshold minutes are carrier-specific. |
| `FLIGHT_CANCELLATION` | Flight cancelled | N/A (event itself) | **Yes** — cancellation is always an involuntary disruption event. |
| `MISCONNECT` | Inbound delay / connection break below MCT | Usually arrival of inbound vs MCT / outbound departure | **No.** MCT and misconnect rules are carrier-/station-specific. |
| `EQUIPMENT_DOWNGRADE` | Equipment change that reduces cabin/product | Cabin / equipment mapping | **No auto-involuntary.** Downgrade compensation is separate (Art.10 EU261 / Agent 6.5). |
| `ROUTING_CHANGE` | Intermediate points / routing altered | Routing comparison | Typically involuntary schedule change; carrier reprotection rules still apply. |

### Do **not** hardcode 60 minutes

There is **no** industry-standard IRROP time-change threshold of 60 minutes.

- Carriers publish (or operationally use) different triggers: e.g. 60 min, 90 min, “any misconnect,” arrival-based vs departure-based.
- Agent 5.3 **must fail closed**: if `thresholds.time_change_minutes` (and, for TIME_CHANGE, `thresholds.measurement_point`) are absent, treat as **non-involuntary** and emit `DOMAIN_INPUT_REQUIRED`. Do not invent a default.
- EU261 care/compensation triggers (Art.6 / Sturgeon arrival-delay case law for Art.7) are **regulatory**, not carrier IRROP definitions. Do not reuse EU261 hour bands as the carrier’s IRROP schedule-change threshold.

---

## 2. Reprotection hierarchy (pattern — not silent auto-rebook)

When the passenger elects **re-routing** (see Art.8 below), candidates are commonly ranked:

1. **Same operating carrier** — same op carrier, same or acceptable cabin/class.
2. **Marketing carrier** — codeshare / marketing plate when the ticket was sold under that marketing carrier and inventory rules allow.
3. **Alliance partner** — **not** “any Star / oneworld / SkyTeam flight.” Only partners permitted by the **ticket endorsement**, alliance reprotection agreement, and inventory.
4. **Interline** — bilateral interline / SPA allowing involuntary protection.
5. **Other** — offline / non-agreement carriers (often requires waiver / special authority).

### Endorsement constraints

- Fare endorsements such as “VALID XX ONLY”, “NO INTERLINE”, or alliance-restricted text **override** the hierarchy.
- Alliance membership alone does **not** authorize reprotection onto an arbitrary alliance flight.
- If endorsement allowance for a non–same-operating candidate is **unknown**, fail closed: exclude the candidate and surface `DOMAIN_INPUT_REQUIRED` — do not guess.

### Do **not** silently “same carrier first”

- Ranking candidates ≠ executing a rebook.
- Under **EU261 Art.8**, when the regulation applies, the passenger must be offered the **choice** between reimbursement and re-routing. Silently forcing same-carrier reprotection violates Art.8.
- Outside EU261, carrier/contract of carriage still governs; do not invent a universal auto-rebook rule. Agent 5.3 lists ordered **candidates** and flags when passenger choice is required.

---

## 3. EU261 applicability checklist (code-ready)

Source: Regulation (EC) No 261/2004 **Article 3(1)** — Scope.

| Flight geography | Operating carrier | EU261 applies? |
| --- | --- | --- |
| Departs airport in Member State / EEA (territory to which the Treaty applies; CH via bilateral — keep country list in `eu-countries.json`; **post-Brexit GB is not on this list** — see DQ-IRROP-8) | **Any** | **Yes** (Art.3(1)(a)) |
| Departs third country → arrives Member State / EEA | **Community (EU) carrier** | **Yes**, unless benefits/compensation/assistance already received in that third country (Art.3(1)(b)) |
| Departs third country → arrives Member State / EEA | **Non-EU carrier** | **No** |
| Departs third country → arrives third country | EU or non-EU | **No** (even if marketing/ticketing is EU) |

Implementation checklist:

1. Is `departure_country` in the EU/EEA(+CH) set? → apply (any carrier).
2. Else if `arrival_country` in that set **and** `is_eu_carrier` (operating / Community carrier)? → apply, subject to Art.3(1)(b) third-country benefits caveat (open input).
3. Else → does **not** apply.
4. Never use “EU carrier on any route” as a shorthand — that invents scope beyond Art.3(1).

### Article 7 — compensation bands (great circle only)

- Art.7(1) amounts (€250 / €400 / €600) and Art.7(2) 50% re-routing reductions use **distance bands**.
- Art.7(4): distances “shall be measured by the **great circle route** method.”
- **Never use TPM / MPM / IATA ticketed mileage** for Art.7 bands. TPM is a fare-construction construct; Art.7 is great-circle only.
- Cite the regulation for amounts; do not invent alternative compensation figures.

### Article 8 — passenger choice (refund vs re-route)

Art.8(1) — passengers shall be offered the **choice** between:

- **(a)** reimbursement (and, when relevant, a return flight to the first point of departure at the earliest opportunity); or
- **(b)** re-routing to final destination at the earliest opportunity under comparable conditions; or
- **(c)** re-routing at a later date at the passenger’s convenience, subject to availability.

Agent implications:

- When EU261 applies, set `art8_passenger_choice_required = true`.
- Do **not** auto-select same-carrier (or any) reprotection as the executed path.
- Candidate hierarchy applies only **after** the passenger chooses re-routing (b) or (c).

### Article 7(2) time-window reductions

When re-routing is offered under Art.8 and arrival lateness vs original schedule does not exceed:

| Distance band | Max lateness for 50% reduction |
| --- | --- |
| ≤ 1500 km | 2 hours |
| Intra-Community >1500 km, or other 1500–3500 km | 3 hours |
| Otherwise | 4 hours |

…compensation under Art.7(1) **may** be reduced by 50%. Implemented in `@otaip/core` `applyEU261` — do not duplicate with invented percentages.

---

## 4. US DOT involuntary denied boarding (IDB)

Source: 14 CFR Part 250 / §250.5.

| Rule | Fact |
| --- | --- |
| Scope | **Involuntary denied boarding due to oversales** only |
| Not covered | Delays, cancellations, schedule changes, misconnects |
| Caps | Published DOT caps (domestic / international bands); see `@otaip/core` `applyUsDotIdb` |
| Measurement | Substitute transport **arrival** lateness vs original schedule |

Agent 5.3 on a delay/cancel/rebook path must report `US_DOT` **applies: false** with an oversale-only reason. Oversale IDB compensation is Agent 6.5 territory.

---

## 5. Scenario fixtures (Agent 5.3)

Fixtures live under `packages/agents/exchange/src/involuntary-rebook/__tests__/fixtures/`:

| Fixture | Encodes |
| --- | --- |
| `eu-depart-any-carrier.json` | Art.3(1)(a): EU departure, non-EU operating carrier → EU261 applies; Art.8 choice required |
| `eu-arrive-non-eu-carrier.json` | Third-country → EU on non-EU carrier → EU261 does **not** apply |
| `us-idb-non-oversale.json` | US delay/cancel is **not** IDB; US_DOT applies false |

---

## Open DOMAIN_QUESTIONs

| ID | Question |
| --- | --- |
| DQ-IRROP-1 | Per-carrier IRROP threshold catalogue (minutes + DEPARTURE vs ARRIVAL measurement) for TIME_CHANGE. |
| DQ-IRROP-2 | Per-carrier / per-station MCT and misconnect trigger definition. |
| DQ-IRROP-3 | Alliance reprotection matrices and endorsement text parsers (which alliance flights are actually permitted). |
| DQ-IRROP-4 | When Art.3(1)(b) “already received benefits in third country” is true — data source? |
| DQ-IRROP-5 | Carrier-specific original-routing-credit / fare-basis retention on involuntary reprotection. |
| DQ-IRROP-6 | Equipment-downgrade → involuntary rebook boundary vs Art.10 cabin downgrade reimbursement only. |
| DQ-IRROP-7 | Marketing vs operating carrier resolution on codeshare PNRs for Community-carrier tests under Art.3(1)(b). |
| DQ-IRROP-8 | UK retained passenger rights (UK261) after Brexit — whether/how Agent 5.3 should treat GB departures separately from Art.3(1) Member State scope. Do not silently map GB into `eu-countries.json`. |
