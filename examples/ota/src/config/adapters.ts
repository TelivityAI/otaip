/**
 * Adapter configuration — selects DuffelOtaAdapter or MockOtaAdapter
 * based on environment variables.
 *
 * - When `DUFFEL_API_KEY` is set, search/price/book run against the live
 *   Duffel sandbox via `DuffelOtaAdapter`. Payment + ticketing remain mock
 *   (in-memory) since they are out of scope for the reference OTA.
 * - Otherwise, `MockOtaAdapter` serves the entire flow with realistic test
 *   data and an in-memory booking store.
 *
 * `DUFFEL_API_TOKEN` is accepted as a deprecated alias for `DUFFEL_API_KEY`
 * to keep older `.env` files working.
 */

import type { DistributionAdapter } from '@otaip/core';
import { MockDuffelAdapter } from '@otaip/adapter-duffel';
import type { BookingLifecycle, OtaAdapter } from '../types.js';
import { MockOtaAdapter } from '../mock-ota-adapter.js';
import { DuffelOtaAdapter } from '../duffel-ota-adapter.js';

const PLACEHOLDER_VALUES = new Set([
  '',
  'duffel_test_your_token_here',
  'duffel_test_your_key_here',
]);

function resolveDuffelApiKey(): string | undefined {
  const key = process.env['DUFFEL_API_KEY']?.trim();
  if (key && !PLACEHOLDER_VALUES.has(key)) {
    return key;
  }
  const legacy = process.env['DUFFEL_API_TOKEN']?.trim();
  if (legacy && !PLACEHOLDER_VALUES.has(legacy)) {
    console.warn(
      'DUFFEL_API_TOKEN is deprecated; rename it to DUFFEL_API_KEY in your .env file.',
    );
    process.env['DUFFEL_API_KEY'] = legacy;
    return legacy;
  }
  return undefined;
}

/**
 * Create the OTA adapter based on environment configuration.
 */
export function createAdapter(): OtaAdapter & BookingLifecycle {
  const apiKey = resolveDuffelApiKey();
  if (apiKey) {
    console.log('DUFFEL_API_KEY detected — using live Duffel sandbox for search/price/book.');
    return new DuffelOtaAdapter();
  }
  return new MockOtaAdapter();
}

/**
 * Create a multi-adapter map for parallel search.
 *
 * Reads the `ADAPTERS` env var (comma-separated list of adapter names).
 * Supported names: 'mock', 'duffel-mock', 'duffel'.
 * Default: single 'mock' adapter (backward compatible).
 *
 * Returns a Map<string, DistributionAdapter> suitable for MultiSearchService.
 */
export function createMultiAdapter(): Map<string, DistributionAdapter> {
  const adaptersEnv = process.env['ADAPTERS'];
  const adapterNames = adaptersEnv
    ? adaptersEnv.split(',').map((s) => s.trim()).filter(Boolean)
    : ['mock'];

  const adapters = new Map<string, DistributionAdapter>();

  for (const name of adapterNames) {
    switch (name) {
      case 'mock':
        adapters.set('mock', new MockOtaAdapter());
        break;
      case 'duffel-mock':
        adapters.set('duffel-mock', new MockDuffelAdapter());
        break;
      case 'duffel': {
        const apiKey = resolveDuffelApiKey();
        if (!apiKey) {
          console.warn(
            "Adapter 'duffel' requested but DUFFEL_API_KEY is not set. Skipping.",
          );
          break;
        }
        adapters.set('duffel', new DuffelOtaAdapter());
        break;
      }
      default:
        console.warn(`Unknown adapter name: '${name}'. Skipping.`);
    }
  }

  // Fallback: always have at least one adapter
  if (adapters.size === 0) {
    adapters.set('mock', new MockOtaAdapter());
  }

  return adapters;
}
