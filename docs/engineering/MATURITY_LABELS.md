# Component maturity labels

Machine-readable maturity for agents and adapters:

| Label | Meaning |
|---|---|
| `stub` | Throws / placeholder; not callable for real flows |
| `library` | Implemented with tests; may use in-memory defaults |
| `sandbox-tested` | Exercised against supplier sandbox with record/replay or injected handlers |

Do **not** claim `certified` in open core without documented conformance evidence.

## Notable stubs

- `BookingPipeline` (`packages/connect/src/pipeline/booking-flow.ts`) — **stub**
- `PaymentHandoff` (`packages/connect/src/pipeline/payment-handoff.ts`) — **stub**
- Agents throwing `UnimplementedDomainInputError` — **stub**

## Example OTA money path

`examples/ota` may use live search/book against a supplier when credentials are provided via env, but ticketing/cancel paths may remain local/mock. See example README. Not a substitute for DoD drills in `@otaip/core` / `@otaip/connect`.
