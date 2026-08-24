# Stage 3 -- Booking Agents

**Package:** `@otaip/agents-booking`

Distribution channel routing, PNR construction, validation, queue management, API abstraction, order management, and payment processing.

---

### Agent 3.1 -- GDS/NDC Router

**ID:** `3.1`
**Class:** `GdsNdcRouter`
**Status:** Implemented

Routes booking requests to the correct distribution channel (GDS, NDC, or direct API). **Lookup key is `(carrier, vendor, transaction)`** — never a single airline→channel map. Authoritative matrix: [`docs/knowledge-base/gds-ndc-capability-matrix.md`](../knowledge-base/gds-ndc-capability-matrix.md). Res 787 names Shop / Order / Change processes; it is not a channel parity checklist. NDC schema versions are never invented (no default `21.3`).

**Input (`GdsNdcRouterInput`):**
- `segments` -- routing segments (marketing/operating carrier, origin, destination, flight number)
- `transaction_type` -- `'shopping' | 'booking' | 'ticketing' | 'servicing' | 'group' | 'corporate'` (aliases for matrix labels Shop / OrderCreate / Servicing|OrderChange|OrderCancel / Groups / Corporate)
- `vendor?` -- `'sabre' | 'amadeus' | 'duffel' | 'navitaire' | 'trippro' | 'airline_direct' | 'unknown'` (required for unambiguous matrix lookup)
- `plating_carrier?` -- when plating ≠ marketing/operating (DOMAIN_QUESTION on precedence)
- `capability_matrix?` -- inline KB CSV-shaped rows; preferred over airline→channel maps
- `capability_overrides?` -- per-carrier, per-transaction escape hatch when matrix cell is unknown
- `preferred_channel?` -- `'GDS' | 'NDC' | 'DIRECT'`
- `preferred_gds?` -- `'AMADEUS' | 'SABRE' | 'TRAVELPORT'`
- `include_fallbacks` -- whether to include fallback channels

**Output (`GdsNdcRouterOutput`):**
- `routings` -- per-segment channel routing (primary channel, GDS system, NDC version, fallbacks, booking format); `domain_input_required` when matrix/override missing
- `unified_channel` -- whether all segments can use the same channel
- `recommended_channel` -- best channel for entire itinerary
- `gds_format` / `ndc_format` -- format translation stubs (`ndc_format` omitted when version unknown — never invents `21.3`)

---

### Agent 3.2 -- PNR Builder

**ID:** `3.2`
**Class:** `PnrBuilder`
**Status:** Implemented

Constructs GDS-ready PNR commands from normalized booking data. Supports Amadeus, Sabre, and Travelport syntax including names, segments, contacts, ticketing, SSR/OSI elements, and group bookings.

**Input (`PnrBuilderInput`):**
- `gds` -- `'AMADEUS' | 'SABRE' | 'TRAVELPORT'`
- `passengers` -- name, type, DOB, passport, gender, nationality, FOID
- `segments` -- carrier, flight, class, date, origin, destination, status
- `contacts` -- phone, email, type
- `ticketing` -- time limit, type
- `received_from` -- agent identifier
- `ssrs?` -- SSR elements (WCHR, VGML, DOCS, FOID, CTCE, CTCM, INFT)
- `osis?` -- OSI elements
- `is_group?` / `group_name?` -- group PNR support

**Output (`PnrBuilderOutput`):**
- `gds` -- target GDS
- `commands` -- ordered `PnrCommand[]` with GDS command strings and descriptions
- `passenger_count`, `segment_count`, `is_group`, `infant_count`

---

### Agent 3.3 -- PNR Validation

**ID:** `3.3`
**Class:** `PnrValidation`
**Status:** Implemented

Pre-ticketing validation with 13 checks to catch errors before ADMs: segment status, passenger data, APIS, ticketing deadline, fare consistency, and more.

**Input (`PnrValidationInput`):**
- `record_locator` -- 6-char PNR
- `passengers` -- passenger data (name, type, DOB, nationality, passport)
- `segments` -- segment data (carrier, flight, status, class, international flag, married group)
- `contact?` -- phone/email
- `ticketing?` -- time limit, arranged status
- `fare?` -- fare data with advance purchase deadline
- `validation_date?` -- ISO date override

