# Changelog

> **Versioning policy:** Pre-v1.0, every release is a patch bump (`0.6.0 → 0.6.1 → 0.6.2 → …`). See [VERSIONING.md](VERSIONING.md) for the full policy and an explanation of the early-history version jumps (0.3.4 → 0.5.0 → 0.5.1 → 0.6.0) that predate this rule. v0.6.4 → v0.7.0 is the one post-policy exception — see VERSIONING.md.

## Unreleased

### Domain — partial refund / residual value ([#150](https://github.com/TelivityAI/otaip/issues/150))

- New KB: `docs/knowledge-base/partial-refund-residual-value.md` — passenger residual = **Cat 33 + THB** (Historical Ticket Based); **MPA-P is interline only**; reject original−used / original−change-fee / coupon-ratio / haversine; conjunction all-or-none; worked examples; fail-closed interfaces.
- Agents **5.1 / 5.2 / 6.1** require explicit residual/partial valuation methods; return `DOMAIN_INPUT_REQUIRED` when method unspecified.
- Removed invented residual = original − change fee (5.1) and coupon-ratio partial proration (6.1).
- `@otaip/core`: export `PassengerResidualMethod`, `PassengerPartialValuation`, `REJECTED_PASSENGER_RESIDUAL_METHODS`.

## 0.7.4 — Duffel order enrichment + activity/transfer agents

