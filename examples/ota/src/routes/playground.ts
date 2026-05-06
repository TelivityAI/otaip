/**
 * /api/playground/* — interactive API explorer routes.
 *
 * Higher per-route rate limit than the global default so a developer can
 * iterate freely. State-mutating operations (book/cancel) are intentionally
 * not exposed here — the playground is for inspection, not production
 * traffic.
 */

import type { FastifyInstance } from 'fastify';
import {
  AgentNotExecutableError,
  type PlaygroundService,
} from '../services/playground-service.js';

const HIGH_RATE_LIMIT = { max: 5_000, timeWindow: '1 minute' };

const SEARCH_BODY_SCHEMA = {
  type: 'object',
  required: ['origin', 'destination', 'date', 'passengers'],
  additionalProperties: false,
  properties: {
    origin: { type: 'string', pattern: '^[A-Za-z]{3}$' },
    destination: { type: 'string', pattern: '^[A-Za-z]{3}$' },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    returnDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    passengers: { type: 'integer', minimum: 1, maximum: 9 },
    cabinClass: { type: 'string', enum: ['economy', 'premium_economy', 'business', 'first'] },
  },
} as const;

const AGENT_BODY_SCHEMA = {
  type: 'object',
  required: ['agent_id', 'input'],
  additionalProperties: false,
  properties: {
    agent_id: { type: 'string', minLength: 1, maxLength: 30 },
    input: {},
  },
} as const;

const ADAPTER_BODY_SCHEMA = {
  type: 'object',
  required: ['operation'],
  additionalProperties: false,
  properties: {
    operation: { type: 'string', enum: ['search', 'price', 'isAvailable'] },
    input: {},
  },
} as const;

interface SearchBody {
  origin: string;
  destination: string;
  date: string;
  returnDate?: string;
  passengers: number;
  cabinClass?: 'economy' | 'premium_economy' | 'business' | 'first';
}

interface AgentBody {
  agent_id: string;
  input: unknown;
}

interface AdapterBody {
  operation: 'search' | 'price' | 'isAvailable';
  input?: unknown;
}

export function registerPlaygroundRoutes(
  app: FastifyInstance,
  playground: PlaygroundService,
): void {
  app.get(
    '/api/playground/catalog',
    { config: { rateLimit: HIGH_RATE_LIMIT } },
    async (_req, reply) => reply.send(playground.catalog()),
  );

  app.post<{ Body: SearchBody }>(
    '/api/playground/search',
    {
      schema: { body: SEARCH_BODY_SCHEMA },
      config: { rateLimit: HIGH_RATE_LIMIT },
    },
    async (req, reply) => {
      try {
        const result = await playground.search(req.body);
        return reply.send(result);
      } catch (err) {
        req.log.error({ err }, 'Playground search failed');
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.status(500).send({ error: 'Search failed', message });
      }
    },
  );

  app.post<{ Body: AgentBody }>(
    '/api/playground/agent',
    {
      schema: { body: AGENT_BODY_SCHEMA },
      config: { rateLimit: HIGH_RATE_LIMIT },
    },
    async (req, reply) => {
      try {
        const result = await playground.runAgent(req.body.agent_id, req.body.input);
        return reply.send(result);
      } catch (err) {
        if (err instanceof AgentNotExecutableError) {
          return reply.status(501).send({
            error: err.message,
            agent_id: err.agent_id,
            hint: 'See `executable_ids` in /api/playground/catalog for the agents this build can run.',
          });
        }
        req.log.error({ err }, 'Playground agent execution failed');
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.status(500).send({ error: 'Agent execution failed', message });
      }
    },
  );

  app.post<{ Body: AdapterBody }>(
    '/api/playground/adapter',
    {
      schema: { body: ADAPTER_BODY_SCHEMA },
      config: { rateLimit: HIGH_RATE_LIMIT },
    },
    async (req, reply) => {
      try {
        const result = await playground.runAdapter({
          operation: req.body.operation,
          input: req.body.input,
        });
        return reply.send(result);
      } catch (err) {
        req.log.error({ err }, 'Playground adapter execution failed');
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.status(500).send({ error: 'Adapter execution failed', message });
      }
    },
  );
}
