# TMC Mid-Office — TTL Urgency (Zulu) & Travelport Host Queues

Authoritative input for Agent **8.3 Mid-Office Automation** and Agent **3.4 Queue Management**.
Sources are Travelport public format docs only. Anything unresolved is a `DOMAIN_QUESTION` below — do not invent.

Related issue: [#147](https://github.com/TelivityAI/otaip/issues/147).

---

## OTAIP default: TTL urgency uses Zulu (UTC)

### Why not agency TZ or airport TZ?

Travelport ticketing arrangement fields used for mid-office TTL sweeps are **Zulu**, not local:

> The ticketing arrangement field is based on Zulu time, not local time.

Source: [Ticketing arrangement field](https://support.travelport.com/webhelp/Formats/Content/BookFile/TktArrange.htm) (`H/T.`).

Relevant formats from that page:

| Format | Role |
| --- | --- |
| `T.TAU/12JUN` | Auto queue for ticketing on date (Zulu) |
| `T.TAW/17FEB/1600` | Manual move to queue at date/time (Zulu) |
| `ORB/TAU/11NOV-Q/56` | Move BFs with TAU for date onto a queue |
| `ORB/TAW/11NOV-Q` | Move BFs with TAW for date onto queue (default Q9) |

Issue timestamps on minimum ticketing (`T.T*` / `T.T/`) also carry a **Z** stamp (example on the same page: `T*BRU 18NOV0858Z WP AG`).

### QCC timezone is display-only

Queue Control Console (QCC) timezone settings affect **operator display**, not the host ticketing-arrangement clock. OTAIP must not reinterpret `T.TAU` / `T.TAW` / `ORB` deadlines using QCC, agency wall-clock, or first-segment airport TZ when computing urgency.

**OTAIP default:** compare `ticket_deadline` and `current_datetime` as absolute instants, and apply calendar “deadline day” rules in **Zulu (UTC)** only.

Agency TZ / airport TZ may be shown in UI copy for humans; they must not change urgency classification.

---

## Deadline-day ADM pattern (Zulu calendar day)

Some carriers ADM for **same-day-of-deadline issuance** (constitution / Agent 6.2 anti-rationalization: TTL timezone + issued-on-deadline-day). OTAIP mid-office therefore treats the **entire Zulu calendar day** of the deadline as urgent for open (unticketed) PNRs — not only the last N hours before the clock time.

Rules (Agent 8.3):

1. **Expired** — `now` (Zulu instant) ≥ deadline → `TTL_URGENT`.
2. **Deadline day (unticketed)** — Zulu `YYYY-MM-DD` of `now` equals Zulu `YYYY-MM-DD` of deadline, and ticket not yet issued → `TTL_URGENT` (deadline-day ADM pattern), even if hours remain.
3. **Hour windows** (when not already urgent via 1–2): ≤1h → `TTL_URGENT`; ≤4h → `TTL_APPROACHING`.
4. **Issued on deadline day** — if `ticket_issued_at` is present and its Zulu date equals the deadline’s Zulu date → `TTL_URGENT` with an ADM-risk message (same-day-of-deadline issuance pattern).

Golden tests encode midnight Zulu boundaries and issued-on-deadline-day cases; they must not assert agency/airport local dates.

---

## Travelport per-host queue commands (public format compare)

Source: [Queues — GDS format comparison](https://support.travelport.com/webhelp/formats/Content/FormatCompare/Queues.htm) (Travelport+ / Worldspan / Apollo columns). Cross-check: [Worldspan to Travelport+: Queues](https://support.travelport.com/webhelp/formats/Content/FormatCompare/1PQueues.htm).

Travelport+ is the current product name for the Galileo (1G) host family in these tables. OTAIP host enum: `GALILEO` ≡ Travelport+ column.

Examples use queue **40** (replace with the target queue number).

| Action | Apollo | Galileo (Travelport+) | Worldspan |
| --- | --- | --- | --- |
| Place PNR/BF on queue | `QEP/40` | `QEB/40` | `QEP/40` |
| List queues where PNR resides | `QW` | `QW` | *N/A* (not in host compare table) |
| Remove from queue | `QR` | `QR` | `QR` |
| Sign into queue (list/work) | `Q/40` | `Q/40` | `Q/40` |
| Queue count (specific) | `QC/40` | `QCB/40` | `QC/40` |
| Sign out of queue and ignore | `QXI` | `QXI` | see DOMAIN_QUESTION DQ-TQ1 |

Branch-office place (same source): Apollo/Worldspan `QEP/17X0/40`; Travelport+ `QEB/3RB/35`.

Working-queue detail for Travelport+ (sign-in / remove / where): [Working a queue](https://support.travelport.com/webhelp/Formats/Content/Queues/WorkingQueue.htm) (`H/BFQ`) — `Q/{n}`, `QR`, `QW`. That page is Travelport+-oriented; do not assume Apollo/Worldspan identity for every mnemonic on it.

**Do not** treat `QXI` as “remove from queue”. Official compare: **remove = `QR`**; **`QXI` = sign out and ignore** (BF remains on the active queue per Working a queue).

---

## DOMAIN_QUESTIONS

| ID | Question |
| --- | --- |
| DQ-TQ1 | Worldspan sign-out glyph: Format Compare shows `QX‡I`; Worldspan→Travelport+ page shows `QX#I`. Which literal should host automation emit? |
| DQ-TQ2 | Is `QW` (list queues where BF resides) truly unavailable on Worldspan in all markets, or only omitted from the public compare table? |
| DQ-TQ3 | Non-Travelport GDS (Amadeus / Sabre) TTL fields: confirm whether OTAIP should also force Zulu for urgency, or only when the deadline originated from Travelport `T.TAU`/`T.TAW`/`ORB`. |
| DQ-TQ4 | Carrier-specific “issued on deadline day” ADM: which carriers treat Zulu calendar day vs agency/BSP local day? OTAIP flags the Zulu same-day pattern globally until a carrier matrix exists. |
| DQ-TQ5 | Date-only TAU (`T.TAU/12JUN` with no time): confirm host end-of-day instant for urgency (Zulu 23:59? start of day? queue drop time?). |

Until DQ-TQ1 is answered, Agent 3.4 emits Worldspan **place / remove / sign-in / count** only and **omits** a Worldspan sign-out command rather than guessing the glyph.
