/**
 * Unit tests for multi-search error sanitization (QA fix-forward candidate).
 */

import { describe, it, expect } from 'vitest';
import type { DistributionAdapter, SearchRequest, SearchResponse } from '@otaip/core';
import { MultiSearchService } from '../services/multi-search-service.js';

function failingAdapter(name: string, message: string): DistributionAdapter {
  return {
    name,
    async isAvailable() {
      return true;
    },
    async search(_req: SearchRequest): Promise<SearchResponse> {
      throw new Error(message);
    },
  };
}

describe('MultiSearchService — error sanitization', () => {
  it('redacts credential hints from per-adapter error metadata', async () => {
    const service = new MultiSearchService({
      adapters: new Map([
        [
          'leaky',
          failingAdapter('leaky', 'Adapter failed with key hint: sk_live_secret123'),
        ],
      ]),
    });

    const result = await service.search({
      segments: [{ origin: 'JFK', destination: 'LAX', departure_date: '2026-07-15' }],
      passengers: [{ type: 'ADT', count: 1 }],
      cabin_class: 'economy',
      currency: 'USD',
    });

    expect(result.sources[0]?.error).not.toContain('sk_live_secret123');
    expect(result.sources[0]?.error).toContain('[redacted]');
  });
});
