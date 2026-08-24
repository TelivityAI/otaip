# BSP HOT Reconciliation — Domain Knowledge (Agent 7.1)

Source: **IATA BSP Data Interchange Specifications Handbook (DISH) Revision 23**
(public overview: https://www.iata.org/en/publications/bspdish/; handbook Attachment A to PSC Resolution 750).
IROE / ICER distinction: IATA Exchange Rates Services (public).

This file is the authoritative domain input for `@otaip/agents-reconciliation` BSP HOT matching.
Anything missing is captured as an open `DOMAIN_QUESTION` at the bottom — **never invent**.

**Do not commit live HOT dumps or real agency data.** Tests use synthetic HOT-like fixtures only.

---

## 1. HOT is DISH record-level — not generic X12

Airline Accounting/Sales data (**HOT**) is specified in DISH Chapter 6 as **fixed-width positional records** with Standard Message Identifiers (`BFH01`, `BCH02`, `BOH03`, `BKT06`, `BKS24`, `BKS30`, `BKS39`, `BKS45`, `BKS46`, `BKP84-*`, totals `BOT93`/`BOT94`/`BCT95`/`BFT99`, etc.).

| Guard | Rule |
| --- | --- |
| Generic EDI X12 parsers | **STOP.** A generic X12 segment parser will miss DISH fixed-width sections and mis-map fields. Layout varies by BSP market within the DISH grids. |
| Hybrid / simplified test fixtures | Lab fixtures may use tagged or simplified layouts for readability; production ingestion must follow the market’s DISH HOT record grids. |

---

## 2. Multi-currency — do **not** assume a single-currency HOT

DISH §6.5.3 (Currency):

- **BOH03 `CUTP`** — national / default currency of the BSP (or reporting-office currency context).
- **Per-transaction `CUTP`** — currency in which **that** transaction is processed. Present on amount-bearing records (`BKS30`, `BKS39`, `BKP84`, …).
- Totals are **per currency**: `BOT93` (office subtotals by TRNC+CUTP), `BOT94`, `BCT95`, `BFT99`.
- Where an agent may accept more than one currency, **any individual sale must be paid and reported in one currency only** (`CUTP` on that transaction).
- Multi-currency BSPs may sort HOT by agent (mixed currencies) or by currency (one file per currency). Empty currency files may still be produced.

**Matching rule for Agent 7.1:** compare agency vs HOT amounts **only when transaction `CUTP` values are equal**. Never silently convert currencies. Never treat file-level default/`BOH03` currency as the amount currency for every row.

### Transaction currency vs reporting currency

| Concept | DISH / IATA field | Use in reconciliation |
| --- | --- | --- |
| **Transaction currency** | Record-level `CUTP` on the transaction’s amount records | Primary match key for fare / tax / commission / remittance amounts |
| **Reporting / default currency** | `BOH03` `CUTP` (and currency-sorted file identity) | Remittance totals context; **not** a substitute for missing per-txn `CUTP` |
| **Equivalent fare paid** | `EQFR` (BAR64 / IT07) | Present when payment currency differs from entered fare currency (PSC Reso 722 §3.18) — do not confuse with ROE tables |

### IROE ≠ ICER

| Rate product | Role | Must not be used for |
| --- | --- | --- |
| **IROE** (IATA Rates of Exchange) | Monthly rates for **fare / NUC construction** (Reso 024c) | Converting HOT remittance amounts between currencies during matching |
| **ICER** (IATA Consolidated Exchange Rates) | Daily rates for converting fares/taxes/fees to an **alternate payment currency** at pricing/ticketing | Same — not a HOT amount FX engine unless domain explicitly supplies the rate source used for that BSP period |

If a shop needs cross-currency discrepancy totals, surface **DOMAIN_QUESTION** for which published rate table and date apply — do not invent FX.

---

## 3. Transaction types are separate (TRNC)

DISH `TRNC` (BKS24) values used in HOT reconciliation (non-exhaustive; see DISH Glossary):

| TRNC | Meaning | Reconciliation category |
| --- | --- | --- |
| `TKTT` | Electronic ticket sale (automated) | Issue / sale |
| `EMDA` / `EMDS` | EMD associated / standalone | **EMD — separate from TKTT** |
| `RFND` | Refund | Refund |
| `ADMA` / `ACMA` | Agency debit / credit memo | **ADM / ACM — separate** |
| `CANX` / `CANN` / `RFNC` / … | Cancel / reversal variants | Out of simple sale match; see DISH notes |
| `TASF` / `SPCR` / `SPDR` / `SSAC` / `SSAD` | Fees / settlement-plan / summary adjustments | Separate categories |

**Exchange is not a standalone `TRNC`.** Straight / ADC exchanges are **issue transactions** (`TKTT` / EMD) whose Form of Payment includes **`BKP84-EX`**, with original-document linkage on **`BKS46` `ORIT`** (and related RET `IT03` patterns). Agent 7.1 therefore treats **exchange-linked issues** as a distinct matching path (new `TDNR` + `ORIT` / related docs), not as “same ticket number as the original.”

**Conjunction / exchange / EMD / ADM are separate** structural patterns — do not collapse them into a single ticket-number join.

---

## 4. Cross-reference patterns

All records belonging to one logical transaction share the same HOT **`TRNN`** (Transaction Number). RET `TRNN` ≠ HOT `TRNN` for the same commercial event (DISH Glossary).

### 4.1 Conjunction sets

- Primary document: `BKS24` with `TDNR`.
- Conjunction documents: `BKS24-CNJ` (and related `*-CNJ` records). `CJCP` = `CNJ` on secondary documents.
- Same `TRNN` across primary + conjunction documents.
- Billing Analysis shows sequential documents against **one** Balance Payable / Remittance Amount entry (even when straight exchange remittance is zero).
- Partial refund of a conjunction set: `BKS45` `RTDN` names the **actual** STD whose coupons were refunded (not necessarily the primary).

**Matching:** resolve conjunction membership (`primary` + `conjunction_ticket_numbers`) before calling a row “missing.” Flag set-level gaps as conjunction mismatches, not isolated ticket misses, when the rest of the set is present.

### 4.2 Exchange-linked tickets

- New document `TDNR` (issue) + `BKP84-EX` (+ optional ADC cash/card FOP).
- Original document: `BKS46` **`ORIT`** (and `ORID` / `ORIL` / `ORIA` when present).
- Even exchange: monetary fields on `BKS30` / `BKS39` / `BKP84-CA` are zeros (DISH §6.5.6 note).

**Matching keys (shop-style):** `(new_ticket, ORIT)` and/or agency exchange id — **not** ticket-number equality alone.

### 4.3 Refund / ADM / ACM linkage (`BKS45`)

`BKS45` is **only** for Refund, ADM, ACM (and sales-summary / minor-adjustment) transactions:

| Element | Role |
| --- | --- |
| `RTDN` | Related ticket/document number |
| `RCPN` | Related coupon identifier(s) |
| `DIRD` | Date of issue of related document |
| `WAVR` / `RMIC` | Waiver / reason-for-memo (first `BKS45` only) |
| `RMED` | Remittance period ending date (must match `BOH03`) |

Indirect refunds may place Refund Authority number in `BKS24` `TDNR` while `RTDN` holds the ticket being refunded.

**Matching:** ADM/ACM/RFND rows must join to agency via `RTDN` (and coupons when present), not only via memo/`TDNR` equality.

### 4.4 EMD

EMD uses its own record set (`BMD75` / `BMD76`, CNJ variants). Coupon association to tickets is EMD-side; the ticket HOT row does **not** carry the EMD reference (DISH examples). Treat EMD reconciliation as a **separate** document stream.

---

## 5. Commission fields (do not flatten)

HOT commission is not a single “rate vs claimed” check:

| Element / record | Role |
| --- | --- |
| `BKS39` `COAM` | Commission amount (signed rules differ for ADM/ACM) |
| `SPAM` / related | Supplementary / incentive components when present |
| `EFCO` | Effective commission accumulation across multiple `BKS39` |
| `CCAI` | Commission control adjustment indicator (DISH 23) |
| `TOCA` (`BKS42`) | Tax on commission (ADM/ACM-oriented rules) |

Expected rates still depend on carrier contracts (route, fare basis, class, date, net remit). See Agent 7.3 / commission KB — do not invent contract tables here.

---

## 6. Matching algorithm notes (Agent 7.1)

Recommended join order for discrepancy detection:

1. **Normalize** HOT rows into transaction envelopes keyed by `TRNN` (primary `TDNR`, `TRNC`, `CUTP`, amounts, FOP flags, `ORIT`, `RTDN`s, conjunction `TDNR`s).
2. **Index** agency rows by ticket number **and** by original/related ticket when the agency record is an exchange / memo / refund.
3. **Match** within the same logical category (sale / exchange-linked issue / EMD / refund / ADM / ACM) — categories are separate.
4. **Currency gate:** require equal transaction `CUTP` before amount/commission compare.
5. **Threshold:** apply `min_threshold` in the transaction currency (do not FX-convert the threshold via IROE/ICER).
6. **Conjunction:** if either side declares a set, require set coverage; emit set-level discrepancy when one member is absent.
7. **ADM/ACM:** unmatched memo with `RTDN` → `UNMATCHED_ADM` / `UNMATCHED_ACM`; still surface related-ticket context.
8. **Period boundary:** filter / warn using billing period (`BAED`) and remittance ending (`RMED`) — see remittance caveats below.

Tolerances beyond `min_threshold` are **shop policy** — not invented here.

---

## 7. Remittance calendar caveats

DISH defines:

- **Reporting Period** — agent reporting window.
- **Billing Period** — one or more reporting periods billed together (`BAED`).
- **Remittance Period** — span for remittance to the clearing bank; **not shorter than** one Billing Period and **may cover more than one** Billing Period (`RMED` on `BOH03` / `BKS45`).

DISH also notes there can be **several remittances per month**, and example patterns such as weekly reporting with fortnightly billing. **Market calendars (weekly / bi-monthly / monthly) and payment grace days are BSP-market specific.**

Public IATA pages describe the DISH standard and remittance *concepts*; they do **not** publish a complete per-market grace calendar usable as code defaults.

→ See **DOMAIN_QUESTION** DQ-HOT-1.

---

## 8. Open DOMAIN_QUESTIONs

| ID | Question |
| --- | --- |
| **DQ-HOT-1** | For each target BSP market (e.g. BSP UK, BSP DE), what are the remittance frequency, `RMED` relative to period end, and payment grace days? Cite the market’s public BSP calendar or BSPlink notice — do not hardcode. |
| **DQ-HOT-2** | Which commission contract source feeds Agent 7.1 expected rates (7.3 agreements vs external tariff file), and how are override / supplementary (`SPAM`) components expected to appear on agency records? |
| **DQ-HOT-3** | When agency mid-office stores only reporting currency, which explicit ICER (or other) rate date may be used for display-only FX — never for silent match conversion? |
| **DQ-HOT-4** | Market-specific HOT sort (by agent mixed-currency vs by currency file) and whether empty per-currency HOT files are delivered to this agency. |
