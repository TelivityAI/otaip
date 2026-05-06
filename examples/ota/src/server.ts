/**
 * OTAIP Reference OTA — Fastify server.
 *
 * A reference flight booking application that proves OTAIP works end to end.
 * Sprint E: search + offer details.
 * Sprint F: booking, payment, ticketing, and management.
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import Stripe from 'stripe';
import type { DistributionAdapter } from '@otaip/core';
import { createAdapter, createMultiAdapter } from './config/adapters.js';
import type { BookingLifecycle, OtaAdapter } from './types.js';
import { MockOtaAdapter } from './mock-ota-adapter.js';
import { SqliteStore } from './persistence/sqlite-store.js';
import type { StripeLike } from './services/payment-service.js';
import { SearchService } from './services/search-service.js';
import { MultiSearchService } from './services/multi-search-service.js';
import { OfferService } from './services/offer-service.js';
import { BookingService } from './services/booking-service.js';
import { PaymentService } from './services/payment-service.js';
import { TicketingService } from './services/ticketing-service.js';
import { ManageService } from './services/manage-service.js';
import { PlatformService } from './services/platform-service.js';
import { PlaygroundService } from './services/playground-service.js';
import { registerSearchRoute } from './routes/search.js';
import { registerOffersRoute } from './routes/offers.js';
import { registerHealthRoute } from './routes/health.js';
import { registerBookRoute } from './routes/book.js';
import { registerPayRoute } from './routes/pay.js';
import { registerTicketRoute } from './routes/ticket.js';
import { registerManageRoutes } from './routes/manage.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { registerPlaygroundRoutes } from './routes/playground.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Extract the subset of multi-search adapters that also implement
 * `book()` — only those can fulfill a post-search booking.
 *
 * Exported for unit testing; also used internally by buildApp() to derive
 * the booking registry from the multi-search adapter set.
 */
export function filterBookingAdapters(
  adapters: Map<string, DistributionAdapter>,
): Map<string, OtaAdapter> {
  const bookable = new Map<string, OtaAdapter>();
  for (const [name, adapter] of adapters) {
    if (typeof (adapter as Partial<OtaAdapter>).book === 'function') {
      bookable.set(name, adapter as OtaAdapter);
    }
  }
  return bookable;
}

// ---------------------------------------------------------------------------
// App factory (exported for testing)
// ---------------------------------------------------------------------------

export interface BuildAppOptions {
  /** Override the adapter (useful for testing with MockOtaAdapter). */
  adapter?: OtaAdapter & BookingLifecycle;
  /**
   * Optional SqliteStore for durable persistence. If not provided and
   * `DATABASE_PATH` env var is set, one is constructed automatically.
   * Ignored when the caller also passes `adapter` — the injected adapter
   * is expected to carry its own store.
   */
  store?: SqliteStore;
  /**
   * Optional Stripe client (or Stripe-compatible mock) for payments.
   * When absent and `STRIPE_SECRET_KEY` env var is set, a real Stripe
   * instance is constructed. When both are absent, PaymentService runs
   * in mock mode (payments always succeed with `pay_mock_*` IDs).
   */
  stripe?: StripeLike;
  /** Whether to initialize the airport resolver. Defaults to true. */
  initResolver?: boolean;
  /**
   * Security plugin overrides — set any field to `false` to skip that
   * plugin entirely. Defaults to enabling all three with sensible
   * production settings. `rateLimit.max` defaults to 100 req/min.
   */
  security?: {
    helmet?: boolean;
    cors?: { origin: string | string[] | false } | false;
    rateLimit?: { max?: number; timeWindow?: string | number } | false;
  };
  /**
   * Override the multi-search service (useful for testing).
   * If not provided, one is constructed from `createMultiAdapter()` iff the
   * `ADAPTERS` env var is set. When neither is present, the ?multi=true
   * branch stays unreachable and single-adapter search is used exclusively.
   */
  multiSearch?: MultiSearchService;
  /**
   * Per-source booking adapters. When a multi-search offer is booked, the
   * registry maps its `adapterSource` to the adapter that should handle
   * booking. Adapters that do not implement `book()` are omitted so that
   * bookings against their offers fail with a clear 409 rather than being
   * silently routed to an unrelated adapter.
   */
  bookingAdapters?: Map<string, OtaAdapter>;
}

