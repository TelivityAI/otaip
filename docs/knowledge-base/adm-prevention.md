# ADM Prevention — Domain Knowledge (Agent 6.2)

Authoritative input for `@otaip/agents-settlement` ADM Prevention. Sources: IATA Resolution 850m (ADM process), public GDS status/advice tables (Amadeus Service Hub; Travelport Universal API PNR Status Codes), and mid-office practice for carrier booking-policy ADMs. Anything missing is an open `DOMAIN_QUESTION` — never invent carrier-secret fee or commission tables.

## Scope split (do not conflate)

| Concern                                                                                | Authority                                                                    | What Agent 6.2 uses it for                                                                       |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ADM **memo** lifecycle — issuance windows, BSP processing limits, agent dispute period | **IATA Resolution 850m**                                                     | Context only for Agent 6.3 (dispute deadlines). 850m does **not** define passive/UC/churn rules. |
| Passive / UC / unable / schedule-change / churning ADMs                                | **Carrier booking & ticketing policies** + **GDS host segment status codes** | Pre-ticketing checks in Agent 6.2                                                                |

Typical 850m process facts used elsewhere in OTAIP (Agent 6.3): agent review/dispute window **15 days** before BSP submission; airline dispute handling expected in a timely manner (commonly up to **60 days** in carrier policies that cite 850m); BSP processing generally within **nine months** of final travel (or refund) date. Carrier policies may add market-specific overlays — do not hardcode carrier dispute SLAs here.

## Host statuses that block ticketing (core set)

Carrier booking policies and host queues treat these **advice / status** codes as must-clear before issue. Detection is from the **segment status on the PNR**, not from inventing a parallel “ticketing field.”

| Code   | Typical meaning (public GDS tables)                     | ADM / mid-office risk                                           |
| ------ | ------------------------------------------------------- | --------------------------------------------------------------- |
| **HX** | Holding canceled / cancel confirm hold                  | Dead or rejected space — remove before ticketing                |
| **UC** | Unable to confirm (often flight closed, not waitlisted) | No confirmed inventory — remove / rebook                        |
| **UN** | Unable — flight does not operate / no flight            | Schedule or sell failure — remove / reprotect                   |
| **NO** | No action taken (common airline reject of passive)      | Passive/claim rejected — delete NO segments                     |
| **TK** | Schedule change — advise passenger of new times         | Uncleared schedule change — passenger not advised / times stale |

**Travelport note:** On Travelport hosts, the statuses above are sufficient for detection — they do **not** require an additional ticketing-specific field on the segment. Status alone drives the passive/unable/schedule-change queue action.

### Per-host extended codes (NOT one IATA meaning)

**Do not globalize** HN / PK / GK / YK (or other extended codes) as a single industry-wide meaning. The same two-letter string can mean different things on Sabre vs Amadeus vs Travelport. Agent 6.2 applies these **only when `gds` is set** to that host. If `gds` is omitted / `UNKNOWN`, only the core set above applies.

| Host           | Codes treated as blocking (public host tables / ops)       | Notes                                                              |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| **Amadeus**    | HN, PK, PL, GK, GL, GN, UU, US, XX                         | PK/PL = passive sell; GK/GL/GN = ghost — Amadeus semantics         |
| **Sabre**      | YK, GK, HN, XX                                             | YK = Sabre administrative/itinerary passive; GK ≠ Amadeus ghost    |
| **Travelport** | HN, AK, AL, AN, BK, BL, DX, MK, PS, ZK, LK, UU, US, XX, XK | DX = broken marriage / marriage-integrity signal (Travelport-only) |

```
// TODO: DOMAIN_QUESTION: Confirm Sabre vs Amadeus GK semantics in each adapter's
// normalized status before treating GK as interchangeable across hosts.
// TODO: DOMAIN_QUESTION: When gds is UNKNOWN, host-specific codes are ignored
// (core only). Should UNKNOWN emit a warning instead of silent skip?
```

Active / ticketable examples (not exhaustive): **HK**, **KK**, **KL**, **RR**, **HS** (context-dependent). Do not treat “looks confirmed now” as proof the PNR was never churned — see churning.

## Churning (requires history)

**Definition (ops):** Repeated book → cancel → rebook of the same (or equivalent) air space to circumvent TTL, hold inventory, or game GDS productivity — without intent to ticket the intermediate holds.

**Hard rule:** Churning **cannot** be detected from **current** segment status alone. A PNR that is all `HK` today can still be a churn case if the history shows multiple cancel/rebook cycles on the same carrier/flight/date (or same O&D class) inside a short window.

Minimum history signals Agent 6.2 expects (when provided):

