# Stage 5 -- Exchange & Change Agents

**Package:** `@otaip/agents-exchange`

Voluntary change assessment, ticket reissue, involuntary rebook, and (coming soon) disruption response, self-service rebooking, and waitlist management.

---

### Agent 5.1 -- Change Management

**ID:** `5.1`
**Class:** `ChangeManagement`
**Status:** Implemented

ATPCO Category 31 voluntary change assessment: change fees, fare difference, residual value, waiver codes, Cat 31 free-change window detection, and US DOT 14 CFR §259.5(b)(4) 24-hour reservation assessment (hold **or** cancel — carrier chooses; ≥7 days before departure). See `docs/knowledge-base/us-dot-24-hour-reservation.md`.

**Input (`ChangeManagementInput`):**
- `original_ticket` -- ticket number, issuing carrier, passenger name, record locator, issue date, base fare, total tax, fare basis, refundable flag, booking date, `original_departure_date?` (for DOT 7-day check)
- `requested_itinerary` -- new segments (carrier, flight, origin, destination, date, class, fare basis), new fare, new taxes
- `waiver_code?` -- airline-provided waiver identity (not skip-penalty by itself)
- `waiver_effect?` -- required when `waiver_code` set: `ELIMINATE_PENALTY | REDUCE_PENALTY | CHANGE_REFUND_FORM | CHANGE_REBOOKING_CLASS | IRROP_INVOLUNTARY` (see `docs/knowledge-base/waiver-typology.md`)
- `waiver_penalty_reduction?` -- required for `REDUCE_PENALTY`
- `permitted_booking_classes?` / `permitted_fare_basis_patterns?` -- required for `CHANGE_REBOOKING_CLASS`
- `current_datetime?` -- ISO datetime
- `cat31_rules?` -- filed Cat 31 rules (omit → ATPCO default no charge)
- `us_dot_24h?` -- `part_259_applicable?`, `booking_channel?` (`airline_direct` | `agency` | `ndc` | `gds` | `unknown`)

**Output (`ChangeManagementOutput`):**
- `assessment` -- action (`REISSUE | REBOOK | REJECT`), change fee, fare difference, additional collection, residual value, forfeited amount, tax difference, total due, Cat 31 `is_free_change` flag, summary
- `us_dot_24h` -- carrier remedy (`cancel` | `hold` | `unknown`), eligibility, ineligibility reasons (including `departure_within_7_days`, `channel_coverage_unknown`), entitlement (`penalty_free_cancel` | `unpaid_fare_hold` | `none` | `unknown`). **Not** a free-change boolean. Channel coverage follows carrier disclosure — not a baked-in “third-party never qualifies” rule.

---

### Agent 5.2 -- Exchange/Reissue

**ID:** `5.2`
**Class:** `ExchangeReissue`
**Status:** Implemented

Ticket reissue with residual value application, **per-tax** carryforward (`CARRY | RECALCULATE | FORFEIT`), conjunction ticket handling, GDS exchange command generation, and full audit trail.

