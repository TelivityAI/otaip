/**
 * Single-command developer demo: `pnpm ligare`
 *
 * Shows, in ~10 seconds, how OTAIP turns a raw supplier adapter into live
 * ChatGPT-ready tools and a running API:
 *   1. Wrap Duffel as a ConnectAdapter
 *   2. Generate the ChatGPT/MCP tools from it
 *   3. Run a live Duffel Test search
 *   4. Serve the OpenAPI spec a GPT can import
 */

import 'dotenv/config';
import { generateMcpTools } from '@otaip/connect';
import { buildServer, createAdapter } from './app.js';
import { buildOpenApiSpec, publicBaseUrl } from './openapi.js';

const PORT = Number(process.env['PORT'] ?? 3000);

function plusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function hasDuffelKey(): boolean {
  const key = process.env['DUFFEL_API_KEY']?.trim();
  return !!key && key !== 'duffel_test_your_key_here';
}

async function main(): Promise<void> {
  console.log('\n  Ligare — connect travel inventory to ChatGPT  (OTAIP demo)\n');
  console.log('  Sandbox: Duffel Test. Flights and bookings are simulated, not real.\n');

  // Step 1 — wrap the supplier
  const adapter = createAdapter();
  console.log(`  1. Wrapped Duffel as a ConnectAdapter  (supplierId="${adapter.supplierId}")`);

  // Step 2 — generate AI tools from the adapter
  const tools = generateMcpTools(adapter);
  const spec = buildOpenApiSpec(adapter);
  const operationIds = Object.values(spec['paths'] as Record<string, Record<string, { operationId?: string }>>)
    .flatMap((methods) => Object.values(methods).map((op) => op.operationId))
    .filter((id): id is string => Boolean(id));
  console.log(`  2. Generated ${tools.length} ChatGPT/MCP tools from the adapter:`);
  console.log(`       MCP tools:        ${tools.map((t) => t.name).join(', ')}`);
  console.log(`       OpenAPI ops:      ${operationIds.join(', ')}`);

  // Step 3 — live search
  if (!hasDuffelKey()) {
    console.log('\n  3. Live search skipped — set DUFFEL_API_KEY (Duffel Test) in your .env to see real offers.\n');
  } else {
    const departureDate = plusDays(14);
    console.log(`\n  3. Live Duffel Test search: ORD → LHR on ${departureDate} (1 adult, economy)...`);
    try {
      const offers = await adapter.searchFlights({
        origin: 'ORD',
        destination: 'LHR',
        departureDate,
        passengers: { adults: 1 },
        cabinClass: 'economy',
      });
      console.log(`     → ${offers.length} offers. Top 3:`);
      for (const offer of offers.slice(0, 3)) {
        const price = `${offer.totalPrice.amount} ${offer.totalPrice.currency}`;
        console.log(`       ${offer.validatingCarrier.padEnd(3)}  ${price.padStart(12)}  (offer ${offer.offerId.slice(0, 12)}…)`);
      }
    } catch (err) {
      console.log(`     → search failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Step 4 — serve it for ChatGPT
  const app = buildServer(adapter);
  await app.listen({ port: PORT, host: '0.0.0.0' });
  const base = publicBaseUrl().includes('localhost') ? `http://localhost:${PORT}` : `http://localhost:${PORT}`;
  console.log('\n  4. Your inventory is now ChatGPT-ready. Server is live:\n');
  console.log(`       Landing page:   ${base}/`);
  console.log(`       OpenAPI spec:   ${base}/openapi.json   ← import this into a ChatGPT Custom GPT Action`);
  console.log('\n     Try it:');
  console.log(`       curl -s -X POST ${base}/flights/search \\`);
  console.log(`         -H 'content-type: application/json' \\`);
  console.log(`         -d '{"origin":"ORD","destination":"LHR","departureDate":"${plusDays(14)}","passengers":{"adults":1},"cabinClass":"economy"}'`);
  console.log('\n  Ctrl+C to stop.\n');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