export async function buildApp(options: BuildAppOptions = {}) {
  // Persistence: caller-supplied store wins, otherwise derive from env.
  // When neither is set, the MockOtaAdapter falls back to its in-memory Map.
  const store =
    options.store ??
    (process.env['DATABASE_PATH']
      ? new SqliteStore(process.env['DATABASE_PATH'])
      : undefined);

  const adapter =
    options.adapter ??
    (store ? new MockOtaAdapter({ store }) : createAdapter());

  // Stripe client: caller wins, otherwise construct from env when key is set.
  const stripe: StripeLike | undefined =
    options.stripe ??
    (process.env['STRIPE_SECRET_KEY']
      ? new Stripe(process.env['STRIPE_SECRET_KEY'])
      : undefined);
  const multiAdapters = options.multiSearch ? undefined : process.env['ADAPTERS']
    ? createMultiAdapter()
    : undefined;
  const multiSearch =
    options.multiSearch ??
    (multiAdapters ? new MultiSearchService({ adapters: multiAdapters }) : undefined);
  // Booking registry: only adapters that implement `book()` qualify. When
  // the user injects `bookingAdapters` we trust them; otherwise we derive
  // the registry from the same adapter set the multi-search fans out to.
  const bookingAdapters: Map<string, OtaAdapter> =
    options.bookingAdapters ??
    (multiAdapters ? filterBookingAdapters(multiAdapters) : new Map());

  const app = Fastify({
    logger: true,
    // AJV config:
    // - allErrors: collect every validation failure, not just the first
    // - removeAdditional: false — we want `additionalProperties: false`
    //   schemas to REJECT unknown keys, not silently strip them (Fastify's
    //   default is to strip, which defeats input-sanitization intent).
    ajv: {
      customOptions: { allErrors: true, removeAdditional: false },
    },
    // Preserve the pre-existing error envelope for schema-failed requests
    // so tests and clients that expect `{ error: 'Validation failed',
    // details: [...] }` keep working after input schemas were added.
    schemaErrorFormatter: (errors) => {
      const err = new Error('Validation failed') as Error & {
        statusCode?: number;
        validation?: unknown;
      };
      err.statusCode = 400;
      err.validation = errors;
      return err;
    },
  });

  // Convert thrown schema-validation errors into the expected
  // `{ error: 'Validation failed', details: [...] }` envelope.
  // Other errors (rate-limit, etc.) retain their original status code
  // and body — reply.send(error) preserves `statusCode` from the error.
  app.setErrorHandler((error, _request, reply) => {
    const validation = (error as { validation?: Array<{ message?: string; instancePath?: string }> }).validation;
    if (validation) {
      const details = validation.map(
        (v) => `${v.instancePath ?? ''} ${v.message ?? ''}`.trim(),
      );
      return reply.status(400).send({ error: 'Validation failed', details });
    }
    const e = error as { statusCode?: number; status?: number; code?: string };
    // Fastify error objects use statusCode; some plugins use .status; default 500.
    const status = e.statusCode ?? e.status ?? 500;
    return reply.status(status).send(error);
  });

  // --- Security plugins (register before routes) ---
  const sec = options.security ?? {};

  // Helmet — defense-in-depth HTTP headers.
  if (sec.helmet !== false) {
    await app.register(fastifyHelmet, {
      // `contentSecurityPolicy: false` lets the plain-HTML frontend load
      // its bundled Pico CSS from the same origin without wrestling CSP.
      // Tighten this for production deployments.
      contentSecurityPolicy: false,
    });
  }

  // CORS — opt-in. Config from CORS_ORIGIN env var (comma-separated).
  // Default: no cross-origin allowed.
  if (sec.cors !== false) {
    const envOrigin = process.env['CORS_ORIGIN'];
    const corsOrigin =
      sec.cors !== undefined
        ? sec.cors.origin
        : envOrigin
          ? envOrigin.split(',').map((s) => s.trim()).filter(Boolean)
          : false;
    await app.register(fastifyCors, { origin: corsOrigin });
  }

  // Rate limiting — global default 100 req/min/IP; per-route overrides
  // (book: 20/min, pay: 10/min) are set on the route declarations.
  if (sec.rateLimit !== false) {
    await app.register(fastifyRateLimit, {
      max: sec.rateLimit?.max ?? 100,
      timeWindow: sec.rateLimit?.timeWindow ?? '1 minute',
    });
  }

  // Serve static frontend files
  await app.register(fastifyStatic, {
    root: join(__dirname, '..', 'public'),
    prefix: '/',
  });

  // Build services
  const searchService = new SearchService(adapter);
  const offerService = new OfferService(searchService);
  const bookingService = new BookingService(adapter, searchService, bookingAdapters);
  const paymentService = new PaymentService(adapter, {
    ...(stripe ? { stripe } : {}),
    ...(store ? { store } : {}),
  });
  const ticketingService = new TicketingService(adapter);
  const manageService = new ManageService(adapter);
  const platformService = new PlatformService();
  const playgroundService = new PlaygroundService(adapter, searchService);

  // Optionally initialize airport code resolver
  if (options.initResolver !== false) {
    await searchService.initializeResolver();
  }

  // Track every request so the dashboard health endpoint has honest
  // last-request data. Hook returns void; never blocks.
  app.addHook('onRequest', async () => {
    platformService.recordRequest();
  });

  // Register routes — Sprint E
  registerSearchRoute(app, searchService, multiSearch);
  registerOffersRoute(app, offerService);
  registerHealthRoute(app, adapter);

  // Register routes — Sprint F
  registerBookRoute(app, bookingService, paymentService);
  registerPayRoute(app, paymentService);
  registerTicketRoute(app, ticketingService);
  registerManageRoutes(app, manageService);

  // Platform UI surface — read-only telemetry + interactive playground
  registerPlatformRoutes(app, platformService);
  registerPlaygroundRoutes(app, playgroundService);

  return app;
}

// ---------------------------------------------------------------------------
// Start server (only when run directly, not imported)
// ---------------------------------------------------------------------------

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));

if (isMainModule) {
  const port = Number(process.env['PORT'] ?? 3000);

  const app = await buildApp();

  try {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`\n  OTAIP Reference OTA running at http://localhost:${port}\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
