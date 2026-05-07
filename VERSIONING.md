# Versioning

OTAIP follows [Semantic Versioning 2.0.0](https://semver.org/) with one pre-v1.0 tightening rule explained below.

## Current phase: pre-v1.0

Until v1.0.0, **every release is a patch bump.** `0.6.0 → 0.6.1 → 0.6.2 → …` This holds regardless of sprint size, feature count, or how "big" a release feels.

Why a strict patch-bump rule before v1.0:
- Predictable, chronological version history
- No ambiguity about "does this warrant a minor bump?"
- Consumers reading the changelog can assume monotonic increments
- Minor and major bumps are reserved for the v1.0 milestone onward

## v1.0 onward

Once the public API surface stabilizes (`@otaip/core` types, `AgentContract`, `PipelineOrchestrator`, `ConnectAdapter`, `BookingReference`), standard semver applies:

- **MAJOR** — breaking changes to public types or interfaces
- **MINOR** — backward-compatible additions (new agents, new adapters, new contract fields)
- **PATCH** — backward-compatible fixes

## Pre-v1.0 release history

Our early history has version jumps that don't follow the patch-bump rule. These predate this policy document:

| Git tag | Sprint | Date | Notes |
|---|---|---|---|
| v0.3.0 | Stage 9 platform upgrade | 2026-04-05 | |
| v0.3.1 | — | 2026-04-09 | |
| v0.3.2 | Sprint A — Pipeline Contract Foundation | 2026-04-16 | |
| v0.3.2.1 | Sprint B — LLM Tool Layer + EventStore | 2026-04-17 | 4-part version; not valid semver. Fixed in 0.3.3. |
| v0.3.3 | Sprint C — Governance Agents, Fallback Chain, CLI | 2026-04-17 | |
| v0.3.4 | Sprint D+E — Docs + Reference OTA Search | 2026-04-17 | |
| v0.5.0 | Sprint F — OTA Booking, Payment, Ticketing | 2026-04-17 | Should have been v0.3.5 under the current policy |
| v0.5.1 | Sprint G — Offers & Orders (AIDM 24.1) | 2026-04-17 | Should have been v0.3.6 |
| v0.6.0 | Sprint H — OOSD-Native + Multi-Adapter | 2026-04-17 | Should have been v0.3.7 |
| v0.7.0 | Reference OTA hardening + Hotelbeds Activities/Transfers | 2026-05-06 | Should have been v0.6.5 under the patch-bump rule. Bumped to 0.7.0 to re-sync the workspace after `@otaip/adapter-hotelbeds@0.7.0` was published as a single-package minor bump in PR #90 ahead of the repo-wide release. |

The jumps from 0.3.4 to 0.5.0 and 0.5.1 to 0.6.0 came from mechanically following a planning document's "target versions" instead of applying consistent semver. They're preserved as historical git tags because nothing downstream consumes the registry (packages are not yet published to npm).

The v0.6.4 → v0.7.0 jump is the one exception that came after this policy document was written. It exists because `@otaip/adapter-hotelbeds@0.7.0` was published to npm as a per-package minor bump before the corresponding repo-wide release was cut; rather than leave the rest of the ecosystem stuck behind a non-existent v0.6.5 tag, we ratify the bump and re-sync.

**Going forward, all releases are patch bumps off v0.7.x until v1.0.** The next release is v0.7.3.

## How to bump

1. Update `version` field in every `package.json` (root + workspace packages) using the repo's bump script pattern
2. Add a `## X.Y.Z — <title>` section at the top of `CHANGELOG.md`
3. Open a `chore: release vX.Y.Z` PR
4. Merge — the Release workflow reads CHANGELOG.md and creates the GitHub release

## Not-a-version

The `demo/` package stays at `0.3.0` because it's a private, pinned example — not a versioned artifact. This is intentional. Versioning updates should exclude demo from the bump script.
