# Duffel Cars API — Domain Knowledge

Source: vendor brief, May 2026. Authoritative input for the `@otaip/adapter-duffel` Cars surface. Anything missing here is captured as `DOMAIN_QUESTION` at the bottom — never invent.

## Endpoints

| Operation     | Method | Path                                          |
| ------------- | ------ | --------------------------------------------- |
| Search        | POST   | `/cars/search`                                |
| Quote         | POST   | `/cars/quotes`                                |
| Booking       | POST   | `/cars/bookings`                              |
| Get booking   | GET    | `/cars/bookings/{id}`                         |
| Cancel        | POST   | `/cars/bookings/{id}/actions/cancel`          |

Base URL: `https://api.duffel.com`. Same Bearer auth as flights (`DUFFEL_API_KEY`). Same `Duffel-Version: v2` header.

## Booking flow

**Three-step**, not two-step like flights: `search → quote → book`. Quote is mandatory — you cannot book directly off a search rate.

## ID prefixes

| Prefix  | Object                |
| ------- | --------------------- |
| `seh_`  | Search                |
| `rae_`  | Rate (search result)  |
| `qut_`  | Quote                 |
| `boo_`  | Booking               |

## Search

**Geo-coordinate based, NOT IATA airport codes.** Caller provides `{ latitude, longitude, radius? }` per location.

```json
{
  "data": {
    "pickup_date": "2026-06-15",
    "pickup_time": "10:30",
    "pickup_location": {
      "radius": 5,
      "geographic_coordinates": { "latitude": 41.3874, "longitude": 2.1686 }
    },
    "dropoff_date": "2026-06-20",
    "dropoff_time": "10:30",
    "dropoff_location": {
      "radius": 5,
      "geographic_coordinates": { "latitude": 41.3874, "longitude": 2.1686 }
    },
    "driver": { "age": 30, "residence_country_code": "US" }
  }
}
```

- `radius` — kilometres. Default 5 (per brief). Upper bound not specified — see DQ-C1.
- `driver.age` — used by suppliers to filter rates by minimum-driver-age policies.
- `driver.residence_country_code` — ISO 3166-1 alpha-2.
- `pickup_time` / `dropoff_time` — `HH:mm` 24-hour. Timezone semantics — see DQ-C2.

Response keys we map:

```text
data.id                              → searchId        (seh_…)
data.rates[].id                      → rateId          (rae_…)
data.rates[].car.{name, category, type, transmission, fuel, code, max_passengers,
                  baggage.{small, large}, air_conditioning, images}
data.rates[].supplier.{name, logo_url}
data.rates[].pickup_location.{address, geographic_coordinates, phone, opening_hours}
data.rates[].dropoff_location.{...}
data.rates[].base_amount / base_currency
data.rates[].total_amount / total_currency
data.rates[].payment_type           → 'guarantee' | 'prepaid' | 'postpaid'
```

### Car category & ACRISS

- `car.category` documented values: `compact | economy | standard | full_size | premium | luxury | suv | van`. Adapter narrows to that union and passes through unknown values verbatim — see DQ-C3.
- `car.type` documented values: `four_door | suv | van | …`. Treated as a free-form descriptor; DQ-C3 covers the open enum.
- `car.code` is the **ACRISS** four-letter code (e.g. `CDAV` = Compact, 4-door, Automatic, AC). Industry standard, exposed verbatim as `acrissCode`. The first two characters classify size/body, the third is transmission/drive, the fourth is fuel/AC. The adapter does not parse the code into components — caller decides.

### Payment type

- `prepaid` — paid up front, included in `total_amount`.
- `guarantee` — card on file, paid at counter.
- `postpaid` — paid at counter, no card needed.

## Quote

```json
{ "data": { "rate_id": "rae_…" } }
```

Response repeats search fields plus:

