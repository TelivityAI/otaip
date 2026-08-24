# Stage 7 -- Reconciliation Agents

**Package:** `@otaip/agents-reconciliation`

BSP/ARC reconciliation, commission management, interline settlement, financial reporting, and revenue accounting.

---

### Agent 7.1 -- BSP Reconciliation

**ID:** `7.1`
**Class:** `BSPReconciliation`
**Status:** Implemented

Matches agency booking records against BSP HOT files (DISH Rev 23), validates commission rates, identifies discrepancies (missing records, duplicates, amount/commission/currency mismatches, unmatched ADM/ACM, exchange/conjunction cross-refs), and flags issues before remittance deadline.

**Domain knowledge:** [`docs/knowledge-base/bsp-hot-reconciliation.md`](../knowledge-base/bsp-hot-reconciliation.md) — HOT is DISH fixed-width (generic X12 parsers miss sections); **do not assume single-currency HOT**; transaction `CUTP` vs reporting/`BOH03` currency; **IROE ≠ ICER**; conjunction / exchange / EMD / ADM are separate; synthetic fixtures only (no live HOT dumps).

**Input (`BSPReconciliationInput`):**
- `hot_records` -- BSP HOT file records (ticket number, passenger, origin/destination, airline, amounts, commission, transaction type / DISH TRNC, **transaction currency CUTP**, optional reporting currency, billing period, ORIT / RTDN / conjunction set)
- `agency_records` -- agency-side booking records for comparison (optional `original_ticket_number`, `related_ticket_number`, `conjunction_ticket_numbers`)

**Output (`BSPReconciliationOutput`):**
- Discrepancies with severity and type (includes `UNMATCHED_EXCHANGE`, `CONJUNCTION_SET_MISMATCH`)
- Summary with `currencies_present` (multi-currency HOT awareness)
- Commission / amount compares only when agency and HOT transaction currencies match (no silent IROE/ICER FX)

---

### Agent 7.2 -- ARC Reconciliation

**ID:** `7.2`
**Class:** `ARCReconciliation`
**Status:** Implemented

Processes ARC IAR (Interactive Agent Reporting) weekly billing, validates commission rates against airline contracts, flags pricing/commission errors, and manages ADM/ACM disputes within the 15-day window.

**Input (`ARCReconciliationInput`):**
- `iar_records` -- ARC IAR records (document number, amounts, commission, transaction type, settlement week, ADM issue dates)
- `agency_records` -- agency-side records for comparison

**Output:**
- Matched/unmatched records, discrepancies with severity, ADM dispute window warnings

---

### Agent 7.3 -- Commission Management

**ID:** `7.3`
**Class:** `CommissionManagement`
**Status:** Implemented

Commission agreement management: register agreements (override, incentive, backend, net fare, standard), look up rates by airline/fare basis, validate claimed commission, and calculate incentive earnings.

**Input (`CommissionManagementInput`):**
- `operation` -- `'registerAgreement' | 'getRate' | 'validateCommission' | 'calculateIncentive' | 'listAgreements'`
- Agreement data: agent ID, airline, type, rate, basis (percent/flat per ticket/segment), fare basis patterns, validity dates, minimum tickets
- Validation: claimed rate vs expected rate
- Incentive: period, ticket count, total fare

**Output (`CommissionManagementOutput`):**
- `agreement?` -- registered agreement
- `rate?` -- applicable commission rate
- `validation?` -- match/overstated/understated status with variance
- `incentive?` -- earned incentive amount, threshold met flag

---

### Agent 7.4 -- Interline Settlement

**ID:** `7.4`
**Class:** `InterlineSettlementAgent`
**Status:** Coming Soon (stub)

Requires domain input on interline prorate methodology and SIS (Simplified Interline Settlement) billing rules before implementation can proceed.

---

### Agent 7.5 -- Financial Reporting

**ID:** `7.5`
**Class:** `FinancialReporting`
**Status:** Implemented

Generates financial reports: revenue by route/agent/corporate client, margin analysis, cost tracking, commission summary, spend by supplier, unused ticket value, and settlement summary.

**Input (`FinancialReportRequest`):**
- `type` -- report type (9 report types available)
- `period` -- date range
- `filters?` -- airlines, agents, corporate IDs, currencies, minimum amount
- `groupBy?` -- grouping dimensions
- `records` -- financial records (ticket, refund, ADM, ACM, commission, fee)
- `currency?` -- reporting currency

**Output:**
- Report line items with revenue, cost, commission, net per group
- Report totals

---

### Agent 7.6 -- Revenue Accounting

**ID:** `7.6`
**Class:** `RevenueAccounting`
**Status:** Implemented

Coupon lift tracking and revenue recognition: record lifted coupons, recognize revenue per flight, generate uplift reports (by route, by cabin), track deferred revenue from open coupons, and handle voids/refunds.

**Input:**
- `operation` -- `'recordLift' | 'recognizeRevenue' | 'getUpliftReport' | 'getDeferredRevenue' | 'recordVoid' | 'recordRefund'`
- Lift data: ticket number, coupon number, flight details, fare amount
- Report parameters: date range

**Output:**
- Lift records, revenue recognition results, uplift reports (by route/cabin with average yield), deferred revenue reports
