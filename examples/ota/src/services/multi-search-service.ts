/**
 * Multi-adapter Search Service — queries multiple distribution adapters
 * in parallel and aggregates results with source attribution.
 *
 * Sprint H: enables the OTA to fan-out search requests to Duffel, mock
 * adapters, or any DistributionAdapter simultaneously. Each result is
 * tagged with its source adapter for provenance tracking.
 *
 * Design:
 *   - Uses Promise.allSettled — a failing adapter does not block others.
 *   - Per-adapter timeout prevents slow adapters from holding up results.
 *   - Results are merged and sorted by price (lowest first).
 *   - Source metadata reports success/failure/timing per adapter.
 */

import type {
  DistributionAdapter,
  SearchRequest,
  SearchOffer,
} from '@otaip/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MultiSearchConfig {
  /** Map of adapter name to adapter instance. */
  readonly adapters: Map<string, DistributionAdapter>;
  /** Per-adapter timeout in milliseconds. Default: 10000. */
  readonly timeoutMs?: number;
}

export interface SourceStatus {
  readonly adapter: string;
  readonly success: boolean;
  readonly offerCount: number;
  readonly durationMs: number;
  readonly error?: string;
}

export interface AggregatedSearchResult {
  readonly offers: ReadonlyArray<SearchOffer & { readonly adapterSource: string }>;
  readonly totalFound: number;
  readonly sources: readonly SourceStatus[];
}

/** Strip credential-like substrings from adapter errors before exposing to clients. */
function sanitizeAdapterError(message: string): string {
  return message
    .replace(/(?:api[_-]?key|secret|token|Bearer)\s*[:=]?\s*\S+/gi, '[redacted]')
    .replace(/\b(sk|pk)_(live|test)_[A-Za-z0-9]+\b/g, '[redacted]')
    .replace(/key hint:\s*\S+/gi, 'key hint: [redacted]');
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Adapter '${label}' timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// MultiSearchService
// ---------------------------------------------------------------------------

export class MultiSearchService {
  private readonly config: MultiSearchConfig;

  constructor(config: MultiSearchConfig) {
    this.config = config;
  }

  async search(request: SearchRequest): Promise<AggregatedSearchResult> {
    const timeoutMs = this.config.timeoutMs ?? 10_000;
    const entries = [...this.config.adapters.entries()];

    // Fan-out: search all adapters in parallel
    const settled = await Promise.allSettled(
      entries.map(async ([name, adapter]) => {
        const start = Date.now();
        const response = await withTimeout(
          adapter.search(request),
          timeoutMs,
          name,
        );
        const durationMs = Date.now() - start;
        return { name, offers: response.offers, durationMs };
      }),
    );

    // Aggregate results
    const allOffers: Array<SearchOffer & { adapterSource: string }> = [];
    const sources: SourceStatus[] = [];

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i]!;
      const adapterName = entries[i]![0];

      if (result.status === 'fulfilled') {
        const { offers, durationMs } = result.value;
        for (const offer of offers) {
          allOffers.push({ ...offer, adapterSource: adapterName });
        }
        sources.push({
          adapter: adapterName,
          success: true,
          offerCount: offers.length,
          durationMs,
        });
      } else {
        const errorMessage = sanitizeAdapterError(
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        );
        sources.push({
          adapter: adapterName,
          success: false,
          offerCount: 0,
          durationMs: 0,
          error: errorMessage,
        });
      }
    }

    // Sort by price (lowest total first)
    allOffers.sort((a, b) => a.price.total - b.price.total);

    return {
      offers: allOffers,
      totalFound: allOffers.length,
      sources,
    };
  }
}
