# Amadeus Self-Service Adapter

> Full-service GDS adapter mapping Amadeus Self-Service APIs to the ConnectAdapter interface.

## Capabilities

| Operation | Supported | Notes |
|-----------|-----------|-------|
| Search | &#10003; | Flight Offers Search v2 |
| Price | &#10003; | Flight Offers Price v1 |
| Book | &#10003; | Flight Orders v1 (create) |
| Get Booking | &#10003; | Flight Orders v1 (retrieve) |
| Cancel | &#10003; | Flight Orders v1 (delete) |
| Ticket | -- | Not available in Self-Service tier |
| Health Check | &#10003; | Connectivity test |

**Channel capability manifest:**

```typescript
{
  channelId: 'amadeus',
  channelType: 'gds',
  supportedCarriers: ['*'],
  supportedFunctions: ['search', 'price', 'book_held', 'ticket', 'refund', 'exchange', 'ssr', 'seat_map'],
  reliabilityScore: 0.92,
  latencyScore: 0.7,
  costScore: 0.5,
}
```

## Authentication

**OAuth2 `client_credentials` flow**, managed by the official Amadeus Node.js SDK.

1. Provide `clientId` and `clientSecret` from the Amadeus for Developers portal
2. The SDK handles token acquisition and refresh automatically
3. Test environment uses `test.api.amadeus.com`; production uses `api.amadeus.com`

No manual token management required.

## Configuration

```typescript
interface AmadeusConfig {
  environment: 'test' | 'production';  // default: 'test'
  clientId: string;                     // required
  clientSecret: string;                 // required
  defaultCurrency: string;              // default: 'USD'
}
```

Validated at construction time with Zod. Invalid config throws immediately.

## Usage

```typescript
import { createAdapter } from '@otaip/connect';

const adapter = createAdapter('amadeus', {
  environment: 'test',
  clientId: process.env.AMADEUS_CLIENT_ID,
  clientSecret: process.env.AMADEUS_CLIENT_SECRET,
  defaultCurrency: 'USD',
});

// Search flights
const offers = await adapter.searchFlights({
  origin: 'LHR',
  destination: 'CDG',
  departureDate: '2026-06-15',
  passengers: { adults: 1 },
});

// Price a specific offer
const priced = await adapter.priceItinerary(offers[0].offerId, { adults: 1 });

// Book
const booking = await adapter.createBooking({
  offerId: offers[0].offerId,
  passengers: [{ firstName: 'John', lastName: 'Test', dateOfBirth: '1985-01-01' }],
  contact: { email: 'john@example.com', phone: '+441234567890' },
});

// Retrieve booking status
const status = await adapter.getBookingStatus(booking.bookingId);

// Cancel
const result = await adapter.cancelBooking(booking.bookingId);
```

## Internal Details

- **Search offer cache**: Search results are cached for 15 minutes (keyed by Amadeus offer ID) so that `priceItinerary` can pass the raw offer to the pricing endpoint
- **Priced offer cache**: Priced offers are cached similarly, since Amadeus `createBooking` requires the full flight offer object
- **Mapper**: `mapper.ts` handles bidirectional mapping between Amadeus API types and OTAIP `FlightOffer`/`PricedItinerary`/`BookingResult` types
- **BaseAdapter**: Extends `BaseAdapter` for automatic retry with exponential backoff and timeout handling

## Tests

83 tests in `packages/connect/src/suppliers/amadeus/__tests__/amadeus.test.ts`.

All tests use mocked HTTP responses -- no live API calls. Coverage includes:
- Search request mapping and response parsing
- Price verification flow
- Booking creation with passenger data
- Booking retrieval and cancellation
- Cache management (TTL expiry, eviction)
- Error handling (API errors, network failures, invalid config)

## Known Limitations

- **Self-Service tier only**: The adapter uses the Amadeus Self-Service APIs, not the enterprise-grade Amadeus Web Services (SOAP). Self-Service lacks ticketing, exchange, refund, and SSR management.
- **No `fulfillTickets`**: Ticketing is declared in the capability manifest (for full GDS capability), but the Self-Service API does not expose ticketing endpoints.
- **Offer caching required**: Amadeus pricing and booking require the full offer object from search, so the adapter maintains an in-memory cache. Cache is per-instance and not shared across processes.
- **No SOAP fallback**: For carriers that require Amadeus Cryptic/SOAP commands, a separate adapter would be needed.

## Source Files

```
packages/connect/src/suppliers/amadeus/
  index.ts         -- AmadeusAdapter class
  config.ts        -- Zod-validated configuration
  capabilities.ts  -- Channel capability manifest
  mapper.ts        -- Amadeus <-> OTAIP type mapping
  types.ts         -- Amadeus API response types
  amadeus.d.ts     -- Type declarations for amadeus SDK
  __tests__/
    amadeus.test.ts
```
