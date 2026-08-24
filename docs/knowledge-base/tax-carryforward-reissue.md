# Tax carryforward on reissue (Agent 5.2)

Authoritative input for Exchange/Reissue tax handling. **Do not invent statutory rates.** Amounts and applicability rules belong in IATA / ATPCO / SITA feeds (see sources). This note documents **decision dimensions** only.

Issue: [#139](https://github.com/TelivityAI/otaip/issues/139). Guard: `CLAUDE.md` → Agent 5.2.

## Sources (amounts and published rules)

| Source                                                                                            | Role                                                                                                                |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [IATA Ticket Taxes](https://www.iata.org/en/programs/airline-distribution/taxation/ticket-taxes/) | Industry TTFC best practices; Ticket Tax Box Service (TTBS) for published passenger ticket taxes, fees, and charges |
| IATA TTBS                                                                                         | Official rules and **rates** per tax code — not hardcoded in agents                                                 |
| ATPCO / SITA tax data                                                                             | Structured filing / distribution feeds used by GDS and pricing systems                                              |

Agents must **not** embed country statutory percentages or fixed amounts. Collect or reassess amounts via the feeds above.

## Core rule

**Same origin & destination (O&D) is not sufficient to keep all TFCs.**

`same_origin_destination === true` must never mean “carry every tax on the original ticket.” Carryforward is decided **per tax code**.

## Decision model

Each tax on the original and/or new ticket yields one decision:

```ts
{
  tax_code: string;
  action: 'CARRY' | 'RECALCULATE' | 'FORFEIT';
  reason: string;
}
```

| Action        | Meaning on reissue                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `CARRY`       | Keep the already-collected amount for this code (collect only a documented delta if the feed says the new amount is higher)            |
| `RECALCULATE` | Do not trust the original amount; use the newly assessed amount from TTBS/ATPCO/SITA for the new itinerary                             |
| `FORFEIT`     | Original amount for this code is not credited forward; apply the new assessment (if any) without residual credit for the forfeited tax |

## Decision dimensions (not a world tax database)

Evaluate **every** tax code against these dimensions. Rules for a code are supplied by the caller from TTBS/ATPCO/SITA — the engine fails closed when a code has no rule.

### 1. Tax nature: transport vs sales

| Nature                                                   | Typical binding                           | Reissue implication                                                        |
| -------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| **Transport** (journey / passenger / airport / facility) | Segments, airports, routing, travel dates | Same city-pair text is not enough; airport vs city and flown status matter |
| **Sales** (point-of-sale / ticketing-location)           | Where the ticket is sold or issued        | O&D unchanged does not imply the sales tax still applies or still carries  |

Do not treat all TFCs as one bucket. A transport tax may `CARRY` while a sales tax on the same reissue must `RECALCULATE` or `FORFEIT`, or the reverse — only the per-code rule says which.

### 2. Geography: same airport vs same city

Some codes require the **same airport**; a same-city / different-airport change (e.g. JFK ↔ EWR, LHR ↔ LGW) breaks carryforward even when marketing O&D “looks” unchanged. Other codes allow same-city. The minimum geography is **per tax code**, never global.

### 3. Validity windows

Many TFCs are valid only for travel (or ticketing) within a published window. If the new travel falls outside that window, do not `CARRY` — `RECALCULATE` or `FORFEIT` per the filed rule.

### 4. Partially flown itineraries

When coupons are already used, residual tax treatment is not “keep everything that matched O&D.” Partially flown status is a first-class dimension: many codes force `RECALCULATE` (or `FORFEIT`) for the unflown remainder.

### 5. Carrier-imposed surcharges: YQ / YR

**Do not assume carryforward for YQ or YR** (or similar carrier-imposed fuel/carrier charges filed as TFCs).

Same O&D must not auto-`CARRY` YQ/YR. Default stance in this platform: treat YQ/YR as **`RECALCULATE`** unless a **carrier-specific** rule explicitly authorizes carry (`explicit_carry_authorized`). Never invent YQ/YR amounts.

### 6. Exchange rates: IROE ≠ ICER

| Rate                                                                                 | Used for                                            |
| ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| **IROE** (IATA Rate of Exchange)                                                     | Fare construction / NUC conversion                  |
| **ICER** (settlement / tax currency conversion rate as published for tax collection) | Tax amount conversion when reassessment requires FX |

**IROE must not be substituted for ICER** (or vice versa) when converting or reassessing taxes. If a reissue needs FX for a tax amount, the rate source is the tax/settlement feed — not the fare ROE table. Surface a domain question if the ICER source is not wired; do not hardcode a rate.

## Fail-closed policy

| Situation                                                                | Required behavior                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------- |
| Tax code present on original or new ticket with **no** carryforward rule | Reject / error — do not guess `CARRY`              |
| Only `same_origin_destination` supplied, no per-code rules               | Insufficient — must not keep all taxes             |
| YQ/YR without explicit carry authorization                               | `RECALCULATE` (never silent `CARRY` from same O&D) |
| Statutory amount unknown                                                 | Do not invent; use TTBS/ATPCO/SITA or fail         |

## Anonymized scenarios (boolean same-O&D vs per-tax)

Amounts below are **illustrative placeholders** (`…`), not statutory rates.

| #   | Situation                                                      | Boolean same-O&D outcome (wrong)  | Per-tax outcome (right)                                                              |
| --- | -------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Same city, airport change (JFK→EWR); airport PFC-class code    | Carry all                         | Airport-bound code → `RECALCULATE` or `FORFEIT`; other codes per rule                |
| 2   | Same airports; YQ present                                      | Carry YQ                          | YQ → `RECALCULATE` unless carrier rule authorizes carry                              |
| 3   | Same O&D; YR present                                           | Carry YR                          | YR → `RECALCULATE` (same as YQ stance)                                               |
| 4   | Same airports; tax validity window expired for new date        | Carry                             | Expired code → `RECALCULATE` or `FORFEIT` per rule                                   |
| 5   | Outbound flown, return changed; mixed TFCs                     | Carry all remaining               | Partially flown → per-code; many transport codes `RECALCULATE`                       |
| 6   | Same O&D; sales-tax-class code, POS unchanged                  | Carry all including sales         | Sales nature still **reassessed per rule** — not automatic carry                     |
| 7   | Same O&D; sales-tax-class code, POS/ticketing location changed | Carry                             | Sales code → `RECALCULATE` or `FORFEIT`                                              |
| 8   | Same O&D; transport tax allows same-airport carry              | Carry all                         | That code → `CARRY`; YQ still `RECALCULATE`                                          |
| 9   | Different O&D                                                  | Recollect all                     | Still per-code (some rare codes may still carry only if rule says so — never invent) |
| 10  | Tax amount needs FX on reissue                                 | Apply IROE from fare construction | Use **ICER** (tax/settlement rate), not IROE                                         |

## Proposed input / output shape (Agent 5.2)

**Context** (dimensions for this reissue):

- `geography_match`: `SAME_AIRPORT` \| `SAME_CITY` \| `DIFFERENT`
- `within_validity_window`: boolean (caller evaluates published windows per feed; engine does not invent dates)
- `flown_status`: `UNFLOWN` \| `PARTIALLY_FLOWN` \| `FULLY_FLOWN`
- `point_of_sale_unchanged`: boolean (sales-tax dimension)

**Per-code rule** (from TTBS/ATPCO/SITA — no amounts):

- `tax_code`
- `nature`: `TRANSPORT` \| `SALES`
- `min_geography`: `SAME_AIRPORT` \| `SAME_CITY`
- `carry_never?: boolean` (YQ/YR profiles set this)
- `explicit_carry_authorized?: boolean` (required before YQ/YR may `CARRY`)
- `recalculate_when_partially_flown?: boolean`
- `on_validity_expired`: `RECALCULATE` \| `FORFEIT`
- `recalculate_when_pos_changed?: boolean` (typical for `SALES`)

**Output:** `tax_decisions: TaxCarryforwardDecision[]` on the exchange audit trail, plus carried / new tax line items derived only after decisions.

## Open DOMAIN_QUESTIONs

- **DQ-TC1** — Per-market mapping of tax codes → `TRANSPORT` vs `SALES` when TTBS classification is ambiguous.
- **DQ-TC2** — Authoritative ICER feed wiring for tax FX on reissue (must not reuse IROE).
- **DQ-TC3** — Carrier catalogue of YQ/YR codes that ever allow `explicit_carry_authorized`.
- **DQ-TC4** — Conjunction / partial-refund interaction when some codes `FORFEIT` and others `CARRY` on the same reissue.

## Related

- Agent 5.2: `packages/agents/exchange/src/exchange-reissue/`
- Spec: `docs/agents/stage-5-exchange.md`
- CLAUDE.md Agent 5.2 anti-rationalization table (tax carryforward row)
