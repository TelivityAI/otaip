# Navitaire (New Skies / dotREZ) Adapter

> LCC direct-connect adapter with session-stateful booking flow, mapping the Navitaire Digital API v4.7 to the ConnectAdapter interface.

## Capabilities

| Operation | Supported | Notes |
|-----------|-----------|-------|
| Search | &#10003; | Stateless availability query |
| Price | &#10003; | Stateful -- requires session |
| Book | &#10003; | Multi-step stateful flow (sell, passengers, payment, commit) |
| Get Booking | &#10003; | Retrieve by record locator |
| Cancel | &#10003; | Stateful cancel flow |
| Request Ticketing | &#10003; | E-ticket issuance via stateful session |
| Health Check | &#10003; | Connectivity test |

**Channel capability manifest:**

```typescript
{
  channelId: 'navitaire',
  channelType: 'lcc',
  supportedCarriers: ['*'],
  supportedFunctions: ['search', 'price', 'book_held', 'ssr', 'seat_map'],
  reliabilityScore: 0.88,
  latencyScore: 0.8,
  costScore: 0.7,
}
```

## Authentication

**JWT with auto-refresh**, managed by `NavitaireAuth`.

1. Provide domain, username, and password credentials
2. The auth module acquires a JWT token and refreshes automatically before expiry
3. All API calls include the JWT as a Bearer token

## Session Management

**This is the critical difference from Sabre/Amadeus.** Navitaire is session-stateful. Booking operations build up server-side state through a multi-step flow, then commit.

The `NavitaireSessionManager` handles:
- Session creation and token management
- `withSession()` for read-only operations (search, retrieve)
- `withStatefulFlow()` for multi-step booking flows (sell -> add passengers -> add payment -> commit)
- Locked sequential operations to prevent interleaving
- Configurable session timeout (default: 20 minutes)

The adapter presents a clean **stateless interface** to consumers via `ConnectAdapter`, hiding the session complexity.

## Configuration

```typescript
interface NavitaireConfig {
  environment: 'test' | 'production';  // default: 'test'
  baseUrl: string;                      // required (e.g., 'https://dotrezapi.test.1n.navitaire.com')
  credentials: {
    domain: string;                     // required
    username: string;                   // required
    password: string;                   // required
  };
  defaultCurrencyCode: string;          // default: 'USD'
  sessionTimeoutMs: number;             // default: 1,200,000 (20 minutes)
}
```

Validated at construction time with Zod.

## Usage

```typescript
import { createAdapter } from '@otaip/connect';

const adapter = createAdapter('navitaire', {
  environment: 'test',
  baseUrl: 'https://dotrezapi.test.1n.navitaire.com',
  credentials: {
    domain: 'MY_DOMAIN',
    username: process.env.NAV_USERNAME,
    password: process.env.NAV_PASSWORD,
  },
  defaultCurrencyCode: 'USD',
});

// Search (stateless)
const offers = await adapter.searchFlights({
  origin: 'MCO',
  destination: 'LAS',
  departureDate: '2026-06-15',
  passengers: { adults: 1 },
});

// Book (internally: sell -> passengers -> payment -> commit)
const booking = await adapter.createBooking({
  offerId: offers[0].offerId,
  passengers: [{ firstName: 'John', lastName: 'Test', dateOfBirth: '1985-01-01' }],
  contact: { email: 'john@example.com', phone: '+14075551234' },
});

// Issue ticket
const ticketed = await adapter.requestTicketing(booking.bookingId);
```

## Internal Details

- **Multi-step booking**: `createBooking` internally executes: trip sell -> add passengers -> add primary contact -> add payment -> commit booking. All within a single locked session.
- **Error mapping**: `mapNavitaireErrorCode()` converts Navitaire-specific error codes to `ConnectError` instances
- **Mapper**: Handles Navitaire-specific structures (availability responses, booking data, e-ticket responses)

## Tests

109 tests in `packages/connect/src/suppliers/navitaire/__tests__/`.

All tests use mocked HTTP. Coverage includes:
- Availability search (stateless)
- Full booking flow (multi-step session)
- Session management (creation, refresh, timeout)
- Ticketing and e-ticket validation
- Cancellation flow
- Error handling and Navitaire error code mapping
- Config validation

## Known Limitations

- **LCC platform only**: Used by low-cost carriers (Southwest, Wizz Air, Spirit, Allegiant, Frontier). Not suitable for full-service GDS operations.
- **No traditional exchange/refund**: LCCs handle changes differently from ATPCO-based carriers. No Cat 31/33 support.
- **Session contention**: Only one stateful flow can run per adapter instance at a time due to session locking. For concurrent bookings, use multiple adapter instances.
- **No GDS/NDC routing**: Navitaire is direct-connect only. The GdsNdcRouter naturally excludes it from GDS routing decisions based on `channelType: 'lcc'`.

## Source Files

```
packages/connect/src/suppliers/navitaire/
  index.ts         -- NavitaireAdapter class
  auth.ts          -- NavitaireAuth (JWT token manager)
  session.ts       -- NavitaireSessionManager (stateful flow management)
  config.ts        -- Zod-validated configuration
  capabilities.ts  -- Channel capability manifest
  mapper.ts        -- Navitaire <-> OTAIP type mapping
  types.ts         -- Navitaire API response types
  specs/           -- API spec references
  __tests__/
```
