# HAIP PMS Connect Adapter

> Hotel channel adapter connecting to the HAIP (Hotel Availability Interactive Protocol) PMS Connect API for hotel search, booking, modification, and cancellation.

## Capabilities

| Operation | Supported | Notes |
|-----------|-----------|-------|
| Search Hotels | &#10003; | Multi-property availability search |
| Get Property | &#10003; | Single property detail retrieval |
| Check Rate | &#10003; | Rate verification before booking |
| Availability Check | &#10003; | Quick boolean availability test |
| Book | &#10003; | Reservation creation with guest details |
| Get Booking Status | &#10003; | Booking verification and status retrieval |
| Modify Booking | &#10003; | Date/guest/special request changes |
| Cancel Booking | &#10003; | Cancellation with penalty information |
| Health Check | &#10003; | Connectivity and latency measurement |

**Channel capability manifest:**

```typescript
{
  channelId: 'haip',
  channelType: 'aggregator',
  supportedCarriers: [],      // hotel channel -- no airline carriers
  supportedFunctions: ['search', 'price', 'book_held'],
  reliabilityScore: 0.85,
  latencyScore: 0.7,
  costScore: 0.55,
}
```

## Authentication

**No authentication in HAIP v1.0.0.** The Bearer header is included but empty for forward-compatibility when HAIP ships OAuth 2.0/OIDC in a future version.

The `apiKey` config field defaults to an empty string. When HAIP adds auth, set this to your OAuth token.

## Configuration

```typescript
interface HaipConfig {
  baseUrl: string;       // required -- base URL of the HAIP instance
  apiKey: string;        // default: '' (no auth in v1.0.0)
  timeoutMs: number;     // default: 10,000 (10 seconds)
  maxRetries: number;    // default: 2
  baseDelayMs: number;   // default: 1,000 (exponential backoff base)
}
```

Validated at construction time with Zod. Trailing slashes on `baseUrl` are stripped automatically.

## Usage

```typescript
import { createAdapter } from '@otaip/connect';

const adapter = createAdapter('haip', {
  baseUrl: 'http://localhost:3000',
  apiKey: '',
  timeoutMs: 10000,
});

// Search hotels
const results = await adapter.searchHotels({
  destination: 'NYC',
  checkIn: '2026-06-15',
  checkOut: '2026-06-18',
  rooms: 1,
  adults: 2,
});

// Get property details
const property = await adapter.getPropertyDetails('prop-123');

// Check rate
const rate = await adapter.checkRate('prop-123', 'room-standard');

// Book
const booking = await adapter.createBooking({
  propertyId: 'prop-123',
  roomTypeId: 'room-standard',
  rateId: 'rate-bar',
  checkIn: '2026-06-15',
  checkOut: '2026-06-18',
  rooms: 1,
  guest: {
    firstName: 'John',
    lastName: 'Test',
    email: 'john@example.com',
    phone: '+12125551234',
  },
});

// Check booking status
const status = await adapter.getBookingStatus(booking.confirmationCode);

// Modify
const modified = await adapter.modifyBooking(
  booking.confirmationCode,
  { specialRequests: 'Late checkout requested' },
);

// Cancel
const cancelled = await adapter.cancelBooking(booking.confirmationCode);

// Health check
const health = await adapter.healthCheck();
```

## Internal Details

- **Stateless**: Each API call is independent. No session management required.
- **Auto-confirm**: HAIP confirms bookings immediately (no polling or async confirmation).
- **Three confirmation codes**: The booking flow produces a PMS confirmation code and an external reference. The adapter maps these to OTAIP's booking result format.
- **API paths**: All endpoints are under `/api/v1/connect/` (search, properties, bookings, health).
- **Mapper**: `mapper.ts` converts HAIP response types to OTAIP hotel types (`HaipHotelResult`, `HaipBookingResult`, `HaipVerificationResult`, `HaipModificationResult`, `HaipCancellationResult`).
- **BaseAdapter**: Inherits retry with exponential backoff and timeout from `BaseAdapter`.

## Tests

58 tests across three test files:
- `haip-adapter.test.ts` -- 21 tests covering all adapter methods (search, book, cancel, modify, health)
- `haip-config.test.ts` -- 8 tests for configuration validation and defaults
- `haip-mapper.test.ts` -- 29 tests for response mapping (search results, booking responses, cancellation responses, rate extraction)

All tests use mocked HTTP responses.

## Known Limitations

- **No auth in v1.0.0**: The HAIP API does not enforce authentication. The adapter includes the Bearer header structure for forward-compatibility.
- **Hotel only**: This is a hotel PMS adapter. It does not handle flights. The GdsNdcRouter naturally excludes it based on `channelType`.
- **Local/dev target**: The default `baseUrl` expects a local HAIP instance. Production HAIP deployments would use a real URL.
- **No group bookings**: The adapter handles individual reservations. Group booking flows are not implemented.
- **No loyalty integration**: Guest loyalty numbers are accepted but not validated against any loyalty program.

## Source Files

```
packages/connect/src/suppliers/haip/
  index.ts         -- HaipAdapter class
  config.ts        -- Zod-validated configuration
  capabilities.ts  -- Channel capability manifest
  mapper.ts        -- HAIP <-> OTAIP type mapping
  types.ts         -- HAIP API request/response types
  __tests__/
    haip-adapter.test.ts
    haip-config.test.ts
    haip-mapper.test.ts
```
