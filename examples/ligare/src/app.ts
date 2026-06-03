/**
 * Fastify app for Ligare: serves the Telivity landing page and the ChatGPT
 * Action endpoints that the published GPT calls. The HTTP paths match the
 * generated OpenAPI spec exactly (POST /flights/search, /flights/price,
 * /bookings, GET /bookings/:id, /health).
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type {
  CreateBookingInput,
  PassengerCount,
  SearchFlightsInput,
} from '@otaip/connect';
import { DuffelConnectAdapter } from './duffel-connect-adapter.js';
import { buildOpenApiSpec } from './openapi.js';
import { recordLead } from './leads.js';

const here = dirname(fileURLToPath(import.meta.url));

export function createAdapter(): DuffelConnectAdapter {
  return new DuffelConnectAdapter();
}

export function buildServer(adapter: DuffelConnectAdapter): FastifyInstance {
  const app = Fastify({ logger: false });

  // --- ChatGPT Action endpoints (must match the OpenAPI paths) ---
  app.get('/openapi.json', async () => buildOpenApiSpec(adapter));
  app.get('/health', async () => adapter.healthCheck());

  app.post('/flights/search', async (req) =>
    adapter.searchFlights(req.body as SearchFlightsInput),
  );

  app.post('/flights/price', async (req) => {
    const { offerId, passengers } = req.body as {
      offerId: string;
      passengers: PassengerCount;
    };
    return adapter.priceItinerary(offerId, passengers);
  });

  app.post('/bookings', async (req) =>
    adapter.createBooking(req.body as CreateBookingInput),
  );

  app.get('/bookings/:id', async (req) =>
    adapter.getBookingStatus((req.params as { id: string }).id),
  );

  // --- Landing-page support ---
  app.post('/leads', async (req, reply) => {
    const { email, note } = (req.body ?? {}) as { email?: string; note?: string };
    if (!email || email.trim().length === 0) {
      reply.code(400);
      return { ok: false, error: 'email required' };
    }
    await recordLead(email.trim(), note);
    return { ok: true };
  });

  // "Try Live Demo" button → redirect to the published GPT (or home if unset).
  app.get('/go', async (_req, reply) => {
    const url = process.env['GPT_URL'];
    return reply.redirect(url && url.trim().length > 0 ? url : '/');
  });

  // Static landing page (serves public/index.html at '/').
  app.register(fastifyStatic, { root: join(here, '..', 'public') });

  return app;
}
