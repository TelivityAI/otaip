# OTAIP — Claude Code Constitution

## Core Rule
**DO NOT INVENT DOMAIN LOGIC.** All travel domain knowledge comes from files in `docs/knowledge-base/`. If something is ambiguous or missing, write a `// TODO: DOMAIN_QUESTION: {question}` comment and move on. Do not guess. Do not fill gaps from "general knowledge." Hotel and airline domains have edge cases that seem obvious but aren't.

## When Blocked
If you lack domain input to proceed: refactor, clean, document existing code, then surface the blocking question. Never invent travel industry behavior.

## Tech Stack
- TypeScript (`strict: true`, plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`; `exactOptionalPropertyTypes` is off — enabling it would require widespread call-site changes, tracked as a separate cleanup)
- Node.js >=24
- pnpm 10+ (workspace monorepo)
- Vitest for testing
- tsup for building
- ESLint + Prettier for linting/formatting
- ESM modules (type: "module")

## Agent Contract
Every agent implements:
```typescript
interface Agent<TInput, TOutput> {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  initialize(): Promise<void>;
  execute(input: AgentInput<TInput>): Promise<AgentOutput<TOutput>>;
  health(): Promise<AgentHealthStatus>;
}
```
Imported from `@otaip/core`.

## Error Handling
Use existing error classes from `@otaip/core`:
- `AgentNotInitializedError` — execute() before initialize()
- `AgentInputValidationError` — bad input (with field + reason)
- `AgentDataUnavailableError` — external source down
- `AgentError` — base class for custom errors

## Agent File Structure
Follow the pattern in `packages/agents/reference/src/airport-code-resolver/`:
```
{agent-name}/
  types.ts          — all input/output/internal types
  {logic}.ts        — core business logic (pure functions)
  index.ts          — Agent interface implementation
  __tests__/
    {agent}.test.ts  — vitest tests
```

## Rules
- No `any` types without explicit justification comment
- No secrets or API keys in code
- No hardcoded credentials
- Every agent needs tests
- Agents are stateless
- Use existing error classes, don't create new ones unless necessary
- Mock external APIs in tests — never call real APIs from tests

## Domain Knowledge
- Air: `docs/knowledge-base/` (existing)
- Lodging: `docs/knowledge-base/lodging.md`
- BSP HOT (Agent 7.1): `docs/knowledge-base/bsp-hot-reconciliation.md` (DISH Rev 23; multi-currency CUTP; IROE≠ICER; conjunction/exchange/EMD/ADM separate)
- Agent definitions: `docs/agents/`

## Repository Structure
```
packages/
  core/                — base types, errors, shared utilities
  connect/             — distribution adapter framework (Sabre, Amadeus, Navitaire, TripPro, HAIP)
  adapters/
    duffel/            — standalone Duffel NDC adapter
  agents/              — nested by stage (preferred convention for stage agents)
    reference/         — Stage 0: airport codes, airline codes, etc.
    search/            — Stage 1: availability, fare shopping, connections
    pricing/           — Stage 2: fare rules, tax calc, offer builder
    booking/           — Stage 3: PNR, payment, order management
    ticketing/         — Stage 4: issuance, EMD, void
    exchange/          — Stage 5: changes, reissue, involuntary rebook
    settlement/        — Stage 6: refunds, ADM, loyalty
    reconciliation/    — Stage 7: BSP, ARC, commission, reporting
    lodging/           — Stage 20: hotel booking lifecycle
  agents-platform/     — Stage 9: orchestrator, knowledge, monitoring (flat — legacy convention)
  agents-tmc/          — Stage 8: TMC operations (flat — legacy convention)
```

### Path conventions
- **Stage agents** (0-7, 20): nested under `packages/agents/{stage-name}/`
- **Platform/TMC agents** (8-9): flat at `packages/agents-platform/` and `packages/agents-tmc/`
- Both conventions coexist. New agents should use the nested `packages/agents/` pattern.
- Agent source goes under `src/{agent-name}/` regardless of package layout.

## Anti-Rationalization Guards

When building agents, Claude Code will attempt to rationalize inventing domain logic rather than surfacing blocking questions. These tables name the exact patterns. If you catch yourself thinking any of these, STOP and write a `// TODO: DOMAIN_QUESTION` comment instead.

### Agent 2.1 — Fare Rule Agent

| Rationalization | Required response |
|---|---|
| "ATPCO categories 1-20 follow a standard structure that I can implement generically" | STOP. Each ATPCO category has a completely different data structure, matching logic, and application order. There is no generic implementation. Check KB for the specific category's data specification. |
| "Advance purchase rules just check the number of days between booking and departure" | STOP. ATPCO Cat 5 has multiple conditions: days before departure vs first international segment, ticketing deadline vs booking deadline, calendar days vs 24-hour periods. Some reference ORIGINAL booking date for exchanges. Check KB for Cat 5 data elements. |
| "Blackout dates are straightforward — travel is not permitted on those dates" | STOP. Blackout dates interact with travel restrictions (Cat 11 vs Cat 14), may apply to outbound/inbound/both, may reference departure/arrival/first-travel date, and may have exceptions by booking class. Check KB before implementing. |
| "Minimum/maximum stay rules check the total trip duration" | STOP. Min/max stay measurement points vary by fare — first departure to last return, destination arrival to return departure, first international departure. Saturday/Sunday rules have specific hour requirements. Check KB for the exact measurement definition. |
| "Penalty rules are in Category 16 — I'll implement the standard fee structure" | STOP. Cat 16 includes voluntary change, voluntary cancel, and no-show — each separate. Penalties may be fixed, percentage, or non-refundable. Cat 16 interacts with Cat 31 and Cat 33 in non-obvious ways. Check KB for the specific Cat 16 data AND whether Cat 31/33 overrides apply. |
| "I'll parse the fare rules from the GDS fare display response" | STOP. GDS fare rule displays are FORMATTED TEXT for human reading, not structured data. ATPCO provides structured data feeds (Record 1/2/3) that are the authoritative source. Do not parse formatted text unless ATPCO structured data is confirmed unavailable. Check KB for data source options. |

### Agent 2.2 — Fare Construction Agent

| Rationalization | Required response |
|---|---|
| "NUC conversion uses a standard multiply-and-round pattern, I'll apply banker's rounding" | STOP. IATA Resolution **024d** uses per-currency units with **HX** (round up) or **NX** (nearest). Banker's / half-to-even is not a substitute. Check KB `docs/knowledge-base/fare-construction-data-dependencies.md`. |
| "ROE rates change periodically, I'll use a hardcoded value for now as a placeholder" | STOP. **IROE** values are published by IATA monthly for **fare construction** (Res 024c). Hardcoded rates produce wrong fares immediately. Pass licensed rates via `data_sources.iroe` or surface DOMAIN_INPUT_REQUIRED. Do not commit proprietary IROE files. Do **not** use IROE for ticket-tax / payment FX — that is **ICER** ([xrates](https://www.iata.org/en/services/finance/xrates/)). |
| "TPM/MPM mileage data isn't available, I'll approximate the distance using haversine between airports" | STOP. TPM is NOT great-circle distance. TPM is published by IATA ([TPM Manual](https://www.iata.org/en/publications/manuals/mileage/ticketed-point-mileage-tpm/)). HIP/BHC/CTM depend on exact TPM. Fail closed — never approximate. |
| "The HIP check logic seems straightforward — just compare the fare to the sum of sector fares" | STOP. HIP/BHC/CTM each have different comparison rules, directionality requirements, and NUC-vs-local-currency considerations. Check KB for the exact ATPCO comparison logic before implementing. |
| "For multi-sector itineraries, I'll prorate the fare evenly across segments" | STOP. IATA fare proration uses TPM-based proportional allocation, not equal division. Check KB for the exact proration formula. |
| "I don't have the fare construction rules for this specific routing, I'll use the published fare directly" | STOP. Published fares and constructed fares are different pricing mechanisms. Do not conflate them. Surface as DOMAIN_QUESTION: which fare type applies? |
| "The mileage system and routing system are equivalent for this itinerary" | STOP. Mileage system and routing system are two separate IATA pricing mechanisms with different rules and different outputs. Check KB before assuming which applies. |

### Agent 3.1 — GDS/NDC Router Agent

| Rationalization | Required response |
|---|---|
| "Airline X supports NDC, so I'll route all bookings through NDC" | STOP. Airlines have varying NDC adoption levels by transaction type and vendor. Some support NDC for shopping only. Some require NDC for certain fare types but GDS for others. Check `docs/knowledge-base/gds-ndc-capability-matrix.md` for the carrier×vendor×transaction matrix. Res 787 is the Offer/Order process standard — not a channel parity checklist. |
| "NDC version 21.3 is widely supported, I'll default to that" | STOP. NDC versions are NOT backward compatible in all cases. Carriers implement specific versions with carrier-specific extensions. Check the matrix `ndc_version_notes` for the specific carrier×vendor. Never invent a version. |
| "Codeshare flights route through the marketing carrier's channel" | STOP. Codeshare routing depends on ticketing arrangement, inventory control (free-sale vs blocked space), and plating carrier. Some require dual-channel booking. Check KB for the codeshare agreement's booking rules. |
| "I'll map each airline to either GDS or NDC as their primary channel" | STOP. Most NDC airlines still require GDS for specific scenarios (groups, tours, corporate fares, post-booking servicing). The routing decision must be PER-TRANSACTION, not per-airline. Check KB for channel capability per transaction type. |

### Agent 5.1 — Change Management Agent

| Rationalization | Required response |
|---|---|
| "ATPCO Category 31 penalties follow a standard structure — I'll implement the common patterns" | STOP. Cat 31 has multiple distinct fare rule patterns that interact with booking class, time before departure, and voluntary/involuntary status. Check KB for the specific carrier's Cat 31 data. |
| "The US DOT 24-hour rule means free cancellation within 24 hours of booking" | STOP. The rule requires EITHER 24hr free cancellation OR 24hr fare hold (carrier chooses). Only applies 7+ days before departure. Only applies to US flights. Implementation varies by carrier and booking channel. Check KB for specifics. |
| "Waiver codes bypass the standard penalty — I'll just skip the fee calculation when a waiver is present" | STOP. Waivers have different types with different effects (reduce, eliminate, change rebooking class). Do not treat all waivers as "skip penalty." Surface as DOMAIN_QUESTION: what is the waiver type and its specific effect? |
| "BASIC economy / non-refundable fares simply cannot be changed" | STOP. This varies by carrier, market, and regulation. Some carriers allow changes with penalty, some allow same-day standby. EU regulations may override carrier restrictions. Check KB before implementing blanket restrictions. |
| "Residual value for a partially flown ticket is the original fare minus the flown portion" | STOP. Passenger residual = Cat 33 + IATA Ticketing Handbook (THB) practice; unused value via published fare for flown sectors or carrier-specific amounts. MPA-P is interline — not pax residual. Never haversine-split a through fare. See `docs/knowledge-base/partial-refund-residual-value.md`. |

### Agent 5.2 — Exchange/Reissue Agent

| Rationalization | Required response |
|---|---|
| "Residual value is simply the original fare minus the change fee" | STOP. Change fee is a separate Cat 31 collection. Fully unused residual = ticketed base. Partially used = Cat 33 + THB (or carrier-specific) unused value — never original − fee. MPA-P is not passenger residual. See `docs/knowledge-base/partial-refund-residual-value.md`. |
| "Tax carryforward applies when the origin and destination haven't changed" | STOP. Tax carryforward rules vary per tax code. Some carry forward only with same airport (not city), some only within the same tax validity period, some never carry forward (certain YQ/YR). Surface as DOMAIN_QUESTION: which tax codes are involved? |
| "I'll generate the Amadeus exchange command using standard Cryptic format" | STOP. GDS exchange commands differ by scenario (voluntary vs involuntary), by whether fare basis changed, by whether routing changed. Amadeus/Sabre/Travelport each use different command sequences. Check KB for the specific exchange scenario. |
| "For conjunction tickets, the exchange applies to the specific coupon being changed" | STOP. Conjunction ticket exchange requires referencing ALL ticket numbers in the set. Residual calculation spans the entire conjunction fare. Check KB for conjunction exchange handling. |
| "Involuntary reissue follows the same flow but without the change fee" | STOP. Involuntary reissue has entirely different reprotection fare rules, waiver behavior, and GDS entry formats. The flow is NOT "same minus fee." Surface as DOMAIN_QUESTION: what is the carrier-specific involuntary reissue policy? |
| "The BSP reporting for an exchange uses the new ticket's transaction amount" | STOP. BSP exchange reporting includes BOTH original (EXCH) and new ticket (TKTT with reference). The net amount is the additional collection or refund, not the face value. Check KB for BSP exchange reporting format. |
| "I'll calculate the fare difference using the current lowest available fare" | STOP. Reissue fare is NOT necessarily the lowest available. It depends on rebooking class availability and Cat 31 rules specifying which fares are permitted for exchange. Check KB for fare eligibility rules. |

### Agent 5.3 — Involuntary Rebook Agent

| Rationalization | Required response |
|---|---|
| "EU261 compensation is based on flight distance — short/medium/long haul bands" | STOP. EU261 also includes a 50% reduction for rerouting within specific time windows, has different applicability rules for EU vs non-EU carriers, and only applies to EU-departing (any carrier) or EU-arriving (EU carrier only). Check KB for the full applicability matrix. |
| "The 60-minute delay trigger is a standard industry threshold for IRROP" | STOP. Different carriers define IRROP triggers differently (60min, 90min, any misconnect). The trigger may be based on departure delay or arrival delay. EU261 uses arrival delay for compensation. Check KB for the carrier-specific IRROP definition. |
| "US DOT denied boarding compensation is 200% or 400% of the one-way fare" | STOP. IDB has specific caps, only applies to oversales (not cancellations/delays), requires confirmed reserved space, and has multiple exceptions. The percentage is based on ARRIVAL delay of substitute transport. Check KB for full IDB rules. |
| "Alliance/interline reprotection means rebooking on any alliance partner" | STOP. Reprotection rules vary by alliance, by carrier, and by the original ticket's endorsement restrictions. Some tickets restrict to operating carrier only. Check KB for the reprotection hierarchy. |
| "I'll apply the original routing credit since the passenger was involuntarily rerouted" | STOP. Original routing credit implementation varies by carrier — some recalculate and absorb difference, others maintain original fare component. Taxes change on new routing. Check KB for the carrier's specific procedure. |

### Agent 6.1 — Refund Processing Agent

| Rationalization | Required response |
|---|---|
| "ATPCO Category 33 refund rules follow the same penalty structure as Cat 31" | STOP. Cat 33 and Cat 31 are independent categories with separate penalty structures. A fare can be non-refundable but changeable, or vice versa. Check KB for Cat 33 rules specifically. |
| "Partial refunds are calculated by subtracting the used portion from the original fare" | STOP. Reject original−used without a method. Passenger path = Cat 33 + IATA Ticketing Handbook (THB); unused via `PUBLISHED_FARE` or `CARRIER_SPECIFIC`. No Cat 33 data = free penalty; bare waiver / missing method ≠ free. Never coupon-ratio, haversine, or MPA-P. See `docs/knowledge-base/partial-refund-residual-value.md`. |
| "Commission recall on refund is straightforward — reverse the original commission" | STOP. Commission recall rules vary by carrier agreement. Some allow retention, some recall 100%, some proportionally. Net remit tickets have different rules. Check KB for carrier-specific terms. |
| "Conjunction tickets — I'll process the refund on the specific coupon that's being refunded" | STOP. Conjunction ticket refunds are ALL-or-NONE. Cannot refund individual coupons independently. If some segments cancelled, it becomes a partial refund across the full conjunction fare. Check KB for conjunction refund handling. |
| "For BSP reporting, I'll use the refund transaction type with the refund amount" | STOP. BSP refund reporting requires specific fields: original ticket reference, refund amount, penalty deducted, commission recall, tax breakdown. ARC format differs from BSP. Check KB for the market-specific format. |
| "Waiver bypass means the penalty is zero" | STOP. Refund waivers have different effects depending on type. Some reduce penalty, some change refund type (credit to cash). Surface as DOMAIN_QUESTION: what is the waiver code and its specific effect? |

### Agent 6.2 — ADM Prevention Agent

| Rationalization | Required response |
|---|---|
| "Fare basis / booking class mismatch is a simple string comparison" | STOP. Fare basis codes have structure (booking class, fare type, season, AP). Some carriers allow class substitution. Validation must know the carrier's filing conventions. Check KB for fare basis validation rules. |
| "Passive segment detection just checks for HX/UN/NO status codes" | STOP. Must also check UC, HN, and carrier-specific codes. Must also detect churning (book/cancel/rebook to manipulate availability). Detection needs segment history, not just current status. Check KB for complete status code list. |
| "Married segment integrity means the segments were booked together" | STOP. Married segments are specific GDS constructs with married connection indicators. Each GDS uses different indicators. Breaking married pairs triggers ADMs. Check KB for GDS-specific married segment identification. |
| "TTL buffer check — I'll verify the ticket was issued before the time limit" | STOP. Different carriers set TTL differently (at booking, at fare quote, by departure date). Timezone handling creates edge cases. Some carriers ADM for same-day-of-deadline issuance. Check KB for carrier-specific TTL interpretation. |
| "Commission validation is checking the commission percentage against the contracted rate" | STOP. Commission contracts vary by fare basis pattern, route, booking class, ticketing date, and net remit status. Override commissions have separate authorization. Check KB for the agency's commission agreement structure. |
| "Endorsement validation just checks for the correct endorsement box text" | STOP. Endorsement restrictions are fare-rule-driven and carrier-specific. Incorrect or missing endorsements on restricted fares trigger ADMs. Check KB for endorsement requirements from the fare rules. |

### Agent 7.1 — BSP Reconciliation Agent

| Rationalization | Required response |
|---|---|
| "The HOT file follows standard EDI X12 format — I'll use a generic X12 parser" | STOP. BSP HOT files use a HYBRID format — EDI X12 segments plus fixed-width ASCII positional fields. Layout varies by BSP market. A generic parser will miss the fixed-width sections. Check KB for the specific market's HOT file spec. |
| "Transaction amounts in the HOT file are in the local currency of the BSP" | STOP. HOT files can contain transactions in multiple currencies. Each transaction record specifies its currency. Do not assume single-currency files. Check KB for which currency fields to use for matching. |
| "Discrepancy detection compares the agency record against the BSP record by ticket number" | STOP. Conjunctions, reissued tickets, and exchanges create cross-references beyond simple ticket number matching. ADM/ACM are separate transaction types referencing ticket numbers. Check KB for the complete transaction type and cross-reference patterns. |
| "Commission discrepancies are just comparing the filed commission against the expected rate" | STOP. BSP commission includes standard, override, and supplementary — each in separate fields. Expected rate depends on carrier contract varying by route, fare basis, class, and date. Check KB for commission field structure in the HOT file format. |
| "Remittance deadline calculation is straightforward — it's the BSP period end date" | STOP. BSP remittance periods vary by market (weekly, bi-monthly, monthly). Deadline includes a payment grace period that also varies by market. Check KB for the specific market's remittance calendar. |

### Agent 20.6 — Hotel Modification & Cancellation Agent

| Rationalization | Required response |
|---|---|
| "Cancellation penalty is calculated using the nightly rate from the current booking record" | STOP. DOMAIN QUESTION OPEN (#19). The nightly rate source for penalty calculation has not been resolved — could be rate at booking, rate at cancellation, CRS rate vs PMS rate, rate including vs excluding taxes. Do not implement until this is answered. |
| "The California 24-hour rule is similar to the US DOT flight cancellation rule" | STOP. California hotel cancellation law (July 2024+) is separate from federal airline regulations. Check lodging KB for the specific statute and its applicability. |
| "Free modification means the change is processed with no charges" | STOP. Free modification and cancel/rebook are different flows. Modification = same confirmation code, same rate. Cancel/rebook = new reservation, potentially different rate, original cancellation policy may still apply. Check lodging KB for the CRS/PMS handling. |
| "Stepped penalty calculation follows a simple time-before-arrival schedule" | STOP. Penalty steps vary by chain, rate type, booking channel, room type, length of stay, and season. Some properties have different policies for first night vs remaining nights. Groups have entirely different structures. Surface as DOMAIN_QUESTION. |
| "Resort fees and mandatory charges are included in the penalty calculation" | STOP. Whether mandatory fees are included in penalty base varies by property and jurisdiction. Some jurisdictions require mandatory fees to be refundable regardless of cancellation policy. Surface as DOMAIN_QUESTION. |

## Effort Guidelines

When working on this repo, use these effort levels:

- **high effort**: Agent specs, new agent implementations, core module changes, anything touching types.ts or mapper.ts files, PRs that modify BaseAdapter or ConnectAdapter interface
- **medium effort**: Tests, documentation updates, demo scripts, config changes
- **low effort**: Version bumps, export additions, barrel file updates, .gitignore changes

Do not invent domain logic. If a task requires travel industry knowledge not present in the knowledge-base/ directory or agent specs, stop and surface a DOMAIN_QUESTION.
