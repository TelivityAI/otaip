# Stage 6 -- Settlement Agents

**Package:** `@otaip/agents-settlement`

Refund processing, ADM prevention, ADM/ACM dispute management, customer communication, feedback/complaint handling, and loyalty mileage.

---

### Agent 6.1 -- Refund Processing

**ID:** `6.1`
**Class:** `RefundProcessing`
**Status:** Implemented

ATPCO Category 33 refund processing: penalty application, commission recall, BSP/ARC reporting fields, conjunction ticket handling. Supports full, partial, and tax-only refunds.

**Input (`RefundProcessingInput`):**

- `ticket_number`, `conjunction_tickets?`
- `issuing_carrier`, `passenger_name`, `record_locator`
- `base_fare`, `base_fare_currency`, `taxes`, `commission?`
- `refund_type` -- `'FULL' | 'PARTIAL' | 'TAX_ONLY'`
- `coupons_to_refund?` -- specific coupons (for partial)
- `total_coupons`, `waiver_code?`, `fare_basis`, `is_refundable`
- `settlement_system` -- `'BSP' | 'ARC'`

**Output (`RefundProcessingOutput`):**

- `refund` -- penalty applied, base fare refund, tax refund, tax breakdown, commission recalled, net refund, BSP/ARC reporting fields, audit trail
- `net_refund_amount`, `commission_recalled`

---

### Agent 6.2 -- ADM Prevention

**ID:** `6.2`
**Class:** `ADMPrevention`
**Status:** Implemented

Pre-ticketing audit with 10 checks: duplicate booking, fare/class mismatch, passive/unable/risky status (HX/UC/UN/NO/TK + extended), churning (history-required), married segment integrity, TTL expiry (timezone / deadline-day), commission rate (caller-supplied only), endorsement box, tour code format, net remit validation.

**Domain KB:** `docs/knowledge-base/adm-prevention.md` — IATA Reso 850m covers ADM memo windows/dispute (Agent 6.3); passive/UC/churn come from carrier booking policy + host statuses. Travelport: those statuses do not need a ticketing field. No carrier-secret commission tables.

**Input (`ADMPreventionInput`):**

- `booking` -- record locator, passenger name, segments (with status, class, married group), base fare
- `fare_basis`, `booked_class`
- `commission_rate?`, `carrier_contracted_rate?` -- both caller-supplied; no embedded carrier tables
- `endorsement?`, `tour_code?`
- `is_net_remit?`, `net_contracted_amount?`
- `ttl_deadline?`, `ttl_timezone?`, `ttl_source?`, `current_datetime?`
- `duplicate_check_pnrs?`
- `segment_history?` -- required for churning; current status alone is insufficient
- `gds?` -- `SABRE` | `AMADEUS` | `TRAVELPORT` | `UNKNOWN` (Travelport DX marriage break)
- `churn_cycle_threshold?`, `churn_window_hours?`

**Output (`ADMPreventionOutput`):**

- `result` -- all check results, overall pass/fail, blocking/warning counts

---

### Agent 6.3 -- ADM/ACM Processing

**ID:** `6.3`
**Class:** `ADMACMProcessing`
**Status:** Implemented

Agency Debit Memo receipt, assessment, dispute, and Agency Credit Memo application workflows. Tracks dispute deadlines (15-day window), supports dispute grounds, and manages status transitions.

**Input (`ADMACMProcessingInput`):**

- `operation` -- `'receiveADM' | 'receiveACM' | 'assessADM' | 'disputeADM' | 'acceptADM' | 'escalateADM' | 'applyACM' | 'getADM' | 'getPendingWithDeadlines'`
- Operation-specific fields: ticket number, airline, amount, reason code, dispute ground/evidence, ADM/ACM IDs

**Output (`ADMACMProcessingOutput`):**

- `adm?` -- ADM record with status history
- `acm?` -- ACM record
- `assessment?` -- days remaining, window expired, recommended action
- `disputeResult?` -- dispute outcome
- `pendingDeadlines?` -- urgent ADMs approaching deadline

---

### Agent 6.4 -- Customer Communication

**ID:** `6.4`
**Class:** `CustomerCommunication`
**Status:** Implemented

Multi-channel customer notification generation. 8 notification types (flight cancelled, delayed, gate change, rebooking confirmed, refund processed, schedule change, waitlist cleared, ADM received) x 4 channels (Email HTML, Email text, SMS, WhatsApp).

**Input (`CustomerCommunicationInput`):**

- `operation` -- `'generateNotification' | 'generateBatch' | 'getTemplate'`
- `notificationType?` -- notification type
- `channel?` -- delivery channel
- `variables?` -- template variables (passenger name, flight info, amounts, etc.)
- `batchRequests?` -- for batch generation

**Output (`CustomerCommunicationOutput`):**

- `notification?` -- generated notification with body, subject, SMS segments, used/missing variables
- `notifications?` -- batch results
- `template?` -- template info with required variables

---

### Agent 6.5 -- Feedback & Complaint

**ID:** `6.5`
**Class:** `FeedbackComplaint`
**Status:** Implemented

Complaint submission, EU261/US DOT compensation calculation, case management with status tracking, and DOT regulatory record generation.

**Input (`FeedbackComplaintInput`):**

- `operation` -- `'submitComplaint' | 'updateStatus' | 'getCase' | 'listCases' | 'calculateCompensation' | 'generateDOTRecord'`
- Complaint fields: type, passenger, booking reference, airline, flight, description
- Compensation fields: regulation, distance, delay, alternative offered, fare paid, cabin class
- Case management: case ID, status transitions

**Output (`FeedbackComplaintOutput`):**

- `complaintCase?` -- full case record with status history, compensation result
- `cases?` -- filtered case list
- `compensation?` -- EU261/US DOT calculation (eligibility, base/final amount, reduction, notes)
- `dotRecord?` -- DOT regulatory record

---

### Agent 6.6 -- Loyalty & Mileage

**ID:** `6.6`
**Class:** `LoyaltyMileageAgent`
**Status:** Implemented

Mileage accrual calculation, redemption eligibility checking, status benefits lookup, and cross-airline status matching.

**Input (`LoyaltyMileageInput`):**

- `operation` -- `'calculateAccrual' | 'checkRedemptionEligibility' | 'getStatusBenefits' | 'matchStatus'`
- Accrual: operating/crediting carrier, booking class, distance, loyalty status
- Redemption: distance, cabin, partner flag, current balance
- Benefits: airline, status tier
- Match: source/target airline, source status

**Output (`LoyaltyMileageOutput`):**

- `accrual?` -- base miles, bonus miles, total, earn rate, partner flag
- `redemption?` -- eligibility, miles required, remaining balance
- `statusBenefits?` -- benefit list by tier
- `statusMatch?` -- matched status at target airline
