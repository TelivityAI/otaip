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
- `waiver_code?` -- airline-provided waiver code
- `current_datetime?` -- ISO datetime
- `cat31_rules?` -- filed Cat 31 rules (omit → ATPCO default no charge)
- `us_dot_24h?` -- `part_259_applicable?`, `booking_channel?` (`airline_direct` | `third_party` | `unknown`)

**Output (`ChangeManagementOutput`):**
- `assessment` -- action (`REISSUE | REBOOK | REJECT`), change fee, fare difference, additional collection, residual value, forfeited amount, tax difference, total due, Cat 31 `is_free_change` flag, summary
- `us_dot_24h` -- carrier remedy (`cancel` | `hold` | `unknown`), eligibility, ineligibility reasons (including `departure_within_7_days`), entitlement (`penalty_free_cancel` | `unpaid_fare_hold` | `none` | `unknown`). **Not** a free-change boolean.

---

### Agent 5.2 -- Exchange/Reissue

**ID:** `5.2`
**Class:** `ExchangeReissue`
**Status:** Implemented

Ticket reissue with residual value application, tax carryforward, conjunction ticket handling, GDS exchange command generation, and full audit trail.

**Input (`ExchangeReissueInput`):**
- `original_ticket_number`, `conjunction_originals?`, `original_issue_date`
- `issuing_carrier`, `passenger_name`, `record_locator`
- `original_base_fare`, `original_taxes` -- from original ticket
- `change_fee`, `residual_value`, `waiver_code?` -- from Agent 5.1
- `new_segments` -- new flight segments
- `new_fare`, `new_fare_currency`, `new_taxes`, `fare_calculation`
- `form_of_payment` -- for additional collection
- `gds?` -- GDS for command generation
- `same_origin_destination` -- for tax carryforward eligibility

**Output (`ExchangeReissueOutput`):**
- `reissue` -- new ticket record with full audit trail, exchange commands, tax carryforward details
- `additional_collection` -- amount due
- `credit_amount` -- amount refundable if downgrade

---

### Agent 5.3 -- Involuntary Rebook

**ID:** `5.3`
**Class:** `InvoluntaryRebook`
**Status:** Implemented

Carrier-initiated schedule change handling: trigger assessment (time change, routing change, equipment downgrade, cancellation), airline protection logic (same carrier > alliance > interline), and regulatory entitlement flags (EU261, US DOT).

**Input (`InvoluntaryRebookInput`):**
- `original_pnr` -- record locator, passenger, affected segment, issuing carrier, countries, checked-in flag, EU carrier flag
- `schedule_change` -- change type, original/new times, time change minutes, routing changes, equipment changes
- `available_flights?` -- protection flight options with carrier/alliance/interline flags
- `thresholds?` -- override involuntary trigger thresholds
- `is_passenger_no_show?` -- no-show flag

**Output (`InvoluntaryRebookOutput`):**
- `result` -- involuntary flag, trigger type, protection options (ordered by priority), protection path taken, regulatory flags (EU261/US DOT applicability), original routing credit flag, summary

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
