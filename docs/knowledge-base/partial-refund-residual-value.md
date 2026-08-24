# Partial refund / residual value — passenger path

Source: GitHub issue #150 (TMC / revenue-accounting domain input). Authoritative for Agents **5.1**, **5.2**, and **6.1**. Anything missing here is an open `DOMAIN_QUESTION` — never invent.

## Scope

This document covers **passenger-facing** residual value and partial refunds on air tickets (voluntary change residual for reissue; Cat 33 voluntary refund of unused value after partial use).

It does **not** cover airline-to-airline interline revenue allocation.

## Forbidden arithmetic (reject as a general rule)

| Invented formula | Why it is wrong |
| --- | --- |
| `residual = original − change fee` | Change fee is a **separate** Cat 31/16 collection. Residual is unused **ticketed fare value**, not fare-minus-penalty. |
| `partial refund = original − "used portion"` without a method | "Used portion" is undefined until a valuation method prices the flown sectors. |
| Coupon-count ratio (`base × refundable_coupons / total_coupons`) | Equal coupon split invents value; through fares are not linear in coupon count. |
| Haversine / great-circle split of a through fare | Distance approximation is not a published fare and is not a filed residual method. |
| MPA-P / TPM / PFM tables applied to the passenger | **MPA-P is airline interline settlement**, not passenger residual. Do not reuse interline proration for pax refunds. |

## What passenger residual actually is

**Passenger refund / residual = ATPCO Category 33 (penalty + eligibility) + THB valuation of the flown portion when the ticket is partially used.**

- **Cat 33** — voluntary refund rules: whether refund is permitted, penalty amount / forfeit flags, and the filed **re-price indicator** for how to value flown sectors.
- **THB** — **Historical Ticket Based** fares (ATPCO Cat 33 Re-Price Indicator **A**): re-price the **flown** sectors using fares in effect on the **original ticket issue date** (historical ticket date), subject to the filing’s tariff/rule/fare-class constraints. Indicator **B** (Historical Travel Commencement Based) is a different filed choice — do not silently substitute THB for B.

When the filing requires a carrier-specific formula instead of (or after) THB and that formula is not supplied as authoritative input → **fail closed** (`DOMAIN_INPUT_REQUIRED`). Do not invent TPM tables, MPA-P splits, or haversine.

## Decision tree

```text
Is the ticket fully unused (no flown coupons)?
├─ YES → Residual / refundable base = full ticketed base fare.
│         Apply Cat 31 change fee (5.1) or Cat 33 refund penalty (6.1) SEPARATELY.
│         Do NOT set residual = base − fee.
│
└─ NO (partially used)
   ├─ Cat 33 (or carrier residual filing) specifies THB (Re-Price Indicator A)?
   │  ├─ YES, and caller supplies THB-priced flown / unused amounts
   │  │     → unused_base = ticketed_base − THB_flown_base  (amounts from historical pricing)
   │  │     → apply Cat 33 penalty to unused_base (6.1)
   │  │     → for reissue residual (5.1/5.2), unused residual is the unused fare value
   │  │       after any Cat 31/33 interactions the filing requires
   │  │     → taxes: value unused taxes per tax code rules (see Tax handling)
   │  └─ YES, but THB amounts not supplied → DOMAIN_INPUT_REQUIRED
   │
   ├─ Filing specifies CARRIER_SPECIFIC residual / proration method?
   │  ├─ YES, and caller supplies the carrier-valued unused amounts → use as filed
   │  └─ YES, but amounts / method details missing → DOMAIN_INPUT_REQUIRED
   │
   └─ Method unspecified / only “original − used” asserted
      → DOMAIN_INPUT_REQUIRED (fail closed)
```

### Explicitly out of scope for passenger agents

- **MPA-P** (Multilateral Proration Agreement – Passenger) and Prorate Manual / PFM data — **interline settlement between airlines**, not passenger residual.
- Invented mileage tables, haversine splits, or equal coupon ratios.

## Tax handling on partials

Taxes are **not** the same as base fare residual.

1. Identify which tax amounts remain **unused** after the flown sectors (per tax code: airport vs enroute vs carrier-imposed YQ/YR, etc.).
2. Cat 33 / regulatory rules may require full refund of some taxes even when base is reduced; others follow unused-sector valuation.
3. Do **not** invent a coupon-ratio tax split. Caller must supply unused tax breakdown (or a domain-approved tax valuation result) when method is THB or carrier-specific.
4. Open: per-code carryforward / refundability matrices remain `DOMAIN_QUESTION` until carrier/tax tables are ingested.

## Conjunction tickets (Agent 6.1)

Conjunction sets are **all-or-none** for refund: you cannot partially refund one document in the set while leaving others. Agent 6.1 already rejects `refund_type: PARTIAL` when `conjunction_tickets` is non-empty.

**No known exception** is recorded in this KB. If a market documents an exception, open a `DOMAIN_QUESTION` with the market and carrier citation — do not code an exception here.