Workspace-wide patch bump `0.7.3 → 0.7.4` so npm picks up [#123](https://github.com/TelivityAI/otaip/pull/123).

### `@otaip/adapter-duffel`

- Enrich `BookResponse` from the live Duffel order already returned by `book()`: optional `ticketNumbers`, `segments` (fare basis), `baseAmount` / `taxAmount`, `recordLocator`, `passengerNames`, `refundable` / `changeable`, timestamps.
- Add `getOrder(orderId)` → `GET /air/orders/{id}` mapped through the same helper.
- Existing five fields unchanged; new fields optional. Unit tests cover the order mapper.

### `@otaip/agents-lodging`

- Agent **20.8** `ActivitySearchAgent` — typed Hotelbeds Activities search wrapper.
- Agent **20.9** `TransferSearchAgent` — typed Hotelbeds Transfers search wrapper.
- `agents.manifest.json` regenerated (77 agents).

### CI / hygiene

- `pnpm` overrides for high `pnpm audit` findings (`postcss`, `brace-expansion`, `fast-uri`, `find-my-way`, `@fastify/static`).
- Public-repo comment guard: no internal product-name refs in lodging agent docs.

## 0.7.2 — Duffel Cars + auto-publish workflow + post-#93 release fix

Patch bump. Three pieces of substantive work in this window:

### `@otaip/adapter-duffel` — Cars API ([#99](https://github.com/telivity-otaip/otaip/pull/99))

Duffel launched **Cars** as a full API vertical alongside Flights and Stays. `DuffelAdapter` now spans both surfaces. Five new direct methods on the same class:

- **Cars** (`/cars/`) — `searchCars`, `quoteCar`, `bookCar`, `getCarBooking`, `cancelCarBooking`. Three-step flow (search → quote → book) unlike the two-step flight flow. Geo-coordinate based — no IATA codes — per the brief; IATA-to-coordinate conversion is explicitly deferred (DQ-C8).
- The shared private `request()` helper now accepts an optional `AbortSignal` (pre-flight check; in-flight cancel needs an upstream change to `fetchWithRetry`, same caveat the Hotelbeds adapter carries).

New canonical types (`CarRate`, `CarQuote`, `CarBookResponse`, etc.), wire types, decimal.js-backed mapper, and a full mock three-step flow on `MockDuffelAdapter` (two synthetic fixtures: Toyota Corolla compact + VW Tiguan SUV). 18 new test cases covering body shapes, headers, mapper output, abort handling, 429 retry-then-error, and round-trip mock flow. Domain knowledge captured verbatim in `docs/knowledge-base/cars.md` with **8 numbered DOMAIN_QUESTION markers (DQ-C1..C8)** for the gaps the brief leaves open. Per the constitution's no-invent rule, those are surfaced rather than guessed.

### Auto-publish workflow wiring ([#97](https://github.com/telivity-otaip/otaip/pull/97), [#98](https://github.com/telivity-otaip/otaip/pull/98))

Post-mortem on why `@otaip/core` etc. sat at v0.6.4 on npm despite v0.7.0 and v0.7.1 GitHub releases existing:

- **#97** — `scripts/count-agents.ts` had been importing `discoverAgents` through the CLI re-export added in [#93](https://github.com/telivity-otaip/otaip/pull/93). The Release workflow's *Count agents* step ran before any package was built, and the indirection forced tsx to resolve `@otaip/core` through its `package.json` `exports` map → `dist/index.js` (which doesn't exist on the runner) → `ERR_PACKAGE_PATH_NOT_EXPORTED`. Result: every push-to-main since #93 was failing the Release workflow silently, blocking tag creation. Fixed by importing directly from the source path.
- **#98** — The Release workflow's `gh release create` was authenticated with `GITHUB_TOKEN`, but [GitHub Actions intentionally does not trigger downstream workflows for events fired by `GITHUB_TOKEN`](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow). That's why the Publish workflow never auto-fired off `release: published` for v0.7.0 or v0.7.1 — packages only made it to npm when someone clicked *Run workflow* manually. Switched the create-release step to a Personal Access Token (`RELEASE_PAT` secret) so the event is "user-fired" and propagates. Falls back to `GITHUB_TOKEN` when the secret is unset, so the workflow still functions in environments without the PAT.

After v0.7.2 merges and tags, this is the first release that will auto-publish to npm without a manual workflow_dispatch.

### Verification

- `pnpm exec vitest run packages/adapters/duffel` — 58 passed / 3 skipped (sandbox-gated).
- `pnpm -r typecheck` — clean across the workspace.
- `pnpm exec eslint packages/adapters/duffel/src` — clean.

### Versioning note

Patch bump off v0.7.1 per VERSIONING.md. The Cars vendor brief asked for a "next minor" (0.8.0) bump; we honoured the policy and stuck with 0.7.2 instead. The next release is **v0.7.3**.

## 0.7.1 — Platform UI + agent-discovery promoted to `@otaip/core`

Patch bump per the policy reset in v0.7.0. The headline of this window is the **Platform UI** ([#93](https://github.com/telivity-otaip/otaip/pull/93)) — a new React/Vite app at `examples/platform-ui/` that gives developers a visual control plane for an OTAIP instance: agent registry, adapter status, health sidebar, and an interactive Playground for searches/agents/adapters. The Platform UI is private (`examples/*` is not published to npm); the npm-visible delta is one additive export on `@otaip/core`.

### Published-package changes

- **`@otaip/core`** — new `discoverAgents()` / `DiscoveredAgent` exports under `src/discovery/`. Filesystem-only walk of the workspace; no agent code executes. Repo root is resolved by walking up to `pnpm-workspace.yaml` rather than by counting parent directories, so the helper works the same way from `src/` (tsx/vitest) and from `dist/` (built consumer).
- **`@otaip/cli`** — `agent-discovery.ts` now re-exports from `@otaip/core`. Behavior unchanged; every existing import path keeps working. The `pnpm cli agents` output is byte-identical.
- All other published packages bumped 0.7.0 → 0.7.1 with no source changes — workspace-wide version sync.

### Reference OTA additions ([#93](https://github.com/telivity-otaip/otaip/pull/93))

`examples/ota` (private) gains the read-only telemetry routes the dashboard consumes: `/api/platform/{agents,adapters,health,stats}` (rate limit raised to 5 000/min so dashboard polling cannot trip the global cap) and `/api/playground/{catalog,search,agent,adapter}`. Catalog surfaces every discovered agent plus an `executable_ids` whitelist; the playground starts at one wired agent (`0.1` AirportCodeResolver — the canonical reference pattern from CLAUDE.md). Non-whitelisted IDs return a clear `501` rather than pretending to run. 12 new tests across `platform.test.ts` + `playground.test.ts` follow the existing Fastify `inject()` + `MockOtaAdapter` shape.

### Dependency hygiene ([#95](https://github.com/telivity-otaip/otaip/pull/95))

Dependabot bumped `postcss` 8.5.8 → 8.5.10 (dev-only, transitive through `tailwindcss`).

### Verification

- `pnpm -r typecheck` — clean across the workspace.
- `pnpm exec vitest run examples/ota` — 100 passed across 9 files.
- `pnpm --filter @otaip/platform-ui typecheck` — clean.

### Versioning note

Patch bump off v0.7.0 per the rule reaffirmed in the v0.7.0 release. The next release is **v0.7.2**.

## 0.7.0 — Reference OTA hardening + Hotelbeds Activities/Transfers

Re-sync release. `@otaip/adapter-hotelbeds@0.7.0` shipped as a single-package minor bump in [#90](https://github.com/telivity-otaip/otaip/pull/90) ahead of the repo-wide release; this PR aligns root + every other workspace package with that version so the GitHub front page, npm, and `package.json` files all agree. Per-package, the only API surface change since v0.6.4 lives in `@otaip/adapter-hotelbeds`. The rest of the work in this window targeted the reference OTA — see below.

### `@otaip/adapter-hotelbeds` — Activities + Transfers ([#90](https://github.com/telivity-otaip/otaip/pull/90))

`HotelbedsAdapter` now spans the full APItude product family. New direct methods on the same class:

- **Activities** (`/activity-api/3.0`) — `searchActivities`, `bookActivity`, `cancelActivity`. Cancellation policy narrows to `'NOR' | 'NRF'`; unknown values default to `'NRF'` per DQ-A5.
- **Transfers** (`/transfer-api/1.0`) — `searchTransfers`, `bookTransfer`, `cancelTransfer`. Unknown `transferType` values pass through verbatim rather than being coerced into the documented `PRIVATE | SHARED | LUXURY` set.
- The shared `request()` helper now accepts an optional `AbortSignal` (pre-flight check; in-flight cancel needs an upstream change to `fetchWithRetry` and is left as future work).

New canonical types (`ActivityOffer`, `ActivityModality`, `TransferOffer`, etc.), wire types, mappers (`decimal.js` for all amounts), capability manifests (`hotelbedsActivitiesCapabilities`, `hotelbedsTransfersCapabilities`), `MockHotelbedsAdapter` fixtures for both surfaces, and unit + sandbox-gated integration tests. Domain knowledge captured verbatim from the vendor brief in `docs/knowledge-base/activities.md` and `docs/knowledge-base/transfers.md` with 13 numbered `DOMAIN_QUESTION` markers (DQ-A1..A5, DQ-T1..T8) for the gaps the brief leaves open. Per the constitution's no-invent rule, those questions are surfaced rather than guessed.

### Reference OTA — Path B hardening ([#88](https://github.com/telivity-otaip/otaip/pull/88))

Three pieces:

- **Durable persistence** — `MockOtaAdapter` now optionally stores bookings in SQLite via `node:sqlite` (Node 24+). Auto-loads when `DATABASE_PATH` is set; falls back to in-memory otherwise. Survives process restarts.
- **Real Stripe payments** — `PaymentService` runs against Stripe when `STRIPE_SECRET_KEY` is set. PaymentIntents created at booking time, confirmed at pay time. Mock-mode preserved when no key.
- **Security headers + input schemas** — `helmet`, `@fastify/cors` (env-driven), `@fastify/rate-limit` (100/min global, 20/min on `/api/book`, 10/min on `/api/pay`), AJV body schemas on every state-mutating route, custom error formatter that preserves the existing `{ error, details }` envelope.

### Reference OTA — wire real DuffelAdapter ([#89](https://github.com/telivity-otaip/otaip/pull/89))

When `DUFFEL_API_KEY` is set, `examples/ota`'s search/price/book flow now runs against the live Duffel sandbox via a new `DuffelOtaAdapter` wrapper. Without the key it falls back to `MockOtaAdapter` exactly as before. New `BookingLifecycle` interface lets `Payment` / `Ticketing` / `Manage` services type against `OtaAdapter & BookingLifecycle` instead of the concrete mock — drops the `as MockOtaAdapter` casts in `server.ts`. Standardizes the env var to `DUFFEL_API_KEY` (matches the demo); `DUFFEL_API_TOKEN` still works with a deprecation warning. `ADAPTERS=duffel` is now a valid value for live multi-source search.

### Docs & CI

- **README** — "Build on OTAIP" promoted to the hero slot; the domain-flex framing pushed to the bottom ([#87](https://github.com/telivity-otaip/otaip/pull/87)).
- **Publish CI** — verify step now auto-discovers packages from the workspace instead of being hand-maintained, and `repository.url` is canonicalized across every `package.json` ([#86](https://github.com/telivity-otaip/otaip/pull/86)).

### Verification

- Workspace typecheck clean.
- `@otaip/adapter-hotelbeds`: 100 unit tests pass, 14 sandbox-gated tests skip without credentials.
- `examples/ota`: 88 tests pass.
- All PRs in the v0.7.0 window were merged green individually before this release PR was cut.

### Versioning note

The patch-bump-only rule from VERSIONING.md was broken when `@otaip/adapter-hotelbeds` shipped as 0.7.0 in the per-package PR. This release ratifies that bump for the rest of the workspace and updates VERSIONING.md to acknowledge the deviation. **Going forward, all releases are patch bumps off v0.7.x until v1.0** — the next release is v0.7.1.

## 0.6.4 — Hotelbeds Distribution Adapter

Patch bump per the pre-v1.0 policy in [VERSIONING.md](VERSIONING.md). Adds a new adapter package — `@otaip/adapter-hotelbeds`, the first lodging-distribution adapter on OTAIP. Verified end-to-end against the real Hotelbeds APItude sandbox: full booking lifecycle (search → checkrate → book → retrieve → cancel) returns a real Hotelbeds reference and cleans up after itself.

### New

- **`@otaip/adapter-hotelbeds`** — Hotelbeds APItude adapter for the Hotels API. Implements `availability`, `checkRate`, `book`, `getBooking`, `listBookings`, and `cancelBooking` (`SIMULATION` and `CANCELLATION`). Search bridges into the lodging search aggregator via the existing `HotelSourceAdapter` shape. Mock adapter ships in the same package for upstream tests that don't have credentials.
- **SHA256 request signing** — `signRequest` / `buildAuthHeaders` regenerate the `X-Signature` per request (Hotelbeds rejects signatures more than ~5 minutes off server time). Backed by `node:crypto`, no extra dependencies.
- **Field mapper** — Hotelbeds wire types → canonical OTAIP lodging types (`RawHotelResult`, `RawRate`, `CancellationPolicy`, `BookingSummary`). All money stays in `Decimal` / string land; no `number` for prices.
- **Demo script** at `packages/adapters/hotelbeds/demo/index.ts` — runnable with `HOTELBEDS_API_KEY=… HOTELBEDS_SECRET=… npx tsx demo/index.ts`. Walks the full lifecycle end-to-end in a single command.

### Domain decisions applied

- **DQ11 (mandatory fees)** — when Hotelbeds returns `taxes.allIncluded === false`, same-currency mandatory fees are folded into the rate's `totalRate` / `nightlyRate` so the top-level price is what the traveler actually owes. Fees stay on `mandatoryFees` for transparency. Cross-currency fees are listed but not folded (the adapter has no FX rate).
- **DQ13 (cancellation markup)** — Hotelbeds cancellation `amount` is net (cost-to-us). Adapter applies a documented `HOTELBEDS_CANCEL_FEE_MARKUP = 1.25` and stores both the gross (`penaltyValue`) and the net (`netPenaltyValue`) so settlement and reporting can reconcile margin. New optional `netPenaltyValue?: number` field added to `CancellationDeadline` in `@otaip/agents-lodging` — additive, all existing callers still typecheck.
- **DQ14 (booking status)** — explicit mapping for `CONFIRMED` / `CANCELLED` / `ON_REQUEST` / `PENDING` / `MODIFIED`; unknown values fall back to `pending` and emit a `console.warn` so unhandled states don't get silently swallowed.

### Verification

- **Unit tests:** 61 against mocked fetch (auth, field mapper, full adapter surface, mock adapter).
- **Integration test:** 8/8 passing against the real Hotelbeds sandbox at `https://api.test.hotelbeds.com`. Auto-skipped when credentials aren't set, so CI never hits the live API. Self-cleans the booking it creates.
- **Repo-wide:** 3153 tests passing, 0 failed, 11 skipped (the 8 integration + 3 pre-existing).

### Deferred

- Hotelbeds Transfers API and Activities API — tracked as a follow-up so this adapter stays focused on the bedbank content path that unblocks the lodging pipeline.

## 0.6.3 — Codex review closeout, first npm publish, per-transaction routing

Eleven PRs (#73–#83) addressing all 12 findings from a full-repo Codex review, the first-ever publish of the `@otaip/*` scope to npm, and a set of CI/publish hardening fixes. Several engines widen their output types and a couple of agents add required input fields — see **Potentially-breaking** below if you were depending on the previous behaviour.

### Published to npm

All 15 `@otaip/*` packages are now live on npm at `0.6.2` — previously the source existed but nothing had shipped. `npm install @otaip/core` (and friends) works.

- `@otaip/core`, `@otaip/connect`, `@otaip/cli`, `@otaip/adapter-duffel`
- `@otaip/agents-reference`, `@otaip/agents-search`, `@otaip/agents-pricing`, `@otaip/agents-booking`, `@otaip/agents-ticketing`, `@otaip/agents-exchange`, `@otaip/agents-settlement`, `@otaip/agents-reconciliation`, `@otaip/agents-lodging`
- `@otaip/agents-tmc`, `@otaip/agents-platform`

### Removed invented domain logic (CLAUDE.md compliance)

Codex review flagged five engines that were computing fare/penalty/compensation amounts from invented "common industry pattern" data rather than authoritative sources. This release replaces all of them with either caller-supplied authoritative inputs or published-law constants.

- **`@otaip/core`: EU 261/2004 + US DOT 14 CFR §250 modules (new).** `applyEU261()` encodes the published distance bands (€250/€400/€600), 3h arrival-delay trigger, Article 7(2) rerouting 50% reduction, 14-day cancellation safe harbour, and extraordinary-circumstances exemption. `applyUsDotIdb()` encodes the current 14 CFR §250.5 denied-boarding tables ($1,075 / $2,150 caps, effective 2025-01-22). Plus `greatCircleDistanceKm()` haversine helper.
- **`@otaip/core`: new `DomainInputRequired` type + helpers** (`domainInputRequired`, `isDomainInputRequired`) — shared sentinel for engines that refuse to synthesise numbers when authoritative inputs are missing.
- **Fare Construction (2.2):** removed the ROE 1.0 fallback (was silently multiplying every non-USD currency by 1), the per-mile-rate HIP heuristic, and the city-revisited BHC heuristic. Engine now returns `DomainInputRequired` when ROE is missing and populates `missing_inputs` on HIP/BHC checks that need intermediate-point fare lookups. The EMS mileage-surcharge formula (5%/5%, max 25%) stays — confirmed IATA standard. Output type widened to `FareConstructionResult = FareConstructionOutput | DomainInputRequired`.
- **Change Management (5.1) + Refund Processing (6.1):** removed the "$200 default" fallback, the waiver-=-zero special case, and the residual = original − penalty formula. Engines now read `cat31_rules` / `cat33_rules` from input and apply them as filed. When rules are absent, they fall back to the ATPCO default — permitted at no charge for voluntary changes, fee waived for involuntary. Invented rule data moved out of `src/data/` into `__tests__/fixtures/` with a "TEST FIXTURE — do not use in production" banner.
- **Involuntary Rebook (5.3):** removed the hardcoded 60-minute IRROP threshold. Caller now supplies `thresholds.time_change_minutes` per carrier. Real EU261 compensation is calculated via the core module when `eu261_inputs` (distance, delay, extraordinary circumstances, notice days, rerouting) are provided; `regulatory_flags[].missing_inputs` lists what's needed otherwise. Clarified that US DOT IDB applies to denied boarding only — not delays/cancellations.
- **Feedback & Complaint (6.5):** replaced ~250 lines of inline EU261 / US DOT compensation math with calls to the core regulation modules. DOT IDB caps updated from pre-amendment $775 / $1,550 to current $1,075 / $2,150. Article 10(2) downgrade reimbursement (30/50/75%) kept — published law not covered by the Article 7 helper.

### GDS/NDC router per-transaction routing (CLAUDE.md compliance)

The router previously treated `carrier → channel_priority` as unconditional. Replaced with per-transaction routing: different transaction types (`shopping`, `booking`, `ticketing`, `servicing`, `group`, `corporate`) route differently for the same carrier. Built-in defaults cover `shopping` and `booking`; every other type requires caller-supplied `capability_overrides` or the engine returns `domain_input_required: true`. Unknown carriers no longer default silently to GDS/AMADEUS.

### HTTP hardening

- **New `@otaip/core` `fetchWithRetry(input, init?, options?)`** — wraps `fetch` with per-attempt `AbortController` timeout (default 30s) + retry on 5xx / 429 / network errors via the existing `withRetry`. Response stays a `Response`; callers still inspect `response.ok`.
- **TripPro defaults now HTTPS.** Search and calendar-search URLs were `http://mas.trippro.com/...` — switched to `https://`. Reprice/book were already HTTPS.
- **Sabre auth, Navitaire create+refresh, Duffel adapter, TripPro SOAP client** all route through `fetchWithRetry` instead of raw `fetch`.

### Correctness fixes

- **`booking/api-abstraction` rate limiter** — the counter incremented once per `execute()` call, **before** the retry loop, so retries against the upstream provider went uncounted. Moved the increment and the rate-limit guard inside the loop so each actual outbound attempt is charged against the quota.
- **Stub agents now throw `UnimplementedDomainInputError`** (new `@otaip/core` export) instead of raw `Error`. Four agents migrated: `DisruptionResponseAgent` (5.4), `DynamicPricingAgent` (2.6), `RevenueManagementAgent` (2.7), `InterlineSettlementAgent` (7.4).

### CLI

- **`otaip agents` registry is now auto-discovered** from source metadata (`packages/cli/src/agent-discovery.ts`) rather than a hand-maintained array that had drifted (claimed 71, listed 69, several names didn't match the exported agent classes). Walks `packages/agents/*/src/*/index.ts`, `packages/agents-platform/src/*/index.ts`, `packages/agents-tmc/src/*/index.ts`, and `packages/core/src/agents/shopping/*/index.ts` — greps `readonly id`, `readonly name`, `readonly version`. Today: 75 agents across 12 stages.
- **CLI now included in lint** (`--ignore-pattern 'packages/cli/**'` removed). `packages/cli/tsconfig.json` added to the ESLint parser project list. CLI-scoped override allows `console.*` (CLI stdout is the contract).
- **7 new tests** for the discovery walk — count floor, unique IDs, file-resolves-to-real-path, stage matches ID prefix, sort order, etc.

### Bootstrap + counts

- **New `scripts/count-agents.ts`** (`pnpm run count:agents`) — single source of truth for agent counts. Replaces a `find` in `release.yml` that undercounted by skipping `agents-platform` and `agents-tmc`. All agent/stage counts in README, docs, and release notes now derive from one script.
- **Removed root `postinstall`.** With `ignore-scripts=true` in `.npmrc` (shipped in 0.5.x for supply-chain safety), the `postinstall` never ran anyway. Docs updated to instruct an explicit `pnpm run data:download`.
- **Publish prep** — every workspace package now has `"type": "module"` so tsup's ESM output (`index.js`/`index.d.ts`) matches the `main`/`types` fields; `exports["."].types` moved from `./src/index.ts` (not in the tarball) to `./dist/index.d.ts`; all 15 workspace packages aligned to the root version so the first publish was coherent.

### CI / release

- **`release.yml` no longer swallows test failures.** The previous step used `pnpm test 2>&1 || true`, masking failed tests so a broken release could publish with a misleading test count. Split into two steps that fail fast.
- **`publish.yml` now verifies packages are actually live.** After `pnpm -r publish`, polls the registry for each of the 15 `@otaip/*` packages and expects `dist-tags.latest` to equal the released version. Fails loudly if pnpm reports success but the registry doesn't have the package. (Caught a "published successfully but 404 on registry for 5 minutes" class of bug on the first live publish.)
- **`ci.yml` builds before typecheck.** With `exports.types → ./dist/index.d.ts`, cross-package `@otaip/*` imports need `dist/` to exist for TS to resolve types. Doubles as clean-tree build validation.

### Docs

- **README header numbers synced** — 75 agents across 12 stages, 3,092 tests, 16 packages. Test badge updated. Install instructions now say `pnpm install --frozen-lockfile && pnpm run data:download`.
- **Accurate tsconfig strictness claim** — README and CLAUDE.md previously said "all strict flags ON" but `exactOptionalPropertyTypes` is intentionally off. Replaced with the explicit list of enabled flags.
- **docs/getting-started.md** — added the explicit data-download step and documented the supply-chain trade-off.
- **docs/agents.md** — header updated to "12 stages" with a note pointing future editors at `pnpm run count:agents` so the total cannot drift again.

### Potentially-breaking

> Pre-1.0 policy allows breaking changes in patch bumps; flagged here so downstream consumers can update.

- `FareConstruction#execute()` return type widened to `AgentOutput<FareConstructionOutput | DomainInputRequired>`. Consumers must narrow on `result.data.status`.
- `GdsNdcRouter` input now requires `transaction_type` (new enum). Previously-working inputs without it will be rejected by the validator.
- `ChangeManagement` and `RefundProcessing` now require `cat31_rules` / `cat33_rules` in input to apply filed penalties. Absent rules → ATPCO default (no penalty for voluntary, waived for involuntary) — **was** a `$200` default in 0.6.2.
- `InvoluntaryRebook` now requires `thresholds.time_change_minutes` to mark a time-change as involuntary. Absent → non-involuntary with a warning.
- `@otaip/core` exports `fetchWithRetry`, `UnimplementedDomainInputError`, `DomainInputRequired`, `applyEU261`, `applyUsDotIdb`, `greatCircleDistanceKm` and related types.
- TripPro `searchUrl` / `calendarSearchUrl` defaults switched from `http://` to `https://`. Override explicitly for local dev.
- US DOT IDB compensation caps updated to 14 CFR §250.5 (effective 2025-01-22): `$1,075` / `$2,150` (was the pre-amendment `$775` / `$1,550`).
- 11 packages that previously lacked `"type": "module"` now have it. CommonJS consumers will need to import via `import(...)` or upgrade their resolution.

### Tests

- **3,092 total passing** (was 3,034). 58 new tests:
  - 18 for the new EU261 + US DOT IDB regulation modules
  - 8 for `fetchWithRetry`
  - 5 new EU261 compensation tests in involuntary-rebook
  - 7 for CLI agent discovery
  - 7 for the ATPCO-default branches in change-management + refund-processing
  - 5 for per-transaction GDS/NDC routing + new validators
  - 3 for the rate-limit retry counting + stub `UnimplementedDomainInputError`

## 0.6.2 — Reference OTA Multi-Adapter Fixes

Three bugs in the Sprint H multi-adapter integration caught by Codex review, plus the follow-up to make booking adapter-aware. No behavior change to the single-adapter path; no breaking changes to public interfaces.

### Fixed

- **`buildApp()` now wires `MultiSearchService` into the search route** — `?multi=true` was previously unreachable in production. When the `ADAPTERS` env var is set, a `MultiSearchService` is constructed automatically; test callers can inject one via `buildApp({ multiSearch })`.
- **Multi-adapter search now caches its offers** — `GET /api/offers/:id` and `POST /api/book` no longer 404 on offers returned from the multi path. New `SearchService.cacheOffers()` is called from the multi branch.
- **`returnDate` preserved on the multi path** — round-trip requests now reach adapters with both segments. Previously the return leg was silently dropped.
- **Adapter-aware booking routing** — bookings now route back to the adapter that produced the offer. An offer from a search-only adapter (no `book()` method) is rejected with HTTP `409` and the adapter name, not silently routed to the default adapter. New `AdapterNotBookableError` + `SearchService.getOfferAdapterSource()` + `BookingService(defaultAdapter, searchService, bookingAdapters?)` registry param.
- **Stale `adapterSource` cleared on re-cache** — a single-adapter search after a multi-adapter search no longer leaves a stale source entry behind that would misroute a subsequent booking.

### Documented

- `offer_id` collision semantics within a `MultiSearchService.search()` call are explicitly last-write-wins. Production deployments that need stronger guarantees should namespace IDs with `adapterSource` at the aggregation boundary.

### Tests

- 12 new tests in `examples/ota/src/__tests__/search.test.ts` pinning each fix. **3034 total passing**, 0 failing.

## 0.6.1 — Stub Replacements: HotelCarSearch, AITravelAdvisor, SelfServiceRebooking, WaitlistManagement

Four stub agents replaced with real implementations. No new agents; no breaking changes to public interfaces. Existing imports continue to work.

### Changed

- **Agent 1.7 `HotelCarSearchAgent`** — Aggregator over injectable hotel/car adapters. `Promise.allSettled` fan-out with per-adapter timeouts, filters, and sort. Partial-failure tolerant (returns available results with per-source status). New Zod schemas + `AgentContract`.
- **Agent 1.8 `AITravelAdvisorAgent`** — Rule-based recommender (NOT LLM). Orchestrates `AvailabilitySearch` + `FareShopping`, scores offers on price / schedule / airline / connections with business/leisure/default weight profiles. `LLMProvider` / `MockLLMProvider` types removed.
- **Agent 5.5 `SelfServiceRebookingAgent`** — Rebooking orchestrator over `AvailabilitySearch` + `ChangeManagement`. Ranks priced alternatives by `changeFee + fareDifference + taxDifference`. Involuntary reasons (schedule change / missed connection / cancellation) waive the change fee.
- **Agent 5.6 `WaitlistManagementAgent`** — Stateful in-memory queue (reference implementation, not durable). Four operations: `addEntry`, `clear`, `queryStatus`, `expire`. Priority = status tier + fare class type + recency bonus; ties broken by earliest `requestedAt`. Clearance probability estimated as `rate^position` with per-booking-class overrides.

### Tests

- 77 new tests across the four agents (19 + 20 + 17 + 21). **3022 total passing**, 0 failing.

## 0.6.0 — Sprint H: Multi-Adapter, OOSD-Native, Full Distribution

The mid-term build plan is complete. Navitaire gains native ONE Order operations, Duffel bridges its order model to OTAIP's AIDM-aligned types, and the Reference OTA searches multiple adapters in parallel with source attribution.

### Added

- **Navitaire OrderOperations** — `NavitaireOrderOperations` class implements the full AIDM 24.1 `OrderOperations` interface: `orderCreate`, `orderRetrieve`, `orderChange`, `orderCancel`, `orderViewHistory`. Mock in-memory implementation with `NAV-ORD-*` IDs, status lifecycle, and `OrderEvent` tracking. Navitaire is ONE Order certified; this lets OTAIP speak to them natively.
- **Duffel Order Bridge** — `DuffelOrderBridge` class bridges Duffel's native order model to OTAIP's AIDM-aligned `Order` types. `DFL-ORD-*` IDs, double-cancel prevention, passenger/payment/offer-item mapping.
- **ChannelCapability Order fields** — `supportsOrders?: boolean` and `orderOperations?: ('create' | 'retrieve' | 'change' | 'cancel')[]` on `ChannelCapability`. `GdsNdcRouter` can use these to decide PNR vs Order path per channel.
- **Multi-adapter search in Reference OTA** — `MultiSearchService` fans out search requests to multiple `DistributionAdapter` instances via `Promise.allSettled`, merges results with `adapterSource` attribution, includes per-source status with timing and error reporting. Activated via `ADAPTERS` env var (comma-separated) or `?multi=true` query param.
- **Updated capability manifests** — Navitaire and Duffel now declare `supportsOrders: true` and the full set of order operations.
- **docs/adapters/oosd-navitaire.md** — Navitaire ONE Order adapter documentation.
- **docs/offers-and-orders.md** — updated with Sprint H completion section.

### Tests

- 33 new tests (15 Navitaire + 10 Duffel + 8 multi-search). 2985 total passing, 0 failing.

### Build plan complete

| Sprint | Version | Delivered |
|---|---|---|
| A | v0.3.2 | Pipeline validator, 9 agent contracts, capability registry |
| B | v0.3.2.1 | Tool bridge, catalog generator, EventStore, PnrRetrieval |
| C | v0.3.3 | Fallback chain, governance agents, CLI |
| D+E | v0.3.4 | Docs overhaul, Reference OTA search flow |
| F | v0.5.0 | Reference OTA booking, payment, ticketing |
| G | v0.5.1 | Offers & Orders data model (AIDM 24.1) |
| H | v0.6.0 | OOSD-native adapters, multi-adapter search |

Final stats: **76 agents, 2985 tests, 16 workspace packages, 6 adapters, 14 contracted agents, 2 OOSD-native adapters.**

## 0.5.1 — Sprint G: ONE Order Ready — PNR + Orders Coexist

Native Offers & Orders data model in `@otaip/core`, aligned with IATA AIDM 24.1 terminology. PNR and Order models coexist through a unified `BookingReference` bridge — agents accept either and let the adapter decide the underlying model.

### Added

- **Order/Offer types** — `Offer`, `OfferItem`, `Order`, `OrderItem`, `Service` (atomic unit: flight, seat, baggage, meal, lounge, insurance, ancillary), `OrderPassenger` with `TravelDocument` + `LoyaltyInfo`, `TicketDocument` (ET, EMD-A, EMD-S), `OrderPayment`, `Money` (decimal string + ISO 4217)
- **AIDM 24.1 message names** — `OrderCreate`, `OrderRetrieve`, `OrderChange`, `OrderCancel` on the `OrderOperations` interface. Adapters that support ONE Order implement this directly.
- **OrderEvent** — event-driven status changes for Orders (`order.created`, `order.confirmed`, `order.ticketed`, `order.changed`, `order.cancelled`, `order.payment_received`, `order.payment_failed`, `order.refunded`). Queue management stays PNR-only.
- **BookingReference bridge** — `PnrReference | OrderReference` union type with constructors (`createPnrReference`, `createOrderReference`), type guards (`isPnrReference`, `isOrderReference`), accessors (`getBookingIdentifier`, `getBookingOwner`), and `pnrPassengerToOrderPassenger()` converter.
- **Zod schemas** for every Order/Offer type — ready for `zodToJsonSchema()` LLM tool generation.
- **docs/offers-and-orders.md** — explains the dual model, AIDM alignment, bridge utilities, and Sprint H roadmap (Navitaire as OOSD adapter target).

### Design decisions

- JSON, not XML. AIDM concepts, not the AIDM XML schema.
- Queue management stays PNR-only. Orders use `OrderEvent`.
- No agent modifications in this release — types and bridge only. Agent integration via `BookingReference` lands in Sprint H.
- Navitaire is the target OOSD adapter for Sprint H — they're ONE Order certified and the adapter already exists.

### Tests

- 47 new tests (30 schema validation + 17 bridge utilities). 2952 total passing, 0 failing.

## 0.5.0 — Sprint F: Reference OTA — Book, Pay, Fly

The reference OTA is now a complete booking application. Users can search flights, select an offer, enter passenger details, pay, and receive a ticket — the full travel e-commerce lifecycle running on OTAIP agents.

### Added

- **Booking flow** — `POST /api/book` creates a booking from a search offer with passenger details (title, name, DOB, gender) and contact info. Validates the offer exists in the search cache before booking. Returns a booking reference.
- **Payment flow** — `POST /api/pay` processes a mock payment against a booking reference. Structured for future Stripe integration (PaymentService abstraction) but ships with a mock that always succeeds. No external payment SDK dependency.
- **Ticketing flow (Option B)** — `POST /api/ticket` checks booking status first. If already ticketed, returns existing ticket numbers (idempotent). If not, generates mock 13-digit ticket numbers and updates status. Ticketed bookings cannot be cancelled.
- **Booking management** — `GET /api/booking/:ref` retrieves booking details. `POST /api/cancel` cancels confirmed (not yet ticketed) bookings.
- **4 frontend pages** — passenger details form (`book.html`), payment summary + Pay Now (`payment.html`), full confirmation with tickets + itinerary (`confirmation.html`), booking lookup + cancel (`manage.html`). Plain HTML + vanilla JS + Pico CSS.
- **OtaAdapter interface** — extends `DistributionAdapter` with `book()`, `getBooking()`, `cancelBooking()`. MockOtaAdapter extends MockDuffelAdapter with in-memory booking store, reference generation, and status lifecycle (confirmed → ticketed/cancelled).
- **14 integration tests** — booking CRUD, payment, idempotent ticketing, cancellation rules, 2 full end-to-end flows (search → book → pay → ticket, search → book → cancel).

### Tests

- 2905 total passing (14 new + 2891 existing), 0 failing

## 0.3.4 — Sprint D+E: Docs Overhaul + Reference OTA

Two sprints shipped together: Sprint D rewrites all documentation so the platform's scope is visible at a glance. Sprint E ships a deployable reference OTA that proves OTAIP works end to end — fork it, add your Duffel token, search real flights.

### Sprint D — Documentation Overhaul

- **README.md rewrite** — 6-adapter comparison table with exact test counts (456 total), 75-agent domain overview across 12 stages, pipeline contract system explanation, CLI usage examples, "Build on OTAIP" section
- **docs/architecture.md** — 4 Mermaid diagrams: high-level architecture, pipeline gate sequence, tool bridge flow, EventStore integration
- **docs/agents.md** — complete table of all 75 agents with ID, class name, description, contract status (14 contracted)
- **docs/getting-started.md** — clone to working demo in 5 minutes
- **docs/adapters/{amadeus,sabre,navitaire,trippro,duffel,haip}.md** — 6 adapter docs with capabilities, auth, config, usage, test counts, limitations
- **Agent ID collision fix** — PluginManager keeps 9.5, governance agents renumbered to 9.6-9.9

### Sprint E — Reference OTA: Search Flow

- **Fastify server** (`examples/ota/`) — `POST /api/search`, `GET /api/offers/:id`, `GET /health`
- **Services** — SearchService orchestrates AirportCodeResolver → AvailabilitySearch; OfferService caches offer details
- **Adapter config** — DuffelAdapter when `DUFFEL_API_TOKEN` is set, MockDuffelAdapter when not (works out of the box with zero config)
- **Frontend** — plain HTML + vanilla JS + Pico CSS via CDN. Search form with IATA validation, results page with sort-by-price/duration/departure, offer details with price breakdown. No React, no build step.
- **10 integration tests** using Fastify inject + MockDuffelAdapter

### Monorepo fix

- **exports.types → src/index.ts** — 14 packages had `exports["."].types` pointing to `./dist/index.d.ts` (only exists after build). Changed all to `./src/index.ts` matching `@otaip/core`'s pattern. `pnpm -r run typecheck` now works without a prior build step.

### Tests

- 2891 total passing (10 new OTA tests + 2881 existing), 0 failing

## 0.3.3 — Sprint C: Governance Agents, Fallback Chain, CLI

The OTAIP build plan is now complete. Sprint C ships the final three steps: the fallback chain engine for automatic channel recovery, four governance agents that monitor the platform's own performance, and a CLI tool for zero-code developer access.

### Added

- **Fallback chain engine** (`executeFallbackChain()`) — when the primary routing channel fails, automatically tries each fallback in order. Skips channels whose circuit breaker is open (integrates with ApiAbstraction agent 3.5). Returns a full audit trail of every attempt with durations and error details. 6 tests.
- **Performance Audit Agent (9.5)** — reads EventStore `agent.executed` events, computes success rate, error rate, avg/p95/p99 latency, identifies degraded agents (error rate >15% or p95 >8000ms). AgentContract from day one. 10 tests.
- **Routing Audit Agent (9.6)** — reads `routing.decided` + `routing.outcome` events, correlates by session, computes per-channel success rates and fallback frequency. AgentContract from day one. 7 tests.
- **Recommendation Agent (9.7)** — takes performance + routing audit reports as input, applies deterministic rules, produces typed recommendations (`route_adjustment`, `adapter_health`, `capacity`, `config_update`). All `auto_applicable: false` in v1. Confidence based on data volume. AgentContract from day one. 10 tests.
- **Alert Agent (9.8)** — configurable threshold monitoring with defaults from the master plan: GDS error rate 5%/15% (warning/critical), NDC 10%/25%, adapter latency p95 >8000ms, 3+ consecutive failures, pipeline rejection rate >20%. AgentContract from day one. 13 tests.
- **CLI tool** (`@otaip/cli`) — new package with 6 commands: `otaip search`, `otaip price`, `otaip book`, `otaip adapters`, `otaip agents` (lists all 75 agents with contract status), `otaip validate` (dry-run pipeline validation). Table format by default, `--json` for machine output, `--verbose` for gate details.

### Fixed

- **Semver compliance** — version `0.3.2.1` (4-part, not valid semver) broke pnpm's `workspace:*` matching. All packages now use proper 3-part semver `0.3.3`.
- **Unused import** in `chain-engine.ts` (`FallbackStatus`).
- **CLI ESLint config** — typescript-eslint can't resolve workspace deps when CWD is a nested package. CLI excluded from root lint glob; covered by `pnpm typecheck` instead.

### Tests

- 46 net new tests across 5 files (2881 total passing, 0 failing)

### Build plan status

All six steps from the master plan are now shipped:

| Step | Deliverable | Sprint |
|---|---|---|
| 1 | Pipeline validator (6 gates) | A (v0.3.2) |
| 2 | LLM tool layer (bridge + catalog) | B (v0.3.2.1) |
| 3 | Routing (capability registry + fallback chain) | A + C |
| 4 | EventStore | B (v0.3.2.1) |
| 5 | Governance agents (4 agents) | C (v0.3.3) |
| 6 | CLI tool | C (v0.3.3) |

## 0.3.2.1 — Sprint B: LLM Tool Layer + EventStore

The pipeline validator can now talk to LLMs. Sprint B connects the contract infrastructure (shipped in v0.3.2) to the tool-dispatch layer, adds persistent event logging, ships a new agent, and delivers the first demo that runs the full architecture end-to-end.

### Added

- **Agent-to-Tool bridge** (`agentToTool()`) — wraps any `AgentContract` + `Agent` pair into a `ToolDefinition` that `AgentLoop` can register and dispatch. Every tool call runs through the six pipeline gates. Failures throw `AgentToolError` with structured reason + issues for LLM self-correction. `registerAgentTools()` batch-converts all contracted agents into a `ToolRegistry`.
- **Catalog generator** — `generateMcpTools()` (Claude MCP), `generateOpenAiFunctions()` (OpenAI strict mode, draft-7), `generateCatalog()` (standalone JSON Schema). All schemas from `zodToJsonSchema()` — zero hand-written JSON anywhere in the pipeline.
- **EventStore** — `OtaipEvent` discriminated union with 6 event types (`agent.executed`, `routing.decided`, `routing.outcome`, `booking.completed`, `booking.failed`, `adapter.health`). `InMemoryEventStore` with filter-by-type/session/agent/time-window queries and percentile aggregation (p50/p95/p99). Optional auto-logging from the tool bridge via `eventStore` option.
- **Agent 3.8 PnrRetrieval** — new agent that retrieves an existing PNR/booking by record locator across distribution adapters. `AgentContract` from day one (`actionType: 'query'`, Zod schemas, semantic validation). Stub retrieval engine — wires to real adapters when `ConnectAdapter` gains `retrieveBooking()`.
- **GdsNdcRouter registry adapter** — `buildCarrierCapabilities()` converts the existing `carrier-channels.json` lookup table into `ChannelCapability` entries for the `CapabilityRegistry`. 8 equivalence tests prove NDC-preferred, GDS-preferred, and DIRECT-only carriers are correctly encoded. Infrastructure for the full scoring-engine swap.
- **Full pipeline demo** (`demo/book-flight-full.ts`) — first demo that uses the Sprint A/B architecture end-to-end: contract-driven tool definitions, `agentToTool()` bridge, 6-gate pipeline validator, EventStore logging, pipeline summary. Run with `pnpm --filter @otaip/demo book:full`.
- **`demo/README.md`** — documents all 5 demo scripts with credential requirements.
- **`AGENT_TOOL_NAMES`** — stable snake_case name map for all 10 contracted agents (e.g. `'1.1' → 'availability_search'`).

### Fixed

- **`@otaip/connect` missing from vitest alias map** — the only workspace package without an alias, causing CI to fail when tests imported `CapabilityRegistry` from `@otaip/connect` (resolved to `dist/` which doesn't exist without a build step).

### Tests

- 39 net new tests across 7 files (2835 total passing, 0 failing)

## 0.3.2 — Sprint A: Pipeline Contract Foundation

OTAIP moves from a library to a platform: every agent that participates in an LLM-orchestrated or pipeline-composed flow can now declare a machine-verifiable `AgentContract`, enforced at runtime by six gates (schema, semantic, intent lock, cross-agent consistency, confidence, action classification). Agents without contracts continue to work as direct function calls — the change is purely additive.

### Added

- **Pipeline validator** (`@otaip/core/pipeline-validator`) — six-gate runtime with `PipelineOrchestrator`, session-scoped intent lock, cross-agent consistency checker, confidence gate (floors: query 0.7 / reversible 0.9 / irreversible 0.95 / reference 0.9), action classifier with approval-token enforcement for irreversible mutations, and a 3-retry-per-gate budget
- **Zod → JSON Schema bridge** backed by Zod 4's native `z.toJSONSchema()` — single source of truth for both runtime validation and LLM tool definitions, no new dependencies
- **Shared semantic validators** — `validateFutureDate`, `validateIataCode`, async `resolveAirportStrict`, `resolveAirlineStrict`, `resolveFareBasisStrict`
- **`ReferenceDataProvider` interface** in `@otaip/core` with concrete `ReferenceAgentDataProvider` in `@otaip/agents-reference` wrapping the Stage 0 agents (no duplicated dataset)
- **Channel capability registry** — `ChannelCapability` types in `@otaip/core`, `CapabilityRegistry` class in `@otaip/connect`, manifests next to each of the 6 adapters (Amadeus, Sabre, Navitaire, TripPro, HAIP, Duffel)
- **9 agent contracts** covering the end-to-end demo flow (search → price → book → ticket):
  - 0.1 `AirportCodeResolver`, 0.2 `AirlineCodeMapper`, 0.3 `FareBasisDecoder` (reference agents)
  - 1.1 `AvailabilitySearch`, 2.1 `FareRuleAgent`, 2.4 `OfferBuilderAgent` (query)
  - 3.1 `GdsNdcRouter` (query), 3.2 `PnrBuilder` (mutation_reversible), 4.1 `TicketIssuance` (mutation_irreversible)
- **Sprint A end-to-end integration test** in `@otaip/agents-ticketing` proving every one of the six gates fires at least once across a full offline run, plus targeted rejection cases (unknown airport → semantic gate; destination drift → intent-lock gate; past date → semantic gate; ticketing without approval → action-class gate)

### Fixed

- **`OfferEvaluatorAgent` time bomb** — `evaluateOffers()` now accepts an optional `evaluation_time?: string` (ISO 8601). Fixtures dated 2026-04-14 were silently expiring in CI once wall-clock time passed `expires_at`. Default remains `new Date()` so existing callers are unaffected.

### Scope narrowing

- `GdsNdcRouter` (3.1) gets the contract and is now a platform citizen; the internals swap from lookup-table to registry-driven weighted scoring lands in Sprint B (callers unchanged, 467-line test fixture set updates will come with it)

### Tests

- 59 new tests across 9 files (pipeline validator units, capability registry, Sprint A E2E)
- Full suite: 2796 passing, 3 skipped, 0 failing

## 0.3.0 — Stage 9: Platform Upgrade

### Added
- **Schema-Aware Tool Interface** — Zod-validated tool definitions with runtime input/output checking (`packages/core/src/tool-interface/`)
- **Agent Execution Loop** — Deterministic message→tool→response cycle with typed state transitions (`packages/core/src/agent-loop/`)
- **Lifecycle Hooks** — Pre/post hooks on agent actions for logging, metrics, and guardrails (`packages/core/src/lifecycle/`)
- **Context Budget Manager** — Token-aware context management with pluggable compaction strategies (`packages/core/src/context/`)
- **Retry with Jitter** — Shared retry engine with exponential backoff and full jitter, replacing inline retry in BaseAdapter (`packages/core/src/retry/`)
- **Sub-Agent Spawning** — Parent agents can spawn scoped child agents with controlled tool access (`packages/core/src/sub-agent/`)

### Changed
- `BaseAdapter.withRetry()` now uses the shared retry engine from `@otaip/core` (adds jitter, no breaking API changes)
- All package versions bumped from 0.2.x to 0.3.0
