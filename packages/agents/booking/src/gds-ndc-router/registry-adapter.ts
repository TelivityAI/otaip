/**
 * Registry Adapter — bridges carrier-channels.json to CapabilityRegistry.
 *
 * Reads the existing JSON data and registers equivalent `ChannelCapability`
 * entries. This is the migration bridge between the legacy lookup-table
 * router and the new registry-driven scoring. Used in tests and as the
 * default constructor path when `useRegistry: true`.
 *
 * Data mapping:
 *   - Each carrier's `channels` list → one or more ChannelCapability entries
 *   - `channel_priority[0]` → higher reliability/cost scores on that channel
 *   - `ndc_version` → `supportsNdcLevel` (21.3→4, 18.1→3, 17.2→2)
 *   - `gds_preference` → set on the matching GDS channel via `carrier_restrictions`
 *   - DIRECT-only carriers → channelType 'lcc' with supportedCarriers for that carrier
 */

import type { ChannelCapability } from '@otaip/core';
// JSON imported directly so esbuild inlines it into dist/index.js — using
// createRequire on the bundled output would fail with MODULE_NOT_FOUND when
// this package is consumed as a built dep.
import carrierChannelsJson from './data/carrier-channels.json';

interface CarrierChannelConfig {
  name: string;
  channels: string[];
  channel_priority: string[];
  ndc_version: string | null;
  gds_preference: string | null;
  ndc_capable: boolean;
  ndc_provider_id: string | null;
}

interface CarrierData {
  carriers: Record<string, CarrierChannelConfig>;
  codeshare_rules: { default_strategy: string; fallback_strategy: string };
}

const carrierData = carrierChannelsJson as unknown as CarrierData;

function ndcVersionToLevel(version: string | null): 1 | 2 | 3 | 4 | undefined {
  if (!version) return undefined;
  switch (version) {
    case '21.3': return 4;
    case '18.1': return 3;
    case '17.2': return 2;
    default: return 1;
  }
}

/**
 * Build a map of per-carrier virtual channel capabilities from the
 * carrier-channels.json data.
 *
 * Strategy: for each carrier, create a virtual channel entry that
 * encodes the carrier's preferred routing. The existing global adapter
 * channels (amadeus, sabre, duffel) handle the broad "can search/price/
 * book" capabilities. These per-carrier entries encode "for carrier X,
 * the preferred channel is Y with these specifics."
 *
 * Returns an array of ChannelCapability entries ready to register.
 */
export function buildCarrierCapabilities(): ChannelCapability[] {
  const capabilities: ChannelCapability[] = [];

  for (const [iata, config] of Object.entries(carrierData.carriers)) {
    const primaryChannel = config.channel_priority[0] ?? 'GDS';

    if (primaryChannel === 'DIRECT') {
      capabilities.push({
        channelId: `direct-${iata.toLowerCase()}`,
        channelType: 'lcc',
        supportedCarriers: [iata],
        supportedFunctions: ['search', 'price', 'book_held'],
        reliabilityScore: 0.85,
        latencyScore: 0.8,
        costScore: 0.7,
        updatedAt: '2026-04-16',
      });
      continue;
    }

    if (config.ndc_capable && config.channels.includes('NDC')) {
      const isPrimary = primaryChannel === 'NDC';
      capabilities.push({
        channelId: `ndc-${iata.toLowerCase()}`,
        channelType: 'ndc',
        supportedCarriers: [iata],
        supportedFunctions: ['search', 'price', 'book_held', 'ticket'],
        supportsNdcLevel: ndcVersionToLevel(config.ndc_version),
        reliabilityScore: isPrimary ? 0.9 : 0.75,
        latencyScore: 0.78,
        costScore: isPrimary ? 0.8 : 0.6,
        updatedAt: '2026-04-16',
      });
    }

    if (config.channels.includes('GDS')) {
      const isPrimary = primaryChannel === 'GDS';
      capabilities.push({
        channelId: `gds-${iata.toLowerCase()}`,
        channelType: 'gds',
        supportedCarriers: [iata],
        supportedFunctions: ['search', 'price', 'book_held', 'ticket', 'refund', 'exchange', 'ssr', 'seat_map'],
        reliabilityScore: isPrimary ? 0.92 : 0.8,
        latencyScore: 0.7,
        costScore: isPrimary ? 0.7 : 0.5,
        updatedAt: '2026-04-16',
      });
    }
  }

  return capabilities;
}

/**
 * Retrieve the raw carrier-channels data. Exposed for tests that need
 * to verify the adapter's output against the source data.
 */
export function getCarrierData(): CarrierData {
  return carrierData;
}
