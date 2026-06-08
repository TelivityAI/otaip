/**
 * Fastify app for Ligare: serves the Telivity landing page and the ChatGPT
 * Action endpoints that the published GPT calls. The HTTP paths match the
 * generated OpenAPI spec exactly (POST /flights/search, /flights/price,
 * /bookings, GET /bookings/:id, /health).
 *
 * Every tool call is logged (PII-scrubbed) via ./events for analytics + training.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import type {
  CreateBookingInput,
  PassengerCount,
  SearchFlightsInput,
} from '@otaip/connect';
import { DuffelConnectAdapter } from './duffel-connect-adapter.js';
import { buildOpenApiSpec } from './openapi.js';
import { recordLead } from './leads.js';
import { logToolCall, scrubBooking, type ToolName } from './events.js';

const here = dirname(fileURLToPath(import.meta.url));

export function createAdapter(): DuffelConnectAdapter {
  return new DuffelConnectAdapter();
}

/** Best-effort per-user grouping: ChatGPT sends this header to Actions. */
function sessionId(req: FastifyRequest): string | undefined {
  const h = req.headers['openai-ephemeral-user-id'];
  return typeof h === 'string' ? h : undefined;
}

/** Run a tool call, capturing the structured request + outcome summary. */
async function tracked<T>(
  req: FastifyRequest,
  tool: ToolName,
  request: Record<string, unknown>,
  run: () => Promise<T>,
  summarize: (result: T) => Record<string, unknown>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await run();
    await logToolCall({
      tool,
      sessionId: sessionId(req),
      request,
      response: summarize(result),
      status: 'ok',
      latencyMs: Date.now() - started,
    });
    return result;
  } catch (err) {
    await logToolCall({
      tool,
      sessionId: sessionId(req),
      request,
      response: {},
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    });
    throw err;
  }
}

export function buildServer(adapter: DuffelConnectAdapter): FastifyInstance {
  const app = Fastify({ logger: false });

  // --- ChatGPT Action endpoints (must match the OpenAPI paths) ---
  app.get('/openapi.json', async () => buildOpenApiSpec(adapter));
  app.get('/health', async () => adapter.healthCheck());

  app.post('/flights/search', async (req) => {
    const body = req.body as SearchFlightsInput;
    return tracked(
      req,
      'searchFlights',
      {
        origin: body.origin,
        destination: body.destination,
        departureDate: body.departureDate,
        returnDate: body.returnDate,
        cabinClass: body.cabinClass,
        passengers: body.passengers,
        directOnly: body.directOnly,
        currency: body.currency,
      },
      () => adapter.searchFlights(body),
      // Capture the full structured result set (no PII) for training data.
      (offers) => ({ resultCount: offers.length, offers }),
    );
  });

  app.post('/flights/price', async (req) => {
    const { offerId, passengers } = req.body as {
      offerId: string;
      passengers: PassengerCount;
    };
    return tracked(
      req,
      'priceItinerary',
      { offerId, passengers },
      () => adapter.priceItinerary(offerId, passengers),
      (priced) => ({ ...priced }),
    );
  });

  app.post('/bookings', async (req) => {
    const body = req.body as CreateBookingInput;
    return tracked(
      req,
      'createBooking',
      scrubBooking(body),
      () => adapter.createBooking(body),
      (result) => ({
        bookingId: result.bookingId,
        status: result.status,
        total: result.totalPrice,
      }),
    );
  });

  app.get('/bookings/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    return tracked(
      req,
      'getBookingStatus',
      { bookingId: id },
      () => adapter.getBookingStatus(id),
      (status) => ({ bookingId: status.bookingId, status: status.status, pnr: status.pnr }),
    );
  });

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