1. Ordered segment history events: `BOOKED` | `CANCELLED` | `REBOOKED` (ISO timestamps).
2. Flight identity: carrier + flight number + departure date (and optionally origin/destination).
3. Default detection heuristic (conservative, not carrier-secret): **≥ 3 cancel→rebook cycles** on the same flight identity within **72 hours** → blocking `CHURNING` failure.

If history is omitted, churning is **skipped** (not assumed clear). Callers that need churn coverage must supply history — skipping is an explicit ADM exposure.

```
// TODO: DOMAIN_QUESTION: Carrier-specific churn thresholds (cycle count / window hours)
// vary by airline booking policy. Do not hardcode a global carrier table; keep the
// default heuristic overridable once policy feeds exist.
```

## Married segments (GDS-specific)

Married segments are **host constructs**, not “segments that happen to be in the same PNR.”

| GDS            | What mid-office looks for                                                                                                             | Break risk                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Sabre**      | Married Segment Indicator (MSI) / marriage linkage on connecting sells                                                                | Partial cancel or class change on one leg of a marriage → married-segment ADM under many carrier policies |
| **Amadeus**    | Married connection / marriage control on Air Sell; status must stay consistent across the married set                                 | Splitting or mixed advice codes across the marriage                                                       |
| **Travelport** | Marriage grouping on the air segment; status **DX** can mean _broken marriage_ (passive) or authorized partial cancel within marriage | Seeing **DX** (or mixed HK + cancel advice inside one marriage group) is a red flag for integrity review  |

Agent 6.2 minimum check: every `married_group` must have identical statuses and at least two segments. When `gds` is `TRAVELPORT` and any segment status is `DX`, treat as married-integrity failure even if a group id is missing.

```
// TODO: DOMAIN_QUESTION: Exact Sabre MSI field names in OTAIP normalized PNR
// vs cryptic *IA display — confirm adapter mapping before relying on MSI alone.
```

## TTL edge cases (timezone / deadline day)

Carriers set TTL at booking, fare quote, or by departure rules — interpretation is carrier-specific. Agent 6.2 applies these operational guards when inputs are present:

1. Compare `current_datetime` to `ttl_deadline` in absolute UTC instants when both are full ISO-8601 timestamps.
2. If `ttl_timezone` is provided (IANA name), also evaluate **calendar deadline-day** in that zone: ticketing **on the same local calendar date as the deadline** is ADM-prone even when a few hours remain in UTC (carriers often ADM same-day-of-deadline issuance).
3. Distinguish `ttl_source`: `BOOKING` vs `FARE_QUOTE` vs `CARRIER_RULE` in messages — do not silently assume one source.
4. Keep a pre-issue buffer (currently 30 minutes) so the PNR cannot expire mid-transaction.

```
// TODO: DOMAIN_QUESTION: Default agency timezone vs airport-of-origin vs BSP
// market clock when ttl_timezone is absent — Agent 8.3 mid-office may share this policy.
```

## Commission

Commission validation remains **input-driven**: compare supplied `commission_rate` to caller-supplied `carrier_contracted_rate`.

**Do not** paste or hardcode carrier-secret commission tables, override grids, or net-remit contract schedules into this repository.

## Fixtures (scariest false negatives)

See `packages/agents/settlement/src/adm-prevention/__tests__/fixtures/`:

| Fixture                       | Why it is scary                                                             |
| ----------------------------- | --------------------------------------------------------------------------- |
| `churn-all-hk-now.json`       | Current statuses all HK — HX/UN/NO-only scanners pass; history proves churn |
| `uncleared-tk.json`           | TK schedule-change left on PNR — not in classic HX/UN/NO set                |
| `uc-hn-passive-pk.json`       | Amadeus UC + HN + PK — host-specific HN/PK, not a universal IATA meaning    |
| `travelport-dx-marriage.json` | Travelport DX / broken marriage without needing a ticketing field           |
| `ttl-deadline-day-tz.json`    | UTC still “has time” but local deadline day has begun                       |

## Open DOMAIN_QUESTIONs

1. Per-carrier churn cycle/window overrides (policy feed shape).
2. Sabre MSI normalized field mapping across adapters.
3. Default timezone when `ttl_timezone` omitted (agency vs origin airport vs BSP market).
4. Whether legitimate passive-for-ticketing (host claim / airline-held PNR) should warn instead of block when an airline record locator claim is present — needs claim-flow design, not a guess.
5. Confirm Sabre vs Amadeus **GK** semantics in each adapter's normalized status before treating GK as interchangeable across hosts.
6. When `gds` is UNKNOWN, host-specific codes are ignored (core only) — should UNKNOWN emit a warning instead of silent skip?
