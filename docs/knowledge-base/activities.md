# Hotelbeds Activities API — Domain Knowledge

Source: vendor brief, May 2026. This file is the authoritative domain input for the `@otaip/adapter-hotelbeds` Activities surface. Anything missing here is captured as an open `DOMAIN_QUESTION` at the bottom — never invent.

## Endpoints

| Operation     | Method | Path                                     |
| ------------- | ------ | ---------------------------------------- |
| Availability  | POST   | `/activity-api/3.0/activities/availability` |
| Booking       | POST   | `/activity-api/3.0/activities/booking`   |
| Cancellation  | DELETE | `/activity-api/3.0/activities/booking/{ref}` *(see DQ-A1)* |

Base URL is the same Hotelbeds host as Hotels (`api.test.hotelbeds.com` for sandbox, `api.hotelbeds.com` for production). Path prefix is `/activity-api/3.0`.

## Auth

Identical to Hotels API — `Api-key` + `X-Signature: SHA256(apiKey + secret + utcSeconds)`. Reuse `buildAuthHeaders()` from `auth.ts`.

## Availability — request

```json
{
  "filters": {
    "searchFilterItems": [{ "type": "destination", "value": "BCN" }]
  },
  "from": "2026-06-01",
  "to": "2026-06-03",
  "paxes": {
    "adults": 2,
    "children": [8, 12]
  }
}
```

- `filters.searchFilterItems[].type`: `"destination"` is the only documented filter type for this session. `value` is a Hotelbeds destination code (BCN, PAR, LON, etc.).
- `paxes.children`: array of *ages*, not a count. `[8, 12]` means two children aged 8 and 12.
- Date range is inclusive; activities priced for the date range.

## Availability — response shape

The brief documents the OTAIP-canonical mapping (`ActivityOffer[]` with `modalities`, pricing per pax type, images, duration, cancellation policy) but does NOT specify the raw Hotelbeds wire field names. The adapter's raw response type is best-effort based on the OTAIP shape and Hotelbeds API conventions. Each activity carries:

- One or more *modalities* — variants like skip-the-line, private, group. The booking call references one `modalityCode`.
- Per-modality pricing keyed by pax type. The brief shows a single `Money` per modality (`price` per adult, optional `childPrice`). Net rate is the bedbank cost; selling rate is what the platform may surface to the user. See DQ-A2.
- A cancellation policy. Brief shows enum `'NOR' | 'NRF'` — refundable vs non-refundable. Behavioral semantics (penalty schedule, free-cancel cutoff) are NOT documented here.
- Activity metadata: name, description, duration string, images, geo location.

## Booking — request

```json
{
  "activities": [{
    "activityCode": "E-A10-000100301",
    "modalityCode": "TOUR_GUIDE|EN|1",
    "from": "2026-06-01",
    "paxes": [{ "age": 30 }, { "age": 28 }]
  }],
  "holder": { "name": "John", "surname": "Smith" },
  "clientReference": "AVR-ACT-001"
}
```

- `paxes[].age` is required for every pax. The brief does not differentiate between adult/child here — age alone is the input.
- Multiple activities can be booked in one call (`activities: [...]`); the adapter surface in this session books one at a time.

## Booking — response

Returns `{ bookingReference, status: 'CONFIRMED' | 'ON_REQUEST', clientReference, voucherUrl? }`.

- `'ON_REQUEST'` indicates the supplier has not yet confirmed; a follow-up retrieval may be required to learn the final outcome. The retrieval/poll flow is NOT specified — see DQ-A3.
- `voucherUrl` is a string. Whether it is signed, time-limited, or anonymously accessible is not documented — DQ-A4.

## Cancellation

Official Hotelbeds Activities Booking API cancel:

`DELETE /activity-api/3.0/bookings/{language}/{reference}?cancellationFlag=SIMULATION|CANCELLATION`

Source: https://developer.hotelbeds.com/documentation/activities/booking-api/booking-and-post-booking/cancel/

Two-step: SIMULATION previews fees; CANCELLATION is the hard cancel (money-path / once-only).

OTAIP method: `cancelActivity(bookingReference, flag?, options?)` → `{ status: 'CANCELLED', cancellationReference }`.

**DQ-A1: CLOSED** (official docs above).

## Sandbox

- Same credentials as Hotels (`HOTELBEDS_API_KEY` / `HOTELBEDS_SECRET`).
- Sandbox returns synthetic activities for major destinations (BCN, PAR, LON, etc.).
- Subject to the same daily request quota as the Hotels sandbox.

## Open DOMAIN_QUESTIONs

- **DQ-A2** — Net vs selling rate field names. The brief uses a single `Money` per modality. The Hotels API returns `net` and `sellingRate` as separate string fields. The adapter mapper currently treats the modality price as net and does not surface a separate selling rate. If Activities does the same, surface it; if not, the price field is treated as net per the brief.
- **DQ-A3** — `'ON_REQUEST'` confirmation flow. No retrieval endpoint or poll cadence is documented. The adapter returns the status as-is and leaves the orchestration agent to decide whether and how to confirm later.
- **DQ-A4** — `voucherUrl` access semantics. Whether the URL requires auth, has an expiry, or is anonymously accessible is unverified. The adapter passes the URL through unmodified.
- **DQ-A5** — Cancellation policy semantics. The brief defines `'NOR' | 'NRF'` only as enum values. The Hotels module treats `cancellationPolicies[]` as a list of (penalty amount, effective-from) pairs. Whether Activities returns a similar structure or only the bare class flag is unverified. The adapter exposes the class verbatim.

## Method surface (for the adapter)

```ts
searchActivities(request: ActivitySearchRequest): Promise<ActivityOffer[]>;
bookActivity(request: ActivityBookRequest): Promise<ActivityBookResponse>;
cancelActivity(bookingReference: string): Promise<{ status: 'CANCELLED'; cancellationReference: string }>;
```
