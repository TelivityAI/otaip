/**
 * @otaip/integration — the caller-facing seam.
 *
 * Run a contracted agent against a live distribution adapter through OTAIP's
 * six gates, and read the run's execution + gate trace back by id.
 *
 * See INTEGRATION.md at the repo root for the full contract.
 */

export { runAvailabilitySearch } from './run-search.js';
export type { RunSearchOptions, RunSearchResult, RunSearchFailure } from './run-search.js';

export { getRunTrace } from './trace.js';
export type { RunTrace, AgentExecutionTrace, AdapterHealthTrace } from './trace.js';

export { FileEventStore } from './file-event-store.js';
