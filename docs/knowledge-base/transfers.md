# Hotelbeds Transfers API — Domain Knowledge

Source: vendor brief, May 2026, plus official Hotelbeds public docs
(https://developer.hotelbeds.com/). This file is the authoritative domain input
for the `@otaip/adapter-hotelbeds` Transfers surface. Anything missing here is
captured as an open `DOMAIN_QUESTION` at the bottom — never invent.

## Endpoints

| Operation     | Method | Path |
| ------------- | ------ | ---- |
| Availability  | GET/POST | `/transfer-api/1.0/availability` *(Simple = path params; adapter currently POSTs brief JSON body)* |
| Booking       | POST   | `/transfer-api/1.0/bookings` |
| Booking detail | GET  | `/transfer-api/1.0/bookings/{language}/reference/{booking_reference}` |
| Cancellation  | DELETE | `/transfer-api/1.0/bookings/{language}/reference/{booking_reference}` |

Base URL is the same Hotelbeds host as Hotels (`api.test.hotelbeds.com` for
sandbox, `api.hotelbeds.com` for production). Path prefix is `/transfer-api/1.0`.

## Auth

Identical to Hotels API — `Api-key` + `X-Signature: SHA256(apiKey + secret + utcSeconds)`.
Reuse `buildAuthHeaders()` from `auth.ts`.

## Availability — request

Vendor brief shape (what the adapter currently posts):

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

Official Availability Simple uses path segments and a combined outbound
dateTime, e.g.
`.../from/ATLAS/265/to/IATA/PMI/2021-08-17T12:15:00/2/0/0`.

Cited: https://developer.hotelbeds.com/documentation/transfers/booking-api/search-availability/availability-simple/

- `from.type` / `to.type`: `IATA | ATLAS | GPS | PORT | STATION` (official; brief
  documented IATA/ATLAS/GPS only).
- **GPS code format (DQ-T2 CLOSED):** *"Latitude and longitude coordinates, A
  minimum of three decimal places is required"*. Observed encoding (Activities
  GPS filter example and Transfers confirmation rateKey samples):
  `"lat, lon"` comma-separated, e.g. `"41.40529898888071, 2.181130939007672"` /
  `"41.39347365813525, 2.1628669129116207"`. Description + full address required
  at confirmation for GPS services.
- Optional `inbound` dateTime for round-trip (documented; adapter one-way scope).

## Availability — response shape (official)

Cited Availability Simple response parameters + published response sample:

- `services[].transferType`: `SHARED | PRIVATE` (official; brief also listed LUXURY).
- `services[].price.totalAmount` / `services[].price.netAmount` / `currencyId`.
- `services[].maxPaxCapacity` — passenger limit of the **transfer service**
  (vehicle/service capacity), not a per-seat price unit.
- `services[].pickupInformation.date` + `.time` — pickup date and time.
- `services[].cancellationPolicies[]`: `{ amount, from, currencyId, utcOffset? }`.
  Official text: *"The date and time are always based on the destination's local
  time."* Cancel docs likewise: *"Cancellations always take into account day and
  time of the destination."*

## Booking — response

Cited: https://developer.hotelbeds.com/documentation/transfers/booking-api/booking-post-booking/booking-request/
and Booking Detail / Booking List / Booking Cancellation docs.

Documented booking / transfer status values in those Transfers pages:
**`CONFIRMED` | `CANCELLED` | `MODIFIED`**.

The vendor brief also listed `'ON_REQUEST'`. Whether Transfers confirm can
return `ON_REQUEST`, and what retrieval/poll cadence applies if so, is **not
closed from Transfers-specific docs** — see DQ-T6 (do not infer from Activities
portal marketing copy).

Retrieval: `GET .../bookings/{language}/reference/{booking_reference}`
(Booking Detail).

## Cancellation

Official:

`DELETE /transfer-api/1.0/bookings/{language}/reference/{booking_reference}`

Optional `?simulation=true`. Absent simulation = hard cancel. Partial cancel via
`/id/{service_id}` is out of scope for the adapter.

Source: https://developer.hotelbeds.com/documentation/transfers/booking-api/booking-post-booking/booking-cancellation/

**Cancellation policy timing = destination local time** (cancel docs + availability
`cancellationPolicies.from` description).

OTAIP method: `cancelTransfer(bookingReference, options?)` →
`{ status: 'CANCELLED', cancellationReference }`.

**DQ-T1: CLOSED** (official docs above).

## Sandbox

- Same credentials as Hotels.
- Sandbox returns synthetic results for airport→hotel routes.
- Same daily quota.

## DOMAIN_QUESTIONs

### CLOSED (official docs / observed response shapes)

- **DQ-T1** — Cancel path + `simulation` query. Evidence: Booking Cancellation docs.
- **DQ-T2** — GPS code format. Evidence: Availability Simple — lat/lon, ≥3 decimal
  places; observed `"lat, lon"` comma-separated examples on developer.hotelbeds.com.
- **DQ-T4** — Per-vehicle vs per-pax pricing. Evidence: Availability Simple —
  `price.totalAmount` / `price.netAmount` are amounts of the **transfer service /
  booking**, with separate `maxPaxCapacity`. Not a per-pax line item.
- **DQ-T5** — Pickup `time` format. Evidence: official availability response sample
  uses `"time": "10:00:00"` (HH:mm:ss) alongside separate `date`. Request Simple
  path uses ISO-like `YYYY-MM-DDTHH:mm:ss` outbound dateTime. Adapter still passes
  brief `{ date, time }` through unchanged.
- **DQ-T7** — Net vs selling rate. Evidence: `price.netAmount` + `price.totalAmount`
  (not Hotels `sellingRate`). Adapter prefers `netAmount` when present, else
  `totalAmount` / brief `amount`.

### Still open

- **DQ-T3** — `outbound.time` timezone (local at `from` vs UTC).
  **Closed for cancellation policy timing only:** destination local time (cited
  under Cancellation / availability `cancellationPolicies.from` — Transfers lock).
  **Still open for the availability request clock:** official Simple examples use
  `2021-08-17T12:15:00` with no `Z`/offset. Pickup-time KB maps request time to
  flight/train arrival or departure depending on direction — not an explicit
  “UTC vs local-at-from” rule for the request field. Adapter passes through
  unchanged.
- **DQ-T6** — `'ON_REQUEST'` confirmation / poll cadence on **Transfers**.
  Transfers booking docs list `CONFIRMED` | `CANCELLED` | `MODIFIED`. The vendor
  brief also listed `ON_REQUEST`. Closing “no OnRequest on confirm” requires
  Transfers-specific evidence — **do not copy** the Activities portal “No
  OnRequest or pending stages” marketing line onto Transfers. Adapter passes
  `ON_REQUEST` through when present; caller decides follow-up until closed.
- **DQ-T8** — Round-trip / inbound leg. Official Availability Simple documents
  optional `inbound` dateTime for round-trip. Adapter surface remains one-way
  this session; modeling `inbound` symmetrically is future work.

## Method surface (for the adapter)

```ts
searchTransfers(request: TransferSearchRequest): Promise<TransferOffer[]>;
bookTransfer(request: TransferBookRequest): Promise<TransferBookResponse>;
cancelTransfer(bookingReference: string, options?): Promise<{ status: 'CANCELLED'; cancellationReference: string }>;
```
