# Telivity Connect — Usage Guide

Telivity Connect (`@otaip/connect`) is a universal supplier adapter framework that normalizes different travel GDS and NDC APIs behind a single TypeScript interface. Write your booking logic once against the `ConnectAdapter` interface, then swap suppliers by changing one line. Currently ships with **Sabre GDS** (Bargain Finder Max v5 + Booking Management v1) and **TripPro/Mondee** adapters, with the same pattern ready for any supplier you need to add.

---

## Quickstart

```bash
# Clone and install
git clone https://github.com/telivity-otaip/otaip.git
cd otaip
pnpm install

# Set env vars (copy .env.example to .env and fill in)
cp .env.example .env

# Run the Sabre demo (requires SABRE_CLIENT_ID, SABRE_CLIENT_SECRET, ANTHROPIC_API_KEY)
pnpm --filter @otaip/demo book:sabre

# Run tests
pnpm --filter @otaip/connect test
```

---

## Using the Sabre adapter

### 1. Create the adapter

Prefer `createAdapter` — it wraps money-path mutations (ledger, idempotency, kill switch). Raw `new SabreAdapter(...)` is for unit tests only and is refused for unsafe mutations in live mode.

```typescript
import { createAdapter } from '@otaip/connect';

const adapter = createAdapter('sabre', {
  environment: 'cert',           // 'cert' for sandbox, 'prod' for production
  clientId: process.env.SABRE_CLIENT_ID,
  clientSecret: process.env.SABRE_CLIENT_SECRET,
  pcc: 'AB12',                   // optional — pseudo city code
  defaultCurrency: 'USD',        // optional, defaults to 'USD'
});
```

Auth is automatic — the adapter handles OAuth2 token fetch, caching, and refresh internally.

### 2. Search flights

```typescript
const offers = await adapter.searchFlights({
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2026-05-15',
  returnDate: '2026-05-22',      // omit for one-way
  passengers: { adults: 1, children: 1, childAges: [8] },
  cabinClass: 'business',        // 'economy' | 'premium_economy' | 'business' | 'first'
  directOnly: false,
  preferredAirlines: ['BA', 'AA'],
  currency: 'GBP',
});

for (const offer of offers) {
  console.log(`${offer.offerId}: ${offer.totalPrice.amount} ${offer.totalPrice.currency}`);
  console.log(`  Carrier: ${offer.validatingCarrier}, Refundable: ${offer.refundable}`);
  for (const leg of offer.segments) {
    for (const seg of leg) {
      console.log(`  ${seg.marketingCarrier}${seg.flightNumber} ${seg.origin}->${seg.destination} ${seg.departure}`);
    }
  }
}
```

### 3. Price an offer

Always price before booking — offers expire.

```typescript
const priced = await adapter.priceItinerary(offers[0].offerId, {
  adults: 1,
  children: 1,
  childAges: [8],
});

if (!priced.available) {
  console.log('Offer no longer available');
} else if (priced.priceChanged) {
  console.log(`Price changed to ${priced.totalPrice.amount} ${priced.totalPrice.currency}`);
} else {
  console.log(`Confirmed: ${priced.totalPrice.amount} ${priced.totalPrice.currency}`);
}
```

### 4. Create a booking

Bookings are created as HOLD (no credit card required). You ticket separately.

```typescript
const booking = await adapter.createBooking({
  offerId: offers[0].offerId,
  passengers: [
    {
      type: 'adult',
      gender: 'M',
      title: 'Mr',
      firstName: 'John',
      lastName: 'Smith',
      dateOfBirth: '1985-06-15',
      passportNumber: 'GB123456789',
      passportExpiry: '2030-01-01',
      passportCountry: 'GB',
      nationality: 'GB',
    },
    {
      type: 'child',
      gender: 'F',
      firstName: 'Emma',
      lastName: 'Smith',
      dateOfBirth: '2018-03-20',
      passportNumber: 'GB987654321',
      passportExpiry: '2030-01-01',
      passportCountry: 'GB',
      nationality: 'GB',
    },
  ],
  contact: {
    email: 'john.smith@example.com',
    phone: '+442080160509',
  },
});

console.log(`PNR: ${booking.pnr}`);
console.log(`Status: ${booking.status}`);          // 'held'
console.log(`Total: ${booking.totalPrice.amount} ${booking.totalPrice.currency}`);
console.log(`Payment deadline: ${booking.paymentDeadline}`);
```

### 5. Check booking status

```typescript
const status = await adapter.getBookingStatus(booking.bookingId);
console.log(`Status: ${status.status}`);
console.log(`Tickets: ${status.ticketNumbers?.join(', ') ?? 'none'}`);
```

### 6. Request ticketing

```typescript
const ticketed = await adapter.requestTicketing!(booking.bookingId);
console.log(`Status: ${ticketed.status}`);          // 'ticketed'
console.log(`Tickets: ${ticketed.ticketNumbers?.join(', ')}`);
```

