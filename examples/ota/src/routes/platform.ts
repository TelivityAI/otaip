/**
 * GET /api/platform/* — read-only telemetry for the Platform UI dashboard.
 *
 * Routes are registered with a high per-route rate limit (5 000/min) so
 * dashboard polling cannot trip the global default 100/min cap.
 */

import type { FastifyInstance } from 'fastify';
import type { PlatformService } from '../services/platform-service.js';

const HIGH_RATE_LIMIT = { max: 5_000, timeWindow: '1 minute' };

export function registerPlatformRoutes(
  app: FastifyInstance,
  platform: PlatformService,
): void {
  app.get('/api/platform/agents', { config: { rateLimit: HIGH_RATE_LIMIT } }, async (_req, reply) => {
    return reply.send(platform.agents());
  });

  app.get('/api/platform/agent-graph', { config: { rateLimit: HIGH_RATE_LIMIT } }, async (_req, reply) => {
    const graph = platform.agentGraph();
    if (!graph) {
      return reply.status(404).send({
        error: 'agent_graph_missing',
        hint: 'Run `pnpm gen:manifest` to generate agents.graph.json.',
      });
    }
    return reply.send(graph);
  });

  app.get('/api/platform/adapters', { config: { rateLimit: HIGH_RATE_LIMIT } }, async (_req, reply) => {
    return reply.send({ adapters: platform.adapters() });
  });

  app.get('/api/platform/health', { config: { rateLimit: HIGH_RATE_LIMIT } }, async (_req, reply) => {
    return reply.send(platform.health());
  });

  app.get('/api/platform/stats', { config: { rateLimit: HIGH_RATE_LIMIT } }, async (_req, reply) => {
    return reply.send(platform.stats());
  });
}
