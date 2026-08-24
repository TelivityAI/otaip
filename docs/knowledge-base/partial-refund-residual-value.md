# Partial refund / residual value — passenger path

Source: GitHub issue #150 (TMC / revenue-accounting domain input). Authoritative for Agents **5.1**, **5.2**, and **6.1**. Anything missing here is an open `DOMAIN_QUESTION` — never invent.

Related: Cat 31/33 no-match defaults and waiver typology — issue [#138](https://github.com/TelivityAI/otaip/issues/138) / PR [#153](https://github.com/TelivityAI/otaip/pull/153) (`docs/knowledge-base/waiver-typology.md` when merged).

## Scope

This document covers **passenger-facing** residual value and partial refunds on air tickets (voluntary change residual for reissue; Cat 33 voluntary refund of unused value after partial use).

It does **not** cover airline-to-airline interline revenue allocation.

## Authoritative sources (cite; do not invent)

| Source | Role for passenger residual |
| --- | --- |
| **ATPCO Category 33** (public category definition) | Conditions and applicable charges for voluntary refunds. **No Cat 33 data, or no applicable provision matched → refund permitted at no charge** (ATPCO public default). Not fail-closed. Not a DOMAIN_QUESTION. |
| **THB — IATA Ticketing Handbook** | Industry ticketing procedures for passenger documents / residual handling. **Cite by name only — never commit paid handbook text or extracts into this repository.** |
| **MPA-P / Prorate Manual** | **Out of scope** for passenger residual — airline interline settlement only. |

Public Cat 33 wording (ATPCO): Category 33 defines the conditions and applicable charges under which voluntary refunds are permitted. In the absence of voluntary refunds data or when no applicable provision is matched, a refund is permitted at no charge and with no restrictions for that fare.

## Forbidden arithmetic (reject as a general rule)

| Invented formula | Why it is wrong |
| --- | --- |
| `residual = original − change fee` | Change fee is a **separate** Cat 31/16 collection. Residual is unused **ticketed fare value**, not fare-minus-penalty. |
| `partial refund = original − "used portion"` without a method | "Used portion" is undefined until an explicit valuation method prices the flown sectors. |
| Coupon-count ratio (`base × refundable_coupons / total_coupons`) | Equal coupon split invents value; through fares are not linear in coupon count. |
| Haversine / great-circle split of a through fare | Distance approximation is not a published fare and is not a filed residual method. |
| MPA-P / TPM / PFM tables applied to the passenger | **MPA-P is airline interline settlement**, not passenger residual. |

## What passenger residual actually is

**Passenger refund / residual is governed by ATPCO Category 33 conditions/charges, applied with ticketing practice from the IATA Ticketing Handbook (THB).**

That means:

1. **Penalty / eligibility** — from Cat 33 (filed provision, or ATPCO **no-match free** default).
2. **Unused fare value on partial use** — from an **explicit** valuation method supplied by the caller (`PUBLISHED_FARE` for flown sectors, or `CARRIER_SPECIFIC`). Engines do not invent flown amounts, MPA-P splits, or handbook extracts.

**THB is the IATA Ticketing Handbook.** Cite it by name only. Do not invent alternate expansions of the acronym, and do not commit paid handbook text.

## Fail-closed vs free — same split as #153 / waiver typology

| Situation | Correct engine behavior |
| --- | --- |
| No Cat 33 data, or no provision matches | ATPCO public default: **free** refund (no Cat 33 charge). **Not** fail-closed. **Not** a DOMAIN_QUESTION. |
| Filed Cat 33 provision matches | Apply **filed** penalty / forfeit to the unused base |
| PARTIAL / partially used without `partial_valuation` / residual method | **Fail closed** (`DOMAIN_INPUT_REQUIRED`) — unspecified method ≠ free |
| `original − used` / coupon-ratio / haversine / MPA-P asserted as method | **Fail closed** — rejected methods |
| Bare `waiver_code` without typed `waiver_effect` | **≠ free**. Fail closed / DOMAIN_QUESTION — see issue #138 / PR #153 waiver typology. Code alone does not skip penalty |

Do **not** collapse “missing Cat 33” into “missing proration method.” They are different branches.

## Decision tree

```text
Is the ticket fully unused (no flown coupons)?
├─ YES → Residual / refundable base = full ticketed base fare.
│         Apply Cat 31 change fee (5.1) or Cat 33 refund penalty (6.1) SEPARATELY.
│         Do NOT set residual = base − fee.
│         Cat 33 absent / unmatched → penalty 0 (free). Bare waiver ≠ free.
│
└─ NO (partially used)
   ├─ Explicit method PUBLISHED_FARE and caller supplies unused (+ flown) amounts?
   │  ├─ YES → unused_base from caller; apply Cat 33 penalty to unused_base
   │  │         (or free if no Cat 33 / no match)
   │  └─ amounts missing → DOMAIN_INPUT_REQUIRED
   │
   ├─ Explicit method CARRIER_SPECIFIC and caller supplies carrier-valued amounts?
   │  ├─ YES → use as filed; apply Cat 33 penalty as above
   │  └─ amounts / method details missing → DOMAIN_INPUT_REQUIRED
   │
   └─ Method unspecified / only “original − used” asserted
      → DOMAIN_INPUT_REQUIRED (fail closed)
         NOTE: this is NOT the Cat 33 no-match free path
```

### Explicitly out of scope for passenger agents

- **MPA-P** (Multilateral Proration Agreement – Passenger) and Prorate Manual / PFM data — **interline settlement between airlines**, not passenger residual.
- Invented mileage tables, haversine splits, or equal coupon ratios.
- Committing paid THB / ATPCO DA text into the repo.

## Tax handling on partials

Taxes are **not** the same as base fare residual.

1. Identify which tax amounts remain **unused** after the flown sectors (per tax code).
2. Cat 33 / regulatory rules may require full refund of some taxes even when base is reduced; others follow unused-sector valuation.
3. Do **not** invent a coupon-ratio tax split. Caller must supply unused tax breakdown with `PUBLISHED_FARE` or `CARRIER_SPECIFIC`.
4. Open: per-code matrices remain `DOMAIN_QUESTION` until carrier/tax tables are ingested.

## Conjunction tickets (Agent 6.1)

Conjunction sets are **all-or-none** for refund: you cannot partially refund one document in the set while leaving others. Agent 6.1 already rejects `refund_type: PARTIAL` when `conjunction_tickets` is non-empty.

**No known exception** is recorded in this KB. If a market documents an exception, open a `DOMAIN_QUESTION` with the market and carrier citation — do not code an exception here.

Exchange (5.2) must reference **all** ticket numbers in a conjunction set when exchanging; residual spans the conjunction fare, not a single coupon.

## Proposed agent interfaces (fail closed on method; free on Cat 33 no-match)

```ts
type PassengerResidualMethod =
  | 'FULLY_UNUSED'       // no flown coupons
  | 'PUBLISHED_FARE'     // unused/flown amounts from published fare for flown sectors
  | 'CARRIER_SPECIFIC';  // carrier residual amounts supplied (not MPA-P)

interface PartialValuationInput {
  method: Exclude<PassengerResidualMethod, 'FULLY_UNUSED'>;
  /** Unused base after published-fare / carrier valuation (decimal string). */
  unused_base_fare: string;
  /** Optional audit: flown base from that valuation. */
  flown_base_fare?: string;
  /** Unused taxes by code — required for PARTIAL money paths. */
  unused_taxes: Array<{ code: string; amount: string; currency: string }>;
}
```

- **5.1** — fully unused: `residual_value = original base`; change fee separate. Partially used: require `residual_valuation`; else `DOMAIN_INPUT_REQUIRED`.
- **5.2** — applies caller/5.1 residual; requires `residual_method`; does not recompute residual from `original − change_fee`.
- **6.1** — `PARTIAL` requires `partial_valuation`; else `DOMAIN_INPUT_REQUIRED`. Cat 33 absent/unmatched → **no penalty** on the unused base (free). No coupon-ratio fallback. Bare `waiver_code` ≠ free.

## Worked examples (made-up amounts)

Amounts below are **illustrative only** — not live tickets, not filed carrier data, not handbook extracts.

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

### Example B — Round-trip partially flown, published fare + Cat 33 penalty

- RT ticketed base: **USD 800.00** (OUT + RTN as one through amount on the ticket)
- Pax flew OUT only; requests refund of RTN
- Published OW for flown OUT city pair (caller-supplied): **USD 480.00**
- Cat 33 filed penalty: **USD 150.00**
- Unused taxes supplied after tax-code review: **USD 55.00**

| Step | Amount |
| --- | --- |
| Flown base (published fare) | 480.00 |
| Unused base before penalty | 800 − 480 = **320.00** |
| Cat 33 penalty | 150.00 |
| Refundable base | 320 − 150 = **170.00** |
| Refundable tax | **55.00** (supplied — not 50% of original tax) |
| Net before commission | **225.00** |

### Example B′ — Same itinerary, **no Cat 33 data**

- Same unused base **320.00** via `PUBLISHED_FARE`
- No `cat33_rules` on input

| Step | Amount |
| --- | --- |
| Unused base | 320.00 |
| Cat 33 penalty | **0.00** (ATPCO no-match free default) |
| Refundable base | **320.00** |

This is **not** fail-closed. Contrast: omitting `partial_valuation` entirely **is** fail-closed.

Rejected alternatives for the same ticket:

- `800 × 1/2 = 400` coupon split — invented
- MPA-P / TPM split of the through fare — wrong domain (interline)
- Haversine share of 800 — invented
- `800 − "used"` with used undefined — fail closed
- Bare `waiver_code` ⇒ treat as free — wrong (see waiver typology)

### Example C — One-way multi-coupon partially flown, method missing

- OW base **USD 600.00**, 2 coupons, coupon 1 flown
- No `partial_valuation` on input

→ Engine returns `DOMAIN_INPUT_REQUIRED` with missing `partial_valuation`. **No** residual number is emitted. (Having or lacking Cat 33 data does not fill in a proration method.)

## Data dependencies (do not invent)

| Dependency | Role | Invented substitute (forbidden) |
| --- | --- | --- |
| ATPCO Cat 33 filing | Penalty / eligibility; no-match → free | Hardcoded “industry default” residual math; inventing penalties |
| IATA Ticketing Handbook (THB) | Cite procedures by name only | Committing paid handbook text; inventing “THB = …” acronyms |
| Published fare amounts for flown sectors | `PUBLISHED_FARE` unused/flown base | Current-day guess, haversine, coupon ratio |
| Carrier residual formula (when filed) | `CARRIER_SPECIFIC` path | MPA-P / TPM tables |
| Per-tax-code unused amounts | Partial tax refund | Pro-rata by coupon count |
| MPA-P / PFM / TPM | **Not used** for passenger residual | — |

## Open DOMAIN_QUESTIONs

- **DQ-R1** — Per-carrier ingestion of Cat 33 structured data (re-price / calculation options per paid ATPCO DA — cite only, do not commit).
- **DQ-R2** — Operational source for published-fare flown valuation amounts (GDS informative pricing vs ATPCO fare feed).
- **DQ-R3** — Tax-code matrix for unused-tax determination on partials (especially YQ/YR and non-refundable airport charges).
- **DQ-R4** — Any documented market exception to conjunction all-or-none refunds (none known; keep fail closed).
- **DQ-R5** — Cat 31 residual interactions on **partially used** voluntary changes beyond “unused fare value + separate change fee” (carrier-specific).
- Waiver identity → typed effect: see issue **#138** / PR **#153** (do not treat bare waiver as free).
