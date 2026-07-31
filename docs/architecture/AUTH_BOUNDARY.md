# Authentication & Authorization Boundary

## Design Principle

OTAIP is a library, not a SaaS platform. Authentication and authorization live in the consuming application, not in OTAIP.

## What OTAIP handles

- **Adapter credentials**: API keys, OAuth tokens, and session credentials for distribution adapters are injected via constructor config. OTAIP never stores or manages credentials itself.
- **PII handling**: The Audit Agent (9.4) supports PII redaction for compliance, but this is data processing, not access control.

## What OTAIP does NOT handle

- User authentication (JWT, sessions, OAuth flows)
- Role-based access control
- API key management or rotation
- Rate limiting per user/tenant (adapter `RateLimiter` is per-adapter-instance, not per-user)
- Multi-tenant isolation / RBAC enforcement

## Recommended patterns for consuming applications

### Single-tenant (e.g., a TMC backend)
```
Your API Server → auth middleware → OTAIP agents → distribution adapters
```
Your server handles auth. OTAIP agents are called as library functions.

### Multi-tenant (e.g., a SaaS travel platform)
```
Your API Server → auth + tenant middleware → per-tenant adapter config → OTAIP agents
```
Each tenant gets their own adapter instances with their own credentials. Pure agents are stateless, but **stateful** components (offer store, order management, pay-confirm, effect ledger) must use tenant-scoped keys or per-tenant store instances — do not share a single in-memory store across tenants.

### Credential injection
```typescript
// Credentials come from your config/secret store, not from OTAIP
const adapter = new DuffelAdapter({
  apiKey: process.env.DUFFEL_API_KEY!,
});
```

## AuthMiddleware interface

OTAIP provides a minimal `AuthMiddleware` interface so consuming apps have a consistent contract for injecting auth into agent workflows:

```typescript
import type { AuthContext, AuthMiddleware } from '@otaip/core';

// AuthContext carries the authenticated user's identity
interface AuthContext {
  userId: string;
  tenantId?: string;
  roles: string[];
  permissions: string[];
  metadata?: Record<string, unknown>;
}

// AuthMiddleware — implement this in your app
interface AuthMiddleware {
  authenticate(request: unknown): Promise<AuthContext>;
}
```

### Express example

```typescript
import type { AuthMiddleware, AuthContext } from '@otaip/core';

class JwtAuthMiddleware implements AuthMiddleware {
  async authenticate(request: unknown): Promise<AuthContext> {
    const req = request as { headers: { authorization?: string } };
    const token = req.headers.authorization?.replace('Bearer ', '');
    // Your JWT verification logic here
    return { userId: '...', roles: ['agent'], permissions: ['search', 'book'] };
  }
}
```

### Fastify example

```typescript
import type { AuthMiddleware, AuthContext } from '@otaip/core';

class FastifyAuthMiddleware implements AuthMiddleware {
  async authenticate(request: unknown): Promise<AuthContext> {
    const req = request as { headers: Record<string, string | undefined> };
    const apiKey = req.headers['x-api-key'];
    // Your API key verification logic here
    return { userId: '...', tenantId: '...', roles: ['agent'], permissions: ['search'] };
  }
}
```

## Environment variables

See `.env.example` for the list of credentials OTAIP adapters accept. These are injected by the consuming application.
