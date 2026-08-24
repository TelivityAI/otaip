# ATPCO Cat 31 / Cat 33 — Waiver Typology

Authoritative public source for category semantics:

- [What are ATPCO fare rules categories?](https://atpco.net/single-blog/what-are-atpco-fare-rules-categories/) (ATPCO)

Paid ATPCO manuals (Data Application / DA, The Handbook / THB, and related subscriber docs) define filed data structures in full detail. **Cite them by name only — never commit paid manual text or extracts into this repository.**

Anything not covered here is an open `DOMAIN_QUESTION` — never invent carrier fee tables.

---

## Core ATPCO facts (public)

ATPCO frames fare **rules** as the **conditions of travel** for fares (the charge the passenger pays). Categories organize those conditions by type.

**Category 31 — Voluntary Changes:** defines the **conditions and applicable charges** under which voluntary changes are permitted. **In the absence of voluntary changes data, or when no applicable provision is matched, a change is permitted at no charge and with no restrictions for that fare.**

**Category 33 — Voluntary Refunds:** defines the **conditions and applicable charges** under which voluntary refunds are permitted. **In the absence of voluntary refunds data, or when no applicable provision is matched, a refund is permitted at no charge and with no restrictions for that fare.**

(Category 16 — Penalties — historically described display/manual penalties; automated change/refund servicing is driven by Cat 31 / Cat 33.)

### Implications for Agents 5.1 and 6.1

| Situation | Correct engine behavior |
| --- | --- |
| No Cat 31 / Cat 33 rules supplied, or no provision matches | ATPCO public default: **free** change / refund (no invented penalty) |
| Filed provision matches | Apply **filed** conditions and charges as supplied on input |
| A `waiver_code` string is present | **Does not** by itself mean skip penalty |

---

## Hard rule: waiver code ≠ skip penalty

**Presence of a waiver code is identity / authorization evidence only.** It does not encode semantic effect.

Mid-office and ticketing practice (ADM risk) treats waivers as typed instructions that may:

1. **Eliminate** the Cat 31 change charge or Cat 33 refund charge
2. **Reduce** the charge (to a fixed remaining amount, or by a stated percent)
3. **Change refund form** (cash vs MCO / EMD / travel credit) without eliminating the penalty
4. **Change permitted rebooking class / fare** (Cat 31) without eliminating the change charge
5. Authorize **IRROP / involuntary** servicing (schedule change / irregular operations) as distinct from voluntary Cat 31/33

Treating “any `waiver_code` ⇒ penalty = 0” under-collects fees and generates ADMs. Agents **must fail closed** when `waiver_code` is present but `waiver_effect` is missing or unknown.

---

## Waiver effect typology (typed input)

Proposed / implemented enum for Agents 5.1 (`ChangeManagement`) and 6.1 (`RefundProcessing`):

```typescript
type WaiverEffect =
  | 'ELIMINATE_PENALTY' // zero the filed Cat 31/33 charge
  | 'REDUCE_PENALTY' // apply caller-supplied fixed remaining amount or % waived
  | 'CHANGE_REFUND_FORM' // Cat 33: cash | MCO | EMD | CREDIT — penalty still per filing
  | 'CHANGE_REBOOKING_CLASS' // Cat 31: permitted class/fare constraint — fee still per filing
  | 'IRROP_INVOLUNTARY'; // schedule-change / IRROP authorization — treat as involuntary (no voluntary penalty)
```

Supporting fields (only when required by effect):

| Effect | Required companion input | Engine behavior |
| --- | --- | --- |
| `ELIMINATE_PENALTY` | `waiver_code` | Filed charge → `0` |
| `REDUCE_PENALTY` | `waiver_penalty_reduction` (`FIXED` remaining amount **or** `PERCENT_WAIVED`) | Recompute charge from filed amount + reduction; never invent the reduction |
| `CHANGE_REFUND_FORM` | `waiver_refund_form` | Keep filed Cat 33 penalty; record form on output |
| `CHANGE_REBOOKING_CLASS` | `permitted_booking_classes` and/or `permitted_fare_basis_patterns` | Keep filed Cat 31 fee; record constraint; do not invent eligibility matrices |
| `IRROP_INVOLUNTARY` | `waiver_code` | Same monetary outcome as `is_involuntary: true` (no voluntary Cat 31/33 charge) |

**Fail closed:**

- `waiver_code` without `waiver_effect`
- `waiver_effect` not in the enum
- `REDUCE_PENALTY` without a complete `waiver_penalty_reduction`
- `CHANGE_REFUND_FORM` without `waiver_refund_form`
- `CHANGE_REBOOKING_CLASS` without at least one permitted-class / fare-basis constraint

Unknown carrier-specific mapping from free-text OSI/SSR/endorsement strings → typed effect is a `DOMAIN_QUESTION` (ingestion), not a guess.

---

## Where waiver identity typically appears (channels / fields)

These are **transport locations** for a code or memo — not a substitute for `waiver_effect`:

| Channel | Typical carriers of waiver identity |
| --- | --- |
| GDS PNR | OSI / SSR remarks; ticket endorsement box (Cat 18 text may mention restrictions; does not define typed effect) |
| Automated Cat 31 / 33 | Filed provisions and carrier General Rule / alternate-rule overrides (see paid ATPCO DA / THB — cite only, do not commit) |
| Carrier ops / IRROP | Schedule-change memos, involuntary waiver / authority codes issued for reprotection |
| NDC / order | Carrier-specific waiver or servicing reason codes on change/refund order messages |

Exact GDS field layouts and carrier code catalogues: **DOMAIN_QUESTION** (per GDS + carrier). Do not hardcode invent lists.

---

## Voluntary vs IRROP involuntary

- **Voluntary** Cat 31 / Cat 33: passenger-initiated; apply filed conditions/charges, or ATPCO no-match free default.
- **IRROP / involuntary**: carrier-initiated schedule change or irregular operations. May be signaled by `is_involuntary: true` and/or `waiver_effect: 'IRROP_INVOLUNTARY'`. Do **not** model involuntary reprotection fare rules here — that is Agent 5.3 territory.

---

## Proposed type shape (Agents 5.1 / 6.1)

```typescript
waiver_code?: string;
waiver_effect?: WaiverEffect;
waiver_penalty_reduction?:
  | { kind: 'FIXED'; amount: string; currency: string } // remaining penalty after waiver
  | { kind: 'PERCENT_WAIVED'; percent: number }; // 0–100; percent of filed penalty eliminated
waiver_refund_form?: 'CASH' | 'MCO' | 'EMD' | 'CREDIT';
permitted_booking_classes?: string[];
permitted_fare_basis_patterns?: string[];
```

---

## Open DOMAIN_QUESTIONs

1. **DQ-W1:** Per-carrier / per-GDS map from OSI/SSR/endorsement / NDC waiver strings → `WaiverEffect` (ingestion pipeline).
2. **DQ-W2:** Whether a given carrier’s “FIXED” reduction is reduce-to vs reduce-by when only free-text memos exist (engines accept explicit `FIXED` = remaining amount only when caller supplies it).
3. **DQ-W3:** Which tax codes and residual forms interact with `CHANGE_REFUND_FORM` (MCO vs EMD-S vs original FOP) per carrier EMD profile — see paid ATPCO DA / settlement docs; do not invent.
4. **DQ-W4:** Cat 31 permitted booking-class substitution tables when `CHANGE_REBOOKING_CLASS` is filed only as free text.

Until those are answered, callers must supply the typed effect (and companions). Engines fail closed otherwise.