**Tax carryforward:** Same O&D ≠ keep all TFCs. Reassess per tax code (transport vs sales). YQ/YR are not assumed to carry. IROE ≠ ICER (fare ROE must not be used as tax FX). Amounts come from IATA TTBS / ATPCO / SITA — no invented statutory rates. See `docs/knowledge-base/tax-carryforward-reissue.md` and [IATA Ticket Taxes](https://www.iata.org/en/programs/airline-distribution/taxation/ticket-taxes/). Missing per-code rules **fail closed**.

**Input (`ExchangeReissueInput`):**

- `original_ticket_number`, `conjunction_originals?`, `original_issue_date`
- `issuing_carrier`, `passenger_name`, `record_locator`
- `original_base_fare`, `original_taxes` -- from original ticket
- `change_fee`, `residual_value`, `waiver_code?` -- from Agent 5.1
- `new_segments` -- new flight segments
- `new_fare`, `new_fare_currency`, `new_taxes`, `fare_calculation`
- `form_of_payment` -- for additional collection
- `gds?` -- GDS for command generation
- `tax_carryforward_context` -- geography (`SAME_AIRPORT | SAME_CITY | DIFFERENT`), validity window flag, flown status, POS unchanged
- `tax_carryforward_rules` -- per-code rules covering every tax on original ∪ new (nature, min geography, YQ/YR flags, validity expiry action)
- `same_origin_destination?` -- **deprecated / ignored** for tax decisions (migration warning only)

**Output (`ExchangeReissueOutput`):**

- `reissue` -- new ticket record with full audit trail, exchange commands, `tax_decisions` on the audit trail
- `additional_collection` -- amount due
- `credit_amount` -- amount refundable if downgrade
- `tax_decisions` -- `{ tax_code, action: CARRY | RECALCULATE | FORFEIT, reason }[]`

---

### Agent 5.3 -- Involuntary Rebook

**ID:** `5.3`
**Class:** `InvoluntaryRebook`
**Status:** Implemented

Carrier-initiated schedule change / IRROP handling. Domain KB: `docs/knowledge-base/involuntary-rebook-irrop.md` (Regulation (EC) No 261/2004 — [CELEX:32004R0261](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32004R0261)).

- **Triggers:** time change, routing change, equipment downgrade, cancellation, misconnect — with explicit dep vs arr measurement. **No hardcoded 60-minute threshold**; fail closed when carrier threshold input is missing.
- **Reprotection candidates:** same operating → marketing → alliance → interline → other, with endorsement fail-closed. Alliance ≠ any alliance flight. **Do not silently "same carrier first"** — when EU261 applies, Art.8 passenger choice (refund vs re-route) is required before execution.
- **EU261:** Art.3(1) matrix (EU depart any carrier / EU arrive Community carrier only). Art.7 compensation via great-circle bands only (never TPM). Art.8 choice surfaced on output.
- **US DOT:** 14 CFR §250 IDB is oversale-specific — delays/cancels report `applies: false`.

**Input (`InvoluntaryRebookInput`):**
- `original_pnr` -- record locator, passenger, affected segment, issuing carrier, countries, checked-in flag, EU/Community carrier flag, optional endorsement
- `schedule_change` -- change type (incl. MISCONNECT), times, routing/equipment, misconnect shortfall
- `available_flights?` -- protection candidates with operating/marketing/alliance/interline + `endorsement_allows`
- `thresholds?` -- carrier-specific `time_change_minutes`, `measurement_point` (DEPARTURE|ARRIVAL), `misconnect_minutes` — required for those triggers
- `is_passenger_no_show?` -- no-show flag
- `is_oversale_denied_boarding?` -- only true for 14 CFR §250 oversales
- `eu261_inputs?` -- great-circle `distance_km` (Art.7(4)), delay/notice/rerouting/extraordinary, third-country benefits caveat

**Output (`InvoluntaryRebookOutput`):**
- `result` -- involuntary flag, trigger, ranked protection candidates (not executed), `art8_passenger_choice_required` + `art8_choices`, measurement point, regulatory flags (EU261/US DOT), original routing credit flag, summary

---

### Agent 5.4 -- Disruption Response

**ID:** `5.4`
**Class:** `DisruptionResponseAgent`
**Status:** Coming Soon (stub)

Requires domain input on disruption priority rules and carrier-specific response procedures.

---

### Agent 5.5 -- Self-Service Rebooking

**ID:** `5.5`
**Class:** `SelfServiceRebookingAgent`
**Status:** Implemented

Orchestrates Availability Search (1.1) and Change Management (5.1) to present priced rebooking alternatives (changeFee + fareDifference + taxDifference per option). Read-only -- does NOT execute the reissue; that is Exchange/Reissue (5.2). Involuntary reasons (schedule change / missed connection / cancellation) waive the change fee; voluntary changes honor ATPCO Cat 31 via 5.1.

---

### Agent 5.6 -- Waitlist Management

**ID:** `5.6`
**Class:** `WaitlistManagementAgent`
**Status:** Implemented

Stateful in-memory passenger waitlist queue with four operations: addEntry (priority computed at add time), clear (given N seats opened, remove top-N by priority), queryStatus (1-based position + estimated clearance probability), and expire (prune entries past their cutoff). State is in-memory only -- production deployments should pair it with a durable persistence layer.