- `id` (`qut_…`)
- `conditions[]` — list of `{ title, text }` (cancellation policy, fuel policy, smoking policy, …). Free text per supplier.
- `charges[]` — itemized supplier charges (insurance, young-driver fee, etc.) `{ amount, currency, description }`.
- `mileage` — `{ unlimited: boolean, included?: number, unit?: string }`.
- `privacy_policies[]` — must be acknowledged by the user before booking. See DQ-C4 — adapter exposes them verbatim; UI/orchestration layer is responsible for the consent step.

## Book

```json
{
  "data": {
    "quote_id": "qut_…",
    "driver": {
      "given_name": "John",
      "family_name": "Smith",
      "email": "john@example.com",
      "phone_number": "+1234567890",
      "date_of_birth": "1990-01-15"
    },
    "payment": { "method": "card", "card_id": "crd_…" },
    "metadata": {},
    "inbound_flight_number": "BA123"
  }
}
```

- `payment.card_id` — references a Duffel-stored card. Card creation is a separate Duffel API and is **out of scope for this adapter** — DQ-C5. The adapter accepts `payment` as an opaque pass-through object; callers construct it.
- `inbound_flight_number` — optional flight number the supplier uses to track late arrivals. Format unverified — DQ-C6.
- `metadata` — opaque `Record<string, string>`.

Response: full booking record. Mapped fields:

```text
data.id                             → bookingId        (boo_…)
data.status                         → 'confirmed' | 'cancelled'
data.reference                      → supplier-issued reference
data.confirmed_at
data.car / supplier / pickup_location / dropoff_location
data.total_amount / total_currency
```

## Get booking

`GET /cars/bookings/{id}` — returns the same shape as Book.

## Cancel

`POST /cars/bookings/{id}/actions/cancel` (no body documented).

Returns `{ status: 'cancelled', cancelled_at }`. Refund mechanics (full vs partial) depend on the supplier's cancellation policy on the quote — see DQ-C7. The adapter exposes the cancellation status only; refund computation is out of scope.

## Sandbox

Provider name: **"Duffel Test Drive"**. Same `https://api.duffel.com` base URL with a test API key prefix.

## Open DOMAIN_QUESTIONs

- **DQ-C1** — `radius` upper bound. The brief documents radius defaulting to 5km but not the maximum. The adapter passes the value through; supplier-side rejection surfaces as a 4xx.
- **DQ-C2** — `pickup_time` / `dropoff_time` timezone. Local time at the pickup location is the typical convention but unverified. The adapter passes the value through unchanged.
- **DQ-C3** — `car.category` and `car.type` enum closure. The brief lists examples but doesn't claim the lists are closed. The adapter narrows to the documented set when matched and passes the raw string through otherwise (`CarCategory | string`).
- **DQ-C4** — `privacy_policies` consent flow. Brief notes "must be acknowledged" but doesn't specify the API mechanic (a header? a flag in the book request? out-of-band?). Adapter exposes the array verbatim; integrating layers handle consent.
- **DQ-C5** — Card creation. The brief explicitly excludes card creation. Adapter accepts `payment` as an opaque object — callers construct `{ method, card_id }` and the adapter doesn't validate.
- **DQ-C6** — `inbound_flight_number` format. Whether it's `BA123` or `BAW123` (IATA vs ICAO) is unverified. Adapter passes through as a string.
- **DQ-C7** — Refund computation on cancellation. The brief says the cancellation endpoint returns status only; refund amount/eligibility comes from quote `conditions[]` text. Adapter does not compute refunds.
- **DQ-C8** — IATA-to-coordinate conversion. The brief explicitly defers this to a future iteration. The adapter accepts only coordinate-based locations; calling code must geocode IATA codes upstream.

## Method surface

```ts
searchCars(request: CarSearchRequest): Promise<{ searchId: string; rates: CarRate[] }>;
quoteCar(rateId: string, signal?: AbortSignal): Promise<CarQuote>;
bookCar(request: CarBookRequest): Promise<CarBookResponse>;
getCarBooking(bookingId: string, signal?: AbortSignal): Promise<CarBookResponse>;
cancelCarBooking(bookingId: string, signal?: AbortSignal): Promise<{ status: 'cancelled'; cancelledAt: string }>;
```
