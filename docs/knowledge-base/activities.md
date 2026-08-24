# Hotelbeds Activities API — Domain Knowledge

Source: vendor brief, May 2026, plus official Hotelbeds public docs
(https://developer.hotelbeds.com/). This file is the authoritative domain input
for the `@otaip/adapter-hotelbeds` Activities surface. Anything missing here is
captured as an open `DOMAIN_QUESTION` at the bottom — never invent.

## Endpoints

| Operation     | Method | Path |
| ------------- | ------ | ---- |
| Availability  | POST   | `/activity-api/3.0/activities/availability` |
| Booking confirm | POST | `/activity-api/3.0/bookings` *(confirm; see Booking Confirm docs)* |
| Booking detail | GET  | `/activity-api/3.0/bookings/{language}/{reference}` |
| Cancellation  | DELETE | `/activity-api/3.0/bookings/{language}/{reference}?cancellationFlag=SIMULATION\|CANCELLATION` |

Base URL is the same Hotelbeds host as Hotels (`api.test.hotelbeds.com` for
sandbox, `api.hotelbeds.com` for production). Path prefix is `/activity-api/3.0`.

## Auth

Identical to Hotels API — `Api-key` + `X-Signature: SHA256(apiKey + secret + utcSeconds)`.
Reuse `buildAuthHeaders()` from `auth.ts`.

## Availability — request

```json
{
  "filters": [{
    "searchFilterItems": [{ "type": "destination", "value": "BCN" }]
  }],
  "from": "2026-06-01",
  "to": "2026-06-03",
  "paxes": [{ "age": 30 }, { "age": 8 }],
  "language": "en"
}
```

Official Availability docs also document filter types beyond destination
(GPS, service, hotel, segment, priceFrom/priceTo, text). GPS filter value
format: `"lat, lon"` (example: `"41.40529898888071, 2.181130939007672"`).

The vendor brief used `{ adults, children: ages[] }` for paxes; official
docs use `paxes: [{ age }]`. Adapter request body follows the brief shape
already shipped — wire alignment of pax encoding is not reopened here.

## Availability — response shape (official)

Cited: https://developer.hotelbeds.com/documentation/activities/booking-api/availability/availability-/

- Modalities with `amountsFrom` / `rateDetails` pricing per pax type.
- **`amount`** — agency price for the modality/pax.
- **`boxOfficeAmount`** — gate/counter price. Official text: *"The Box office
  price is the price value at the gate or counter. It is not the selling price
  of the activity"*. There is **no** Hotels-style `sellingRate` field.
- **`rateClass`**: `NOR` (refundable — read `cancellationPolicies`) or `NRF`
  (non-refundable).
- **`cancellationPolicies[]`**: `{ dateFrom, amount }` — penalty applies from
  `dateFrom` onward. Date/time is **local time in the destination**.
- `freeCancellation` boolean on the rate.

Cited cancellation semantics:
https://developer.hotelbeds.com/documentation/activities/knowledge-base/cancellation-policies/

- `NRF` → non-refundable (cancellation charges apply from confirmation).
- `NOR` → read `cancellationPolicies`; if array absent/null, cancel until the
  last moment without charges.

## Booking — confirm

Cited: https://developer.hotelbeds.com/documentation/activities/booking-api/booking-and-post-booking/booking-confirm/

Confirm response `booking/@status` restricted values: **`"CONFIRMED"` |
`"CANCELLED"`**. Always present.

Hotelbeds Activities product marketing (developer portal): *"100% of our
product guaranteed on confirmation: No OnRequest or pending stages."*

**`ON_REQUEST` is not a Hotelbeds Activities confirm status.**

### PRECONFIRMED ≠ ON_REQUEST

Cited: https://developer.hotelbeds.com/documentation/activities/booking-api/booking-and-post-booking/preconfirm-and-reconfirm/

Optional two-step hold: **preconfirm** returns `status: "PRECONFIRMED"` (allotment
held pending payment), then **reconfirm** → `CONFIRMED`. This is a payment-hold
flow, not supplier on-request confirmation.

### Booking detail (retrieval)

Cited: https://developer.hotelbeds.com/documentation/activities/booking-api/booking-and-post-booking/booking-details/

`GET /activity-api/3.0/bookings/{language}/{HB_booking_reference}` retrieves
status and the same shape as confirmation. Used to re-check status / content
changes — not an ON_REQUEST poll cadence (ON_REQUEST does not apply).

### Vouchers

Confirm may return `booking/activities/vouchers[]` with `url`, `dateFrom`,
`dateTo` when the supplier generates barcode/QR vouchers. Certification docs
say: if vouchers ≠ null, provide the Hotelbeds PDF/URL; if null, generate your
own voucher. Whether the URL is anonymously accessible / signed is still open
(DQ-A4).

## Cancellation

Official Hotelbeds Activities Booking API cancel:

`DELETE /activity-api/3.0/bookings/{language}/{reference}?cancellationFlag=SIMULATION|CANCELLATION`

Source: https://developer.hotelbeds.com/documentation/activities/booking-api/booking-and-post-booking/cancel/

Two-step: **SIMULATION** previews fees; **CANCELLATION** is the hard cancel
(money-path / once-only).

OTAIP method: `cancelActivity(bookingReference, flag?, options?)` →
`{ status: 'CANCELLED', cancellationReference }`.

**DQ-A1: CLOSED** (official cancel docs above).

## Sandbox

- Same credentials as Hotels (`HOTELBEDS_API_KEY` / `HOTELBEDS_SECRET`).
- Sandbox returns synthetic activities for major destinations (BCN, PAR, LON, etc.).
- Subject to the same daily request quota as the Hotels sandbox.

## DOMAIN_QUESTIONs

### CLOSED (official docs)

- **DQ-A1** — Cancel path + SIMULATION / CANCELLATION flags.
  Evidence: Cancel docs URL above.
- **DQ-A2** — Net vs selling rate.
  Evidence: Availability docs — `amount` + `boxOfficeAmount` (gate price, explicitly
  *not* selling price). No Hotels-style `sellingRate`. Adapter treats modality
  `amount` as net/agency price; may surface `boxOfficeAmount` when present.
- **DQ-A3** — `ON_REQUEST` confirmation / poll cadence.
  Evidence: Booking Confirm restricted statuses `CONFIRMED` | `CANCELLED`;
  developer portal “No OnRequest or pending stages”; Preconfirm/Reconfirm docs
  for `PRECONFIRMED` (≠ ON_REQUEST); Booking Detail for retrieval.
- **DQ-A5** — Cancellation policy structure.
  Evidence: Cancellation policies KB + Availability — `rateClass` NOR/NRF plus
  `cancellationPolicies[]` of `{ dateFrom, amount }`, destination local time.

### Still open

- **DQ-A4** — `voucherUrl` / vouchers URL access semantics (auth required?
  anonymous? CDN signed?). Validity window fields (`dateFrom`/`dateTo`) are
  documented when vouchers are present; access control is unverified. Adapter
  passes voucher URLs through unmodified.

## Method surface (for the adapter)

```ts
searchActivities(request: ActivitySearchRequest): Promise<ActivityOffer[]>;
bookActivity(request: ActivityBookRequest): Promise<ActivityBookResponse>;
cancelActivity(bookingReference: string, flag?: 'SIMULATION' | 'CANCELLATION', options?): Promise<{ status: 'CANCELLED'; cancellationReference: string }>;
```
