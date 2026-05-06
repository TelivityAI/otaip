# Hotelbeds Transfers API — Domain Knowledge

Source: vendor brief, May 2026. This file is the authoritative domain input for the `@otaip/adapter-hotelbeds` Transfers surface. Anything missing here is captured as an open `DOMAIN_QUESTION` at the bottom — never invent.

## Endpoints

| Operation     | Method | Path                            |
| ------------- | ------ | ------------------------------- |
| Availability  | POST   | `/transfer-api/1.0/availability` |
| Booking       | POST   | `/transfer-api/1.0/bookings`     |
| Cancellation  | DELETE | `/transfer-api/1.0/bookings/{ref}` *(see DQ-T1)* |

Base URL is the same Hotelbeds host as Hotels (`api.test.hotelbeds.com` for sandbox, `api.hotelbeds.com` for production). Path prefix is `/transfer-api/1.0`.

## Auth

Identical to Hotels API — `Api-key` + `X-Signature: SHA256(apiKey + secret + utcSeconds)`. Reuse `buildAuthHeaders()` from `auth.ts`.

## Availability — request

```json
{
  "language": "en",
  "from": { "type": "IATA", "code": "BCN" },
  "to":   { "type": "ATLAS", "code": "1234" },
  "outbound": { "date": "2026-06-01", "time": "14:30" },
  "adults": 2,
  "children": 0
}
```

- `from.type` / `to.type`: one of `'IATA' | 'ATLAS' | 'GPS'`.
  - `IATA` — three-letter airport/station code (BCN, LHR, JFK).
  - `ATLAS` — Hotelbeds' internal location identifier. The full code-set is not documented here; expect numeric strings.
  - `GPS` — latitude/longitude pair encoded as `code` (format unverified — DQ-T2).
- `outbound.time` is HH:mm in 24-hour clock. Whether this is local time at `from` or UTC is unverified — DQ-T3.
- The brief documents one-way only (`outbound`). Round-trip / `inbound` leg is NOT in scope this session.

## Availability — response shape

The brief documents the OTAIP-canonical mapping (`TransferOffer[]` with vehicle types, prices, pickup info) but does NOT specify the raw Hotelbeds wire field names. The adapter's raw response type is best-effort based on the OTAIP shape. Each transfer carries:

- `transferType`: `'PRIVATE' | 'SHARED' | 'LUXURY'` per brief. Hotelbeds may publish other classes; the adapter passes the raw string through and the field-mapper validates against the documented enum, falling back to the literal value if unknown.
- `vehicleType`: free-form descriptor (e.g. "Sedan", "Minibus 8pax").
- `maxPassengers`: integer cap.
- `price`: per-vehicle (not per-pax). DQ-T4.
- `pickupInfo` / `dropoffInfo`: `location` is free text; `time` for pickup is HH:mm (or ISO datetime — DQ-T5); `estimatedTime` for drop-off is similarly underspecified.

## Booking — request

```json
{
  "transferCode": "...",
  "holder": { "name": "John", "surname": "Smith" },
  "passengers": [{ "type": "ADULT", "name": "John", "surname": "Smith" }],
  "clientReference": "AVR-TRF-001"
}
```

- `passengers[].type`: `'ADULT' | 'CHILD'` per brief.
- `transferCode` is opaque, returned in availability.

## Booking — response

Returns `{ bookingReference, status: 'CONFIRMED' | 'ON_REQUEST', clientReference, pickupDetails: { location, time, instructions? } }`.

- `'ON_REQUEST'` semantics same as Activities — see DQ-T6.
- `pickupDetails.instructions` free text passed through.

## Cancellation

The brief specifies the OTAIP method signature `cancelTransfer(bookingReference)` returning `{ status: 'CANCELLED', cancellationReference }`. The HTTP-level details (DELETE vs POST, simulate-confirm pattern) are NOT documented for Transfers — DQ-T1.

## Sandbox

- Same credentials as Hotels.
- Sandbox returns synthetic results for airport→hotel routes.
- Same daily quota.

## Open DOMAIN_QUESTIONs

- **DQ-T1** — Cancellation HTTP shape. Same situation as Activities. The adapter assumes `DELETE /bookings/{ref}` with no flag. Confirm against sandbox.
- **DQ-T2** — `GPS` location code format. The brief lists `'GPS'` as a `from.type` / `to.type` value but does not document the `code` payload — comma-separated `lat,lon`? URL-encoded JSON? Unknown. The adapter passes the supplied string through verbatim; callers must format correctly until verified.
- **DQ-T3** — `outbound.time` timezone. Local at `from` or UTC? The adapter passes through unchanged. Operators using non-IATA `from` types must confirm.
- **DQ-T4** — Per-vehicle vs per-pax pricing. Brief implies per-vehicle but doesn't state. The adapter exposes a single `price` and treats it as the booking-line total.
- **DQ-T5** — Pickup `time` format. HH:mm string vs full ISO datetime. The adapter passes through unchanged.
- **DQ-T6** — `'ON_REQUEST'` confirmation flow. Same as Activities — no retrieval endpoint documented. Caller decides.
- **DQ-T7** — Net vs selling rate. The brief uses a single `Money` price. Hotels exposes both. Whether Transfers does is unverified — the adapter currently treats the price as net.
- **DQ-T8** — Round-trip / inbound leg. Out of scope this session. A future revision will need to model `inbound` symmetrically with `outbound`.

## Method surface (for the adapter)

```ts
searchTransfers(request: TransferSearchRequest): Promise<TransferOffer[]>;
bookTransfer(request: TransferBookRequest): Promise<TransferBookResponse>;
cancelTransfer(bookingReference: string): Promise<{ status: 'CANCELLED'; cancellationReference: string }>;
```
