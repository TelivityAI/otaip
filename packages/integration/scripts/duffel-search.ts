/**
 * Live Duffel sandbox proof for @otaip/integration.
 *
 * Runs Agent 1.1 (AvailabilitySearch) against the real Duffel sandbox through
 * OTAIP's six gates, writes a durable trace, then re-reads that trace by id
 * from a *fresh* store instance to prove the read-back path.
 *
 * Requires DUFFEL_API_KEY (a duffel_test_… sandbox key) in the environment.
 * The key is read by the adapter only; it is never printed, logged, or traced.
 *
 * Run:
 *   set -a; source examples/ligare/.env; set +a   # or export DUFFEL_API_KEY=duffel_test_...
 *   pnpm --filter @otaip/integration proof:duffel-search
 */

import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { runAvailabilitySearch, getRunTrace, FileEventStore } from '../src/index.js';

function isoDatePlusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const key = process.env['DUFFEL_API_KEY'];
  if (!key) {
    console.error('DUFFEL_API_KEY is not set. Export a duffel_test_… key and re-run.');
    process.exit(2);
  }
  // Never print the key — only its environment kind, derived from the prefix.
  const kind = key.startsWith('duffel_test_')
    ? 'sandbox'
    : key.startsWith('duffel_live_')
      ? 'LIVE'
      : 'unknown';
  if (kind === 'LIVE') {
    console.error('Refusing to run the proof against a LIVE Duffel key.');
    process.exit(2);
  }

  const departure = isoDatePlusDays(30);
  const tracePath = join(process.cwd(), 'traces', `duffel-jfk-lhr-${departure}.jsonl`);
  await rm(tracePath, { force: true });
  const store = await FileEventStore.open(tracePath);

  console.log('='.repeat(72));
  console.log('OTAIP × Duffel — live sandbox availability search (Agent 1.1, through gates)');
  console.log('='.repeat(72));
  console.log(`Credential:   DUFFEL_API_KEY present (${kind})`);
  console.log(`Route:        JFK → LHR on ${departure}, 1 ADT, economy, GBP`);
  console.log(`Trace file:   ${tracePath}`);
  console.log('');

  const res = await runAvailabilitySearch(
    {
      origin: 'JFK',
      destination: 'LHR',
      departure_date: departure,
      passengers: [{ type: 'ADT', count: 1 }],
      cabin_class: 'economy',
      currency: 'GBP',
      max_results: 3,
      sort_by: 'price',
    },
    { eventStore: store },
  );

  console.log(`Gate outcome: ${res.ok ? 'PASS (all gates)' : `REJECTED → ${res.failure?.reason}`}`);
  if (!res.ok) {
    console.log('Issues:', JSON.stringify(res.failure?.issues, null, 2));
    process.exit(1);
  }

  const out = res.output!;
  console.log(`Session id:   ${res.sessionId}`);
  console.log(`Raw offers:   ${out.total_raw_offers}   |   returned: ${out.offers.length}`);
  console.log('');
  console.log('--- Real Duffel sandbox offers (normalized to the unified output model) ---');
  for (const [i, offer] of out.offers.entries()) {
    const seg0 = offer.itinerary.segments[0]!;
    const segN = offer.itinerary.segments[offer.itinerary.segments.length - 1]!;
    console.log(
      `  ${i + 1}. ${offer.offer_id}  ${seg0.carrier}${seg0.flight_number}  ` +
        `${seg0.origin}→${segN.destination}  ` +
        `dep ${seg0.departure_time}  ` +
        `${offer.price.total} ${offer.price.currency}  ` +
        `(${offer.itinerary.connection_count} stop(s), ${offer.itinerary.total_duration_minutes}m)`,
    );
  }
  console.log('');
  console.log('--- Per-source status (real adapter call) ---');
  console.log(JSON.stringify(out.source_status, null, 2));

  // Prove read-back by id from a FRESH store opened on the same durable file.
  const reopened = await FileEventStore.open(tracePath);
  const trace = await getRunTrace(reopened, res.sessionId);
  console.log('');
  console.log('--- Trace read back by session id (fresh FileEventStore on the same file) ---');
  console.log(JSON.stringify(trace, null, 2));
}

main().catch((err: unknown) => {
  console.error('Proof failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
