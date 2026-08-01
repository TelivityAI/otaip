# Sabre GDS Adapter

> Full-service GDS adapter mapping Sabre REST APIs (Bargain Finder Max + Booking Management) to the ConnectAdapter interface.

## Capabilities

| Operation | Supported | Notes |
|-----------|-----------|-------|
| Search | &#10003; | Bargain Finder Max v5 |
| Price | &#10003; | Bargain Finder Max v5 (reprice) |
| Book | &#10003; | Booking Management API v1 |
| Get Booking | &#10003; | Booking Management API v1 |
| Cancel | &#10003; | Booking Management API v1 |
| Request Ticketing | &#10003; | Booking Management API v1 |
| Health Check | &#10003; | Connectivity test |

**Channel capability manifest:**

```typescript
{
  channelId: 'sabre',
  channelType: 'gds',
  supportedCarriers: ['*'],
  supportedFunctions: ['search', 'price', 'book_held', 'ticket', 'refund', 'exchange', 'ssr', 'seat_map'],
  reliabilityScore: 0.9,
  latencyScore: 0.72,
  costScore: 0.55,
}
```

## Authentication

**OAuth2 `client_credentials`** with stateless ATK (Application Token) tokens.

1. Provide `clientId` and `clientSecret` from the Sabre Dev Studio portal
2. `SabreAuth` class manages token acquisition and caching
3. Cert environment: `api.cert.platform.sabre.com`
4. Prod environment: `api.platform.sabre.com`

All endpoints use POST with JSON bodies. The auth token is sent as a Bearer header.

## Configuration

```typescript
interface SabreConfig {
  environment: 'cert' | 'prod';   // default: 'cert'
  clientId: string;                 // required
  clientSecret: string;             // required
  pcc?: string;                     // optional Pseudo City Code
  defaultCurrency: string;          // default: 'USD'
}
```

Validated at construction time with Zod.

## Usage

```typescript
import { createAdapter } from '@otaip/connect';

const adapter = createAdapter('sabre', {
  environment: 'cert',
  clientId: process.env.SABRE_CLIENT_ID,
  clientSecret: process.env.SABRE_CLIENT_SECRET,
  pcc: 'A1B2',
  defaultCurrency: 'USD',
});

// Search flights
const offers = await adapter.searchFlights({
  origin: 'JFK',
  destination: 'LAX',
  departureDate: '2026-06-15',
  passengers: { adults: 2 },
});

// Price
const priced = await adapter.priceItinerary(offers[0].offerId, { adults: 2 });

// Book
const booking = await adapter.createBooking({
  offerId: offers[0].offerId,
  passengers: [
    { firstName: 'Jane', lastName: 'Test', dateOfBirth: '1990-03-20' },
    { firstName: 'John', lastName: 'Test', dateOfBirth: '1988-11-05' },
  ],
  contact: { email: 'jane@example.com', phone: '+12125551234' },
});

// Request ticketing
const ticketed = await adapter.requestTicketing(booking.bookingId);

// Cancel
await adapter.cancelBooking(booking.bookingId);
```

## Internal Details

- **`SabreAuth`**: Manages OAuth2 token lifecycle with automatic refresh
- **Mapper**: `mapper.ts` handles bidirectional mapping for BFM search requests/responses, booking creation, cancellation, and ticketing fulfillment
- **BaseAdapter**: Inherits retry and timeout from `BaseAdapter`
- All Sabre API calls are POST requests with JSON bodies

## Tests

101 tests in `packages/connect/src/suppliers/sabre/__tests__/`.

All tests use mocked HTTP. Coverage includes:
- BFM search request construction and response parsing
- Price verification
- Booking lifecycle (create, retrieve, cancel, ticketing)
- Auth token management
- Error mapping (Sabre error codes to ConnectError)
- Config validation

## Known Limitations

- **REST APIs only**: Uses Sabre's REST JSON APIs, not the legacy SOAP/XML Sabre Web Services
- **No refund/exchange**: While the capability manifest declares full GDS functions, the adapter currently implements search, price, book, ticket, and cancel
- **PCC optional**: Some operations may require a PCC depending on the agency configuration
- **No queue management**: Sabre queue operations are not implemented in this adapter

## Source Files

```
packages/connect/src/suppliers/sabre/
  index.ts         -- SabreAdapter class
  auth.ts          -- SabreAuth (OAuth2 token manager)
  config.ts        -- Zod-validated configuration
  capabilities.ts  -- Channel capability manifest
  mapper.ts        -- Sabre <-> OTAIP type mapping
  types.ts         -- Sabre API response types
  __tests__/
```