**Output (`PnrValidationOutput`):**
- `record_locator` -- PNR
- `checks` -- `ValidationCheck[]` (13 checks, each with pass/fail, severity, message)
- `valid` -- overall pass/fail
- `error_count`, `warning_count`

---

### Agent 3.4 -- Queue Management

**ID:** `3.4`
**Class:** `QueueManagement`
**Status:** Implemented

GDS queue monitoring and processing: priority assignment, categorization, action routing, and queue command generation.

Travelport place/list/remove commands are **per host** (Apollo / Galileo≡Travelport+ / Worldspan) from the public format-compare table — see `docs/knowledge-base/tmc-mid-office-ttl-queues.md`. TTL priority uses Zulu deadline-day urgency.

**Input (`QueueManagementInput`):**
- `entries` -- queue items (record locator, GDS, queue number, entry type, deadline, remark)
- `current_time?` -- ISO timestamp for priority calculation
- `gds?` -- GDS system for command generation
- `queue_number?` -- queue to generate read commands for
- `travelport_host?` -- `'APOLLO' | 'GALILEO' | 'WORLDSPAN'` when `gds` is `TRAVELPORT`

**Output (`QueueManagementOutput`):**
- `results` -- processed items with priority, status, recommended action, target agent
- `commands?` -- GDS queue commands
- `summary` -- counts by priority (urgent/high/normal/low)

---

### Agent 3.5 -- API Abstraction

**ID:** `3.5`
**Class:** `ApiAbstraction`
**Status:** Implemented

Universal HTTP client with circuit breaker, retry logic, timeout handling, rate limiting, and IATA error normalization for GDS/NDC/payment providers.

**Input (`ApiAbstractionInput`):**
- `request` -- API request (provider ID, HTTP method, path, headers, body)
- `max_retries?` -- override retry count
- `timeout_ms?` -- override timeout
- `force?` -- skip circuit breaker check

**Output (`ApiAbstractionOutput`):**
- `response` -- API response (status, headers, body, duration, retries)
- `error` -- normalized error (category, original code, retryable flag)
- `circuit_breaker` -- circuit breaker status
- `rate_limit` -- rate limit status
- `success` -- boolean

**Constructor:** `new ApiAbstraction(handler?: RequestHandler)`

---

### Agent 3.6 -- Order Management

**ID:** `3.6`
**Class:** `OrderManagement`
**Status:** Implemented

Travel order lifecycle management: create, modify, cancel, retrieve, and list orders with status tracking and transition validation.

**Input (`OrderManagementInput`):**
- `operation` -- `'createOrder' | 'modifyOrder' | 'cancelOrder' | 'getOrder' | 'listOrders'`
- `createOrder?` -- passenger, items, currency, source
- `modifyOrder?` -- order ID, updated items/details, reason
- `cancelOrder?` -- order ID, reason
- `getOrder?` / `listOrders?` -- retrieval/filtering

**Output (`OrderManagementOutput`):**
- `order?` -- order record with status, items, history
- `orders?` -- list of orders
- `operation`, `success`, `errorCode?`, `errorMessage?`

---

### Agent 3.7 -- Payment Processing

**ID:** `3.7`
**Class:** `PaymentProcessing`
**Status:** Implemented

PCI-safe payment instruction builder and transaction recorder. Validates forms of payment, builds GDS FOP strings, records transactions. Never handles raw card numbers.

**Input (`PaymentProcessingInput`):**
- `operation` -- `'validateFOP' | 'buildPaymentInstruction' | 'recordPayment' | 'getPaymentRecord' | 'buildGDSFOPString'`
- Operation-specific data: FOP details (CC_TOKEN, BSP_CASH, AIRLINE_CREDIT, VOUCHER, UATP), amounts, references

**Output (`PaymentProcessingOutput`):**
- `validation?` -- FOP validation result
- `instruction?` -- payment instruction with GDS string, PCI-safe flag
- `record?` -- payment transaction record
- `gdsString?` -- GDS FOP string