### 7. Cancel a booking

```typescript
const result = await adapter.cancelBooking!(booking.bookingId);
console.log(`Cancelled: ${result.success}, ${result.message}`);
```

### 8. Health check

```typescript
const health = await adapter.healthCheck();
console.log(`Healthy: ${health.healthy}, Latency: ${health.latencyMs}ms`);
```

---

## Using the TripPro adapter

Same interface, different config.

```typescript
import { createAdapter } from '@otaip/connect';

const adapter = createAdapter('trippro', {
  soapBaseUrl: 'https://your-trippro-endpoint.com',
  accessToken: process.env.TRIPPRO_ACCESS_TOKEN,
  searchAccessToken: process.env.TRIPPRO_SEARCH_ACCESS_TOKEN,
  whitelistedIp: process.env.TRIPPRO_WHITELISTED_IP,
  defaultCurrency: 'USD',
  // Optional — defaults are provided:
  // searchUrl: 'http://mas.trippro.com/resources/v2/Flights/search',
  // calendarSearchUrl: 'http://mas.trippro.com/resources/v3/calendarsearch',
  // repriceUrl: 'https://map.trippro.com/resources/api/v3/repriceitinerary',
  // bookUrl: 'https://map.trippro.com/resources/v2/Flights/bookItinerary',
});

// Same API as Sabre — searchFlights, priceItinerary, createBooking, etc.
const offers = await adapter.searchFlights({
  origin: 'JFK',
  destination: 'LAX',
  departureDate: '2026-05-15',
  passengers: { adults: 2 },
  cabinClass: 'economy',
});
```

---

## Using the supplier registry

You can also create adapters dynamically by supplier ID:

```typescript
import { createAdapter, listSuppliers } from '@otaip/connect';

console.log(listSuppliers()); // includes tripppro, sabre, navitaire, amadeus, haip

const adapter = createAdapter('sabre', {
  environment: 'cert',
  clientId: process.env.SABRE_CLIENT_ID,
  clientSecret: process.env.SABRE_CLIENT_SECRET,
});

const offers = await adapter.searchFlights({ /* ... */ });
```

---

## Adding your own supplier adapter

### Step 1: Create the directory

```
packages/connect/src/suppliers/yoursupplier/
  index.ts        — adapter class
  config.ts       — zod config schema
  types.ts        — raw API types
  mapper.ts       — your API types <-> ConnectAdapter types
  __tests__/
    yoursupplier.test.ts
```

### Step 2: Define your config (`config.ts`)

```typescript
import { z } from 'zod';
import { validateConfig } from '../../config.js';

export interface YourConfig {
  apiKey: string;
  baseUrl: string;
  defaultCurrency: string;
}

export const yourConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.url(),
  defaultCurrency: z.string().length(3).default('USD'),
});

export function validateYourConfig(config: unknown): YourConfig {
  return validateConfig(yourConfigSchema, config, 'YourSupplier');
}
```

### Step 3: Define raw API types (`types.ts`)

Type the raw request/response shapes from the supplier's API docs. No transformations here — just the wire format.

### Step 4: Write mappers (`mapper.ts`)

Map between your raw types and the ConnectAdapter types. Use `decimal.js` for all money:

```typescript
import Decimal from 'decimal.js';
import type { FlightOffer, MoneyAmount } from '../../types.js';

function toMoney(amount: number | string, currency: string): MoneyAmount {
  return { amount: new Decimal(amount).toString(), currency };
}

export function mapSearchResponse(raw: YourSearchResponse): FlightOffer[] {
  // Transform raw API response -> FlightOffer[]
}
```

### Step 5: Implement the adapter (`index.ts`)

```typescript
import { BaseAdapter, ConnectError } from '../../base-adapter.js';
import type { ConnectAdapter, SearchFlightsInput, FlightOffer } from '../../types.js';
import { validateYourConfig } from './config.js';

export class YourAdapter extends BaseAdapter implements ConnectAdapter {
  readonly supplierId = 'yoursupplier';
  readonly supplierName = 'Your Supplier';

  constructor(config: unknown) {
    super();
    this.config = validateYourConfig(config);
  }

  async searchFlights(input: SearchFlightsInput): Promise<FlightOffer[]> {
    return this.withRetry('searchFlights', async () => {
      // Call your API, map response
    });
  }

  // Implement: priceItinerary, createBooking, getBookingStatus, healthCheck
  // Optional: requestTicketing, cancelBooking
}
```

`BaseAdapter` gives you `withRetry()` (exponential backoff), `fetchWithTimeout()`, and `wrapError()` for free.

### Step 6: Register the adapter

In `packages/connect/src/suppliers/index.ts`:

```typescript
import { YourAdapter } from './yoursupplier/index.js';
registerSupplier('yoursupplier', (config) => new YourAdapter(config));
```

