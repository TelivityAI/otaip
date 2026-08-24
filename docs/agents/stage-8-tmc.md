# Stage 8 -- TMC (Travel Management Company) Agents

**Package:** `@otaip/agents-tmc`

Traveler profile management, corporate account policies, mid-office automation, reporting/analytics, and duty of care.

---

### Agent 8.1 -- Traveler Profile

**ID:** `8.1`
**Class:** `TravelerProfile`
**Status:** Implemented

Traveler preferences, identity documents, loyalty programs, and PNR prefill. CRUD operations plus apply-to-PNR for generating SSR/APIS commands.

**Input:**
- `operation` -- `'get' | 'create' | 'update' | 'apply_to_pnr' | 'search'`
- Profile data: name, DOB, nationality, passport, loyalty numbers, seat/meal preference, contact info, corporate/employee ID, department, cost center
- PNR application: GDS system, segments for APIS generation

**Output:**
- `profile?` -- traveler profile record
- `profiles?` -- search results
- PNR application: generated SSR/OSI commands

---

### Agent 8.2 -- Corporate Account

**ID:** `8.2`
**Class:** `CorporateAccount`
**Status:** Implemented

Corporate travel policy management, negotiated fare lookup, and booking validation against policy rules (cabin limits, fare ceilings, advance booking, preferred/blacklisted airlines).

**Input:**
- `operation` -- `'get_account' | 'create_account' | 'update_account' | 'validate_booking' | 'get_policy' | 'list_accounts' | 'get_preferred_suppliers'`
- Account data: company name, IATA number, travel policy, negotiated fares, contact info
- Booking validation: segments, cabin, fare amount, advance days

**Output:**
- `account?` -- corporate account record
- `accounts?` -- account list
- `validation?` -- policy violations (hard/soft) with details
- `policy?` -- travel policy rules
- `suppliers?` -- preferred suppliers

---

### Agent 8.3 -- Mid-Office Automation

**ID:** `8.3`
**Class:** `MidOfficeAutomation`
**Status:** Implemented

PNR quality checks and ticketing deadline monitoring. Scans PNRs for 10 issue types: TTL urgent/approaching, missing segment status, missing APIS, missing contact/FOP, duplicate PNR, passive segment, policy violation, married segment incomplete.

**TTL policy:** urgency uses **Zulu (UTC)** — Travelport `T.TAU` / `T.TAW` / `ORB` are Zulu; QCC TZ is display-only. Deadline-day ADM pattern treats the entire Zulu calendar day of the deadline as `TTL_URGENT` for open PNRs. See `docs/knowledge-base/tmc-mid-office-ttl-queues.md`.

**Input:**
- `trigger` -- `'scheduled_sweep' | 'pnr_created' | 'ticket_deadline_approaching' | 'queue_pending' | 'manual_review_request'`
- `pnrs` -- PNR records with segments, deadlines, APIS/contact/FOP flags
- `current_datetime?` -- ISO timestamp (compared as Zulu)

**Output:**
- Per-PNR issues with severity (urgent/high/medium/low) and issue codes
- Summary counts

---

### Agent 8.4 -- Reporting & Analytics

**ID:** `8.4`
**Class:** `ReportingAnalytics`
**Status:** Implemented

Transaction aggregation and report generation across 9 report types: booking volume, revenue summary, top routes, agent productivity, policy compliance, spend by traveler/department/supplier, unused tickets.

**Input (`ReportingInput`):**
- `report_type` -- report type
- `date_from`, `date_to` -- date range
- `filters?` -- corporate ID, agent, airline, department, currency
- `transactions` -- transaction records (ticket, amounts, airline, dates, in-policy flag, used flag)

**Output:**
- Report rows grouped by the relevant dimension
- Summary totals

---

### Agent 8.5 -- Duty of Care

**ID:** `8.5`
**Class:** `DutyCare`
**Status:** Implemented

Traveler location tracking, destination risk assessment, and accountability management for corporate duty-of-care obligations.

**Input (`DutyCareInput`):**
- `operation` -- `'locate_travelers' | 'get_traveler_itinerary' | 'assess_destination_risk' | 'mark_accounted_for'`
- Itineraries: traveler ID, segments with dates/times/status
- Risk: country code
- Accountability: traveler ID

**Output:**
- `locatedTravelers?` -- current location, status (IN_TRANSIT/AT_DESTINATION/DEPARTED/UNKNOWN), accounted-for flag
- `itinerary?` -- full traveler itinerary
- `risk?` -- country risk level (low/medium/high/critical) with notes