Exchange (5.2) must reference **all** ticket numbers in a conjunction set when exchanging; residual spans the conjunction fare, not a single coupon.

## Proposed agent interfaces (fail closed)

Callers must declare a method. Engines never invent amounts.

```ts
type PassengerResidualMethod =
  | 'FULLY_UNUSED'       // no flown coupons
  | 'CAT33_THB'          // Historical Ticket Based flown valuation supplied
  | 'CARRIER_SPECIFIC';  // carrier residual amounts supplied

interface PartialValuationInput {
  method: Exclude<PassengerResidualMethod, 'FULLY_UNUSED'>;
  /** Unused base after THB / carrier valuation (decimal string). */
  unused_base_fare: string;
  /** Optional audit: THB / carrier value of flown base. */
  flown_base_fare?: string;
  /** Unused taxes by code — required for PARTIAL money paths. */
  unused_taxes: Array<{ code: string; amount: string; currency: string }>;
}
```

- **5.1** — fully unused: `residual_value = original base`; change fee separate. Partially used: require `residual_valuation`; else `DOMAIN_INPUT_REQUIRED`.
- **5.2** — applies caller/5.1 residual; requires `residual_method`; does not recompute residual from `original − change_fee`.
- **6.1** — `PARTIAL` requires `partial_valuation`; else `DOMAIN_INPUT_REQUIRED`. No coupon-ratio fallback.

## Worked examples (made-up amounts)

Amounts below are **illustrative only** — not live tickets, not filed carrier data.

### Example A — Fully unused one-way (reissue residual)

- Ticketed base: **USD 450.00**, taxes **USD 120.00**
- Cat 31 change fee (filed): **USD 200.00**
- New fare: **USD 550.00**

| Field | Correct | Forbidden |
| --- | --- | --- |
| Residual toward new fare | **450.00** (full unused base) | 450 − 200 = 250 |
| Change fee | **200.00** add-collect | baked into residual |
| Fare difference | 550 − 450 = **100.00** | — |
| Typical add-collect (fare + fee, taxes aside) | 100 + 200 = **300.00** | 550 − 250 + 200 = 500 (double-counts fee) |

### Example B — Round-trip partially flown, Cat 33 + THB

- RT ticketed base: **USD 800.00** (OUT + RTN as one through amount on the ticket)
- Pax flew OUT only; requests refund of RTN
- THB (historical ticket date) published OW for flown OUT city pair: **USD 480.00**
- Cat 33 penalty: **USD 150.00**
- Unused taxes supplied after tax-code review: **USD 55.00**

| Step | Amount |
| --- | --- |
| Flown base (THB) | 480.00 |
| Unused base before penalty | 800 − 480 = **320.00** |
| Cat 33 penalty | 150.00 |
| Refundable base | 320 − 150 = **170.00** |
| Refundable tax | **55.00** (supplied — not 50% of original tax) |
| Net before commission | **225.00** |

Rejected alternatives for the same ticket:

- `800 × 1/2 = 400` coupon split — invented
- MPA-P / TPM split of the through fare — wrong domain (interline)
- Haversine share of 800 — invented
- `800 − "used"` with used undefined — fail closed

### Example C — One-way multi-coupon partially flown, method missing

- OW base **USD 600.00**, 2 coupons, coupon 1 flown
- No Cat 33 re-price indicator / no THB amounts / no carrier formula on input

→ Engine returns `DOMAIN_INPUT_REQUIRED` with missing `partial_valuation` / `cat33_thb_flown_amounts`. **No** residual number is emitted.

## Data dependencies (do not invent)

| Dependency | Role | Invented substitute (forbidden) |
| --- | --- | --- |
| ATPCO Cat 33 filing (incl. Re-Price Indicator) | Penalty + whether THB vs travel-commencement vs other | Hardcoded “industry default” residual math |
| Historical fare quote (ticket date) for flown sectors | THB flown base | Current-day fare, haversine, coupon ratio |
| Carrier residual / SPA formula (when filed) | CARRIER_SPECIFIC path | MPA-P / TPM tables |
| Per-tax-code unused amounts | Partial tax refund | Pro-rata by coupon count |
| MPA-P / PFM / TPM | **Not used** for passenger residual | — |

## Open DOMAIN_QUESTIONs

- **DQ-R1** — Per-carrier ingestion of Cat 33 Re-Price Indicator (A=THB vs B=travel commencement) and calculation options (Method A/B per Cat 33 Data Application).
- **DQ-R2** — Authoritative source for historical ticket-date fare quotes used as THB flown valuation (GDS informative pricing vs ATPCO fare feed).
- **DQ-R3** — Tax-code matrix for unused-tax determination on partials (especially YQ/YR and non-refundable airport charges).
- **DQ-R4** — Any documented market exception to conjunction all-or-none refunds (none known; keep fail closed).
- **DQ-R5** — Cat 31 residual interactions on **partially used** voluntary changes beyond “unused fare value + separate change fee” (carrier-specific).
