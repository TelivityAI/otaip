# MCT reference data (`data/reference/mct/`)

Curated Minimum Connecting Time rows for Agent 1.3 Connection Builder.

**Authority:** IATA SSIM Chapter 8 + PSC Resolution 765. See `docs/knowledge-base/mct.md`.

## Hierarchy (most specific → fail-closed)

| Priority | Level              | File / field                                                  | When used                                                                                 |
| -------- | ------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1        | Carrier override   | `carrier-overrides.json`                                      | Matching arriving/departing carriers (+ connection status) at airport; optional terminals |
| 2        | Airport + terminal | `airport-rules.json` (`terminal_change` or terminal pair set) | No carrier match; terminal change known                                                   |
| 3        | Airport            | `airport-rules.json` (station default for status)             | No carrier/terminal match                                                                 |
| 4        | Fail-closed        | —                                                             | **No invented IATA global table.** MCT unresolved → connection invalid                    |

## Rules for adding rows

- Cite a source (`source` field): SSIM/aggregator extract, public doc URL, or `already-in-code:…`.
- Do **not** add airport-constant guesses or a global 60/90 table.
- Do **not** derive MCT from haversine / great-circle distance.
- Interline / unpublished carrier exceptions → leave as `DOMAIN_QUESTION` in the KB; do not invent.

## Files

- `carrier-overrides.json` — carrier@airport starter rows
- `airport-rules.json` — station/terminal rows (empty until a real extract is available)