In `packages/connect/src/index.ts`:

```typescript
export { YourAdapter } from './suppliers/yoursupplier/index.js';
export type { YourConfig } from './suppliers/yoursupplier/config.js';
```

### Step 7: Write tests

See `packages/connect/src/suppliers/sabre/__tests__/sabre.test.ts` for the pattern. Test:

- Config validation (valid, missing fields, defaults)
- Mappers (request building, response parsing, edge cases)
- Money precision with decimal.js
- Adapter integration (correct URLs, auth headers, error handling, retries)

### Step 8: Verify

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm --filter @otaip/connect test
```

---

## Environment variables

| Variable | Required for | Description |
|----------|-------------|-------------|
| `SABRE_CLIENT_ID` | Sabre | OAuth2 client ID from Sabre Dev Studio |
| `SABRE_CLIENT_SECRET` | Sabre | OAuth2 client secret |
| `SABRE_ENVIRONMENT` | Sabre | `cert` (sandbox) or `prod` |
| `SABRE_PCC` | Sabre (optional) | Pseudo city code |
| `TRIPPRO_ACCESS_TOKEN` | TripPro | API access token |
| `TRIPPRO_SEARCH_ACCESS_TOKEN` | TripPro | Search-specific access token |
| `TRIPPRO_WHITELISTED_IP` | TripPro | Whitelisted IP for API access |
| `ANTHROPIC_API_KEY` | Demo scripts | Anthropic API key for Claude agent loop |
| `HAIP_BASE_URL` | HAIP | Base URL of the HAIP PMS instance (e.g., `http://localhost:3000`) |
| `HAIP_API_KEY` | HAIP (optional) | API key — empty for HAIP v1.0.0, will be OAuth token later |

---

## Using the HAIP adapter (Hotel PMS)

The HAIP adapter connects to a HAIP PMS instance via its Connect API. Unlike the flight adapters above, HAIP is a **hotel** adapter supporting the full booking lifecycle: search, book, modify, cancel, and verify.

```typescript
import { HaipAdapter } from '@otaip/connect';

const adapter = createAdapter('haip', {
  baseUrl: process.env.HAIP_BASE_URL ?? 'http://localhost:3000',
  apiKey: process.env.HAIP_API_KEY ?? '',  // No auth in HAIP v1.0.0
  timeoutMs: 10_000,
  maxRetries: 2,
  baseDelayMs: 1_000,
});

// Search
const results = await adapter.searchHotels({
  destination: 'New York',
  checkIn: '2026-04-07',
  checkOut: '2026-04-09',
  rooms: 1,
  adults: 2,
});

// Book (HAIP auto-confirms — no polling needed)
const booking = await adapter.createBooking({
  propertyId: results[0].source.sourcePropertyId,
  roomTypeId: results[0].rates[0].roomTypeId,
  rateId: results[0].rates[0].rateId,
  checkIn: '2026-04-07',
  checkOut: '2026-04-09',
  rooms: 1,
  guest: { firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
  externalConfirmationCode: 'OTAIP-REF-001',
});
// booking.status === 'confirmed' (auto-confirm)
// booking.confirmation.crsConfirmation === HAIP PMS confirmation number
// booking.confirmation.channelConfirmation === 'OTAIP-REF-001'

// Verify CRS ↔ PMS sync
const status = await adapter.getBookingStatus(booking.confirmation.crsConfirmation);
// status.syncStatus === 'IN_SYNC' | 'MISMATCH'

// Modify
const modified = await adapter.modifyBooking(booking.confirmation.crsConfirmation, {
  checkOut: '2026-04-10',
});

// Cancel
const cancelled = await adapter.cancelBooking(booking.confirmation.crsConfirmation);
```

HAIP is registered as `createAdapter('haip', config)` (self-guarded money path). It can be passed to Agent 20.1 (Hotel Search Aggregator) as a `HotelSourceAdapter` since it implements `searchHotels()` and `isAvailable()`.

---

## ConnectAdapter interface

All adapters implement this interface from [`packages/connect/src/types.ts`](src/types.ts):

```typescript
interface ConnectAdapter {
  readonly supplierId: string;
  readonly supplierName: string;

  searchFlights(input: SearchFlightsInput): Promise<FlightOffer[]>;
  priceItinerary(offerId: string, passengers: PassengerCount): Promise<PricedItinerary>;
  createBooking(input: CreateBookingInput): Promise<BookingResult>;
  getBookingStatus(bookingId: string): Promise<BookingStatusResult>;
  requestTicketing?(bookingId: string): Promise<BookingStatusResult>;
  cancelBooking?(bookingId: string): Promise<{ success: boolean; message: string }>;
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;
}
```

Money amounts are always `{ amount: string, currency: string }` — never floating point. Implementations use `decimal.js` internally.
