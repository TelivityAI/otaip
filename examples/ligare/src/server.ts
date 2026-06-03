/**
 * Ligare server entry point. Boots the Fastify app that backs the published
 * "Telivity Ligare" GPT and serves the landing page.
 *
 *   pnpm --filter @otaip/example-ligare dev
 */

import 'dotenv/config';
import { buildServer, createAdapter } from './app.js';
import { publicBaseUrl } from './openapi.js';

const PORT = Number(process.env['PORT'] ?? 3000);

const app = buildServer(createAdapter());

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => {
    console.log(`Ligare running on http://localhost:${PORT}`);
    console.log(`OpenAPI (import into ChatGPT): ${publicBaseUrl()}/openapi.json`);
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
