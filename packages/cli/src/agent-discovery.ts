/**
 * Re-export the canonical agent-discovery helper from `@otaip/core`.
 *
 * The implementation lives in `@otaip/core` so both this CLI and the
 * OTA reference server (`examples/ota`) can use the same logic without
 * duplicating it. Kept as a re-export here so existing imports
 * (`../agent-discovery.js`) keep working.
 */

export { discoverAgents } from '@otaip/core';
export type { DiscoveredAgent } from '@otaip/core';
