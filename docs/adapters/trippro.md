# TripPro/Mondee Adapter

> Aggregator adapter with dual-host architecture (REST for search, SOAP for post-booking operations), mapping TripPro APIs to the ConnectAdapter interface.

## Capabilities

| Operation | Supported | Notes |
|-----------|-----------|-------|
| Search | &#10003; | REST API at `mas.trippro.com` |
| Price | &#10003; | REST reprice at `map.trippro.com` |
| Book | &#10003; | REST booking at `map.trippro.com` |
| Get Booking | &#10003; | SOAP ReadPNR |
| Cancel | &#10003; | SOAP CancelPNR |
| Request Ticketing | &#10003; | SOAP OrderTicket |
| Health Check | &#10003; | Connectivity test |

**Channel capability manifest:**

```typescript
{
  channelId: 'trippro',
  channelType: 'aggregator',
  supportedCarriers: ['*'],
  supportedFunctions: ['search', 'price'],
  reliabilityScore: 0.85,
  latencyScore: 0.65,
  costScore: 0.6,
}
```

Note: The capability manifest conservatively declares only `search` and `price`. The adapter implements additional operations (book, cancel, ticket) via SOAP.

## Authentication

**Dual token system** -- different credentials for search vs. booking:

- **Search**: `SearchAccessToken` header + `M-IPAddress` header (whitelisted IP)
- **Booking/SOAP**: `AccessToken` for REST endpoints; same token used in SOAP envelope headers

Both tokens are static API keys, not OAuth. No refresh logic required.

## Configuration

```typescript
interface TripProConfig {
  searchUrl: string;              // default: 'http://mas.trippro.com/resources/v2/Flights/search'
  calendarSearchUrl: string;      // default: 'http://mas.trippro.com/resources/v3/calendarsearch'
  repriceUrl: string;             // default: 'https://map.trippro.com/resources/api/v3/repriceitinerary'
  bookUrl: string;                // default: 'https://map.trippro.com/resources/v2/Flights/bookItinerary'
  soapBaseUrl: string;            // required -- base URL for SOAP operations
  accessToken: string;            // required -- booking/SOAP token
  searchAccessToken: string;      // required -- search token
  whitelistedIp: string;          // required -- IP for M-IPAddress header
  defaultCurrency: string;        // default: 'USD'
}
```

Validated at construction time with Zod.

## Usage

```typescript
import { createAdapter } from '@otaip/connect';

const adapter = createAdapter('trippro', {
  soapBaseUrl: 'https://soap.trippro.com',
  accessToken: process.env.TRIPPRO_ACCESS_TOKEN,
  searchAccessToken: process.env.TRIPPRO_SEARCH_TOKEN,
  whitelistedIp: process.env.TRIPPRO_IP,
  defaultCurrency: 'USD',
});

// Search flights (REST)
const offers = await adapter.searchFlights({
  origin: 'JFK',
  destination: 'LHR',
  departureDate: '2026-06-15',
  passengers: { adults: 1 },
});

// Reprice (REST)
const priced = await adapter.priceItinerary(offers[0].offerId, { adults: 1 });

// Book (REST)
const booking = await adapter.createBooking({
  offerId: offers[0].offerId,
  passengers: [{ firstName: 'John', lastName: 'Test', dateOfBirth: '1985-01-01' }],
  contact: { email: 'john@example.com', phone: '+12125551234' },
});

// Retrieve PNR (SOAP)
const status = await adapter.getBookingStatus(booking.bookingId);

// Issue ticket (SOAP)
const ticketed = await adapter.requestTicketing(booking.bookingId);

// Cancel (SOAP -- does not use cancelBooking directly)
await adapter.cancelBooking(booking.bookingId);
```

## Internal Details

- **Dual-host architecture**: Search operations hit `mas.trippro.com` (the aggregator search engine), while booking/reprice operations hit `map.trippro.com` (the booking engine)
- **SOAP client**: `soap-client.ts` provides XML construction helpers (`buildReadPnrBody`, `buildOrderTicketBody`, `buildCancelPnrBody`) and response parsing (`extractXmlValue`, `extractXmlValues`, `hasSoapFault`)
- **No SDK dependency**: All HTTP calls use native fetch. SOAP requests are hand-built XML strings.
- **BaseAdapter**: Inherits retry and timeout from `BaseAdapter`

## Tests

73 tests in `packages/connect/src/suppliers/trippro/__tests__/`.

All tests use mocked HTTP. Coverage includes:
- REST search and reprice
- REST booking creation
- SOAP PNR retrieval, ticketing, and cancellation
- SOAP fault detection and error mapping
- Dual-token auth header construction
- Config validation

## Known Limitations

- **Aggregator layer**: TripPro aggregates GDS and NDC sources. The adapter does not control which upstream source handles a given request.
- **SOAP for post-booking**: While search and booking use modern REST/JSON, PNR retrieval, ticketing, and cancellation use SOAP/XML.
- **IP whitelisting required**: The search API requires a whitelisted IP address sent in the `M-IPAddress` header.
- **No refund/exchange**: Post-ticketing service operations are not implemented.
- **Calendar search URL**: A calendar search endpoint is configured but not currently exposed through the ConnectAdapter interface.

## Source Files

```
packages/connect/src/suppliers/trippro/
  index.ts         -- TripProAdapter class
  config.ts        -- Zod-validated configuration
  capabilities.ts  -- Channel capability manifest
  mapper.ts        -- TripPro <-> OTAIP type mapping
  soap-client.ts   -- SOAP XML helpers (ReadPNR, OrderTicket, CancelPNR)
  types.ts         -- TripPro API response types
  __tests__/
```
