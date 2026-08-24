# GDS PNR Name Commands — Adult / Child / Infant

Authoritative cryptic name-field examples for Agent 3.2 PNR Builder.
**Do not invent.** Host-specific. Infant = name field **plus** SSR INFT (where the host requires it).
Anything not cited below is an open `DOMAIN_QUESTION`.

## Sources (public only)

| Source | What it verifies |
| --- | --- |
| [Amadeus Service Hub — How to enter a name for a child or an infant (Cryptic)](https://servicehub.amadeus.com/c/portal/view-solution/913799/how-to-enter-a-name-for-a-child-or-an-infant-cryptic-) | Amadeus adult / CHD / INF (lap) forms with DOB |
| [Travelport Formats — PNR fields (GDS comparison)](https://support.travelport.com/webhelp/Formats/Content/FormatCompare/PNRFields.htm) | Side-by-side Travelport+ / Worldspan / Apollo / Amadeus / Sabre name + infant |
| [Travelport Formats — Apollo → Travelport+ BF fields](https://support.travelport.com/webhelp/Formats/Content/FormatCompare/1VBFFields.htm) | Apollo vs Travelport+ child (`*P-Cxx`) and infant (`N:I/…` vs `N.I/…`) |
| [Travelport Formats — Name field (Travelport+)](https://support.travelport.com/webhelp/Formats/Content/BookFile/NameField.htm) | Travelport+ child PTC + DOB; infant DOB mandatory; adult↔infant `SI.P#/INFT-P#` |
| [Delta Professional — Infant Ticket Information (agency GDS samples)](https://pro.delta.com/content/agency/il/en/policy-library/reservations-and-ticketing/infant-ticket-information.html) | Sabre lap infant `-I/` name + `3INFT/…` SSR (no public Sabre Format Finder / cryptic bible) |
| AIRIMP (IATA) | Interline messaging expectations for infant/child identity; does not replace host cryptic manuals |

There is **no public Sabre cryptic bible**. Sabre infant name/SSR below is taken from Delta’s published agency samples and cross-checked against Travelport’s Sabre column in the Formats comparison (`-I/LEE/ANN`). Do not map Sabre from Amadeus or from Worldspan (`-LEE/ANN*INF`).

## Host / version notes

| Host | Adult name dialect | Notes |
| --- | --- | --- |
| Amadeus | `NM1…` | Infant is attached **to the adult name element**, not a separate seated name. |
| Sabre | `-…` | Lap infant uses dedicated `-I/` name field; seat count excludes lap INF. |
| Travelport+ (1G / Galileo lineage) | `N.…` (dot) | Infant DOB mandatory in name remark; SSR INFT often auto-added. |
| Apollo (1V) | `N:…` (colon) | Same family as Travelport+ content, different punctuation; infant includes `/P-INF01`. |
| Worldspan (1P) | `-…` | Infant documented as `-LEE/ANN*INF` — **not** Sabre. |

OTAIP `TRAVELPORT` command dialect in `command-builder.ts` follows **Apollo colon** (`N:`, `P:`, `T:`, `R:`) to match existing adult/contact/ticketing emissions. Travelport+ (`N.`) and Worldspan (`-…*INF`) are documented here but **not** emitted by the builder until a host selector exists.

---

## Side-by-side examples

Examples use the same fictional party: adult **LEE/ANN MS**, child **LEE/TOM** (age 8, DOB 12JUN15), lap infant **LEE/BABY** (DOB 17JUL22) accompanying the adult.

### Adult

| Host | Command |
| --- | --- |
| Amadeus | `NM1LEE/ANN MS` |
| Sabre | `-LEE/ANN MS` |
| Travelport+ | `N.LEE/ANN MS` |
| Apollo | `N:LEE/ANN MS` |
| Worldspan | `-LEE/ANN.MS` |

### Child (2–11, seated)

| Host | Command | Source note |
| --- | --- | --- |
| Amadeus | `NM1LEE/TOM(CHD/12JUN15)` | Service Hub; DOB in name; SSR CHLD generated |
| Sabre | — | **DOMAIN_QUESTION DQ-N1** — no public Sabre Format Finder citation for child age/PTC in the name field (`*Cnn` / `CNN` / SSR `CHLD` only). Adult-style `-LEE/TOM` is the only verified name skeleton. |
| Travelport+ | `N.LEE/TOM*P-C08 DOB12JUN15` | Name field + PTC; space before `DOB` |
| Apollo | `N:LEE/TOM*P-C08` | Comparison guide; SSR CHLD may be separate |
| Worldspan | — | **DOMAIN_QUESTION DQ-N2** — child name PTC/age form not shown in the public comparison row |

### Infant (lap / not occupying a seat)

| Host | Name field | SSR INFT (when required) |
| --- | --- | --- |
| Amadeus | On adult: `NM1LEE/ANN MS(INF/BABY/17JUL22)` | Auto when INF is in the name element; manual `SRINFT…` if needed |
| Sabre | `-I/LEE/BABY` | `3INFT/LEE/BABY/17JUL22-1.1` (adult name number) |
| Travelport+ | `N.I/LEE/BABY*17JUL22` | Usually auto; link non-default adult via `SI.P#/INFT-P#` |
| Apollo | `N:I/LEE/BABY*17JUL22/P-INF01` | Per Formats Apollo column |
| Worldspan | `-LEE/BABY*INF` | Per Formats Worldspan column — **do not use for Sabre** |

Different infant surname (Amadeus only, verified):

```text
NM1LEE/ANN MS(INFSMITH/BABY/17JUL22)
```

Sabre multi-infant same surname (Delta):

```text
-I/3OBI/MARY/JUNE/BRANDON
```

---

## Edge cases

| Topic | Verified behavior | Open |
| --- | --- | --- |
| Infant without accompanying adult association | Sabre/Travelport: name field still entered; association is via SSR / `SI.P#/INFT-P#` / default-first-adult | Which adult index OTAIP must force when host defaults to P1 — **DQ-N3** |
| Infant DOB format | DDMMMYY in Amadeus `(INF/…)`, Sabre `3INFT`, Travelport name remark | Century disambiguation for YY — **DQ-N4** |
| Titles on INF/CHD | Amadeus examples often omit infant title; Sabre titles vary by carrier | Carrier-mandatory titles (MSTR/MISS) — **DQ-N5** |
| Infant with seat (INS) | Amadeus `NM1…(INS)` + `SRINFT…`; Travelport+ `N.…*P-INS`; Sabre uses seated name + `3INFT/…/OS-…` (Delta) | OTAIP `passenger_type` has no `INS` — **DQ-N6** |
| Child age for `P-Cxx` | Travelport uses two-digit age in PTC | Age as-of booking vs first departure — **DQ-N7** |
| Which Travelport host OTAIP `TRAVELPORT` means | Builder currently emits Apollo-style colon | Explicit host enum (Apollo / Travelport+ / Worldspan) — **DQ-N8** |

---

## Open DOMAIN_QUESTIONs

1. **DQ-N1** — Sabre child name-field age/PTC cryptic: what is the Format Finder–authoritative form (`*C08`, name reference, SSR `CHLD` only, or API `CNN` only)?
2. **DQ-N2** — Worldspan child name PTC/age cryptic form?
3. **DQ-N3** — When `infant_accompanying_adult` is not the first adult, confirm Sabre name-number vs Travelport `SI.P#/INFT-P#` emission rules for OTAIP.
4. **DQ-N4** — Confirm YY century window for DOB in name/INFT across hosts.
5. **DQ-N5** — Carrier rules for mandatory CHD/INF titles.
6. **DQ-N6** — Should OTAIP add `INS` (infant with seat) as a passenger type?
7. **DQ-N7** — Child age for Travelport `P-Cxx`: booking date vs first segment departure date?
8. **DQ-N8** — Should `GdsSystem` / input gain a Travelport host discriminator?

---

## Builder mapping (Agent 3.2)

| Path | Emitted when verified inputs present | Not emitted / DOMAIN_QUESTION |
| --- | --- | --- |
| Amadeus ADT | `NM1SURNAME/FIRST TITLE` | — |
| Amadeus CHD + DOB | `NM1SURNAME/FIRST(CHD/DDMMMYY)` | CHD without DOB |
| Amadeus INF + DOB | Appended on accompanying adult name | Separate `NM1…(INF)` (incorrect) |
| Sabre ADT | `-SURNAME/FIRST TITLE` | — |
| Sabre CHD | Adult-style name only | Age/PTC in name field (DQ-N1) |
| Sabre INF | `-I/SURNAME/FIRST` + `3INFT/…/DDMMMYY-n.1` when DOB present | Invented `*INF` (that is Worldspan) |
| Travelport (Apollo dialect) ADT | `N:1SURNAME/FIRST TITLE` (existing) | Travelport+ / Worldspan dialects (DQ-N8) |
| Travelport CHD + DOB | `N:1SURNAME/FIRST*P-Cxx` (age from DOB vs first segment; DQ-N7) | CHD without DOB |
| Travelport INF + DOB | `N:I/SURNAME/FIRST*DDMMMYY/P-INF01` | INF without DOB; Worldspan `*INF` |
