/**
 * Hotel & Car Search — Agent 1.7
 *
 * Multi-adapter search aggregator. Fans out to injected hotel and car
 * adapters via Promise.allSettled with per-adapter timeout, tags each
 * offer with its source, applies filters, sorts, and returns with
 * per-adapter status metadata.
 *
 * Routing ownership: 1.7 owns CAR rental search. HOTEL search intent is owned
 * by Hotel Search Aggregator (20.1) for every hotel query — standalone or
 * within a trip. 1.7 may compose with 20.1 for a combined hotel+car trip, but
 * it does NOT own hotel intent; route all hotel queries to 20.1. (This agent
 * still fans out to hotel adapters for backward compatibility; the car-only
 * schema narrowing is deferred to its own migration — see TODO below.)
 *
 * Pattern mirrors MultiSourceAggregatorAgent (1.6) but fetches from
 * adapters directly rather than receiving already-fetched results.
 */

import Decimal from 'decimal.js';
import type { Agent, AgentHealthStatus, AgentInput, AgentOutput } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type {
  AdapterSummary,
  CarAdapter,
  CarOffer,
  CarSearchInput,
  CarSearchOutput,
  HotelAdapter,
  HotelCarSearchAgentOptions,
  HotelCarSearchInput,
  HotelCarSearchOutput,
  HotelOffer,
  HotelSearchInput,
  HotelSearchOutput,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;

// TODO: Hotel intent is owned by 20.1 (Hotel Search Aggregator). The hotel
// fan-out here is retained for backward compatibility only; narrow 1.7 to
// car-only (schema/types/output/tests) in a separate, product-gated migration.
export class HotelCarSearchAgent
  implements Agent<HotelCarSearchInput, HotelCarSearchOutput>
{
  readonly id = '1.7';
  readonly name = 'Hotel & Car Search';
  readonly version = '0.2.0';

  private initialized = false;
  private readonly hotelAdapters: HotelAdapter[];
  private readonly carAdapters: CarAdapter[];
  private readonly timeoutMs: number;

  constructor(options: HotelCarSearchAgentOptions = {}) {
    this.hotelAdapters = options.hotelAdapters ?? [];
    this.carAdapters = options.carAdapters ?? [];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<HotelCarSearchInput>,
  ): Promise<AgentOutput<HotelCarSearchOutput>> {
    if (!this.initialized) throw new AgentNotInitializedError(this.id);
    const d = input.data;

    if (d.operation !== 'searchHotels' && d.operation !== 'searchCars') {
      throw new AgentInputValidationError(
        this.id,
        'operation',
        'Must be searchHotels or searchCars.',
      );
    }

    if (d.operation === 'searchHotels') {
      if (!d.hotel) {
        throw new AgentInputValidationError(this.id, 'hotel', 'Hotel search input required.');
      }
      const result = await this.runHotelSearch(d.hotel);
      return {
        data: { hotelResults: result },
        confidence: computeConfidence(result.adapterSummary ?? [], this.hotelAdapters.length),
        metadata: { agent_id: this.id, offerCount: result.hotels.length },
      };
    }

    if (!d.car) {
      throw new AgentInputValidationError(this.id, 'car', 'Car search input required.');
    }
    const result = await this.runCarSearch(d.car);
    return {
      data: { carResults: result },
      confidence: computeConfidence(result.adapterSummary ?? [], this.carAdapters.length),
      metadata: { agent_id: this.id, offerCount: result.cars.length },
    };
  }

  async health(): Promise<AgentHealthStatus> {
    if (!this.initialized) {
      return { status: 'unhealthy', details: 'Not initialized.' };
    }
    if (this.hotelAdapters.length === 0 && this.carAdapters.length === 0) {
      return { status: 'degraded', details: 'No adapters configured.' };
    }
    return { status: 'healthy' };
  }

  destroy(): void {
    this.initialized = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Hotel search
  // ─────────────────────────────────────────────────────────────────────────

  private async runHotelSearch(input: HotelSearchInput): Promise<HotelSearchOutput> {
    const currency = input.currency ?? 'USD';
    if (this.hotelAdapters.length === 0) {
      return { hotels: [], currency, noAdaptersConfigured: true };
    }

    const results = await Promise.allSettled(
      this.hotelAdapters.map((adapter) => this.callHotelAdapter(adapter, input)),
    );

    const allOffers: HotelOffer[] = [];
    const adapterSummary: AdapterSummary[] = [];

    for (let i = 0; i < this.hotelAdapters.length; i++) {
      const adapter = this.hotelAdapters[i]!;
      const settled = results[i]!;
      if (settled.status === 'fulfilled') {
        const { offers, durationMs } = settled.value;
        allOffers.push(...offers);
        adapterSummary.push({ adapter: adapter.name, offerCount: offers.length, durationMs });
      } else {
        const err =
          settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
        adapterSummary.push({ adapter: adapter.name, offerCount: 0, durationMs: 0, error: err });
      }
    }

    const filtered = applyHotelFilters(allOffers, input);
    const sorted = sortHotels(filtered, input.sortBy ?? 'price');
    const capped =
      input.maxResults && input.maxResults > 0 ? sorted.slice(0, input.maxResults) : sorted;

    return { hotels: capped, currency, noAdaptersConfigured: false, adapterSummary };
  }

  private async callHotelAdapter(
    adapter: HotelAdapter,
    input: HotelSearchInput,
  ): Promise<{ offers: HotelOffer[]; durationMs: number }> {
    const start = Date.now();
    const offers = await withTimeout(
      adapter.searchHotels(input),
      this.timeoutMs,
      `Hotel adapter '${adapter.name}' timed out after ${this.timeoutMs}ms`,
    );
    return { offers, durationMs: Date.now() - start };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Car search
  // ─────────────────────────────────────────────────────────────────────────

  private async runCarSearch(input: CarSearchInput): Promise<CarSearchOutput> {
    if (this.carAdapters.length === 0) {
      return { cars: [], currency: 'USD', noAdaptersConfigured: true };
    }

    const results = await Promise.allSettled(
      this.carAdapters.map((adapter) => this.callCarAdapter(adapter, input)),
    );

    const allOffers: CarOffer[] = [];
    const adapterSummary: AdapterSummary[] = [];

    for (let i = 0; i < this.carAdapters.length; i++) {
      const adapter = this.carAdapters[i]!;
      const settled = results[i]!;
      if (settled.status === 'fulfilled') {
        const { offers, durationMs } = settled.value;
        allOffers.push(...offers);
        adapterSummary.push({ adapter: adapter.name, offerCount: offers.length, durationMs });
      } else {
        const err =
          settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
        adapterSummary.push({ adapter: adapter.name, offerCount: 0, durationMs: 0, error: err });
      }
    }

    const filtered = applyCarFilters(allOffers, input);
    const sorted = sortCars(filtered, input.sortBy ?? 'price');
    const capped =
      input.maxResults && input.maxResults > 0 ? sorted.slice(0, input.maxResults) : sorted;

    const currency = capped[0]?.currency ?? allOffers[0]?.currency ?? 'USD';
    return { cars: capped, currency, noAdaptersConfigured: false, adapterSummary };
  }

  private async callCarAdapter(
    adapter: CarAdapter,
    input: CarSearchInput,
  ): Promise<{ offers: CarOffer[]; durationMs: number }> {
    const start = Date.now();
    const offers = await withTimeout(
      adapter.searchCars(input),
      this.timeoutMs,
      `Car adapter '${adapter.name}' timed out after ${this.timeoutMs}ms`,
    );
    return { offers, durationMs: Date.now() - start };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

function applyHotelFilters(offers: HotelOffer[], input: HotelSearchInput): HotelOffer[] {
  return offers.filter((o) => {
    if (input.starRating !== undefined && o.starRating < input.starRating) return false;
    if (input.maxRatePerNight !== undefined) {
      try {
        if (new Decimal(o.ratePerNight).greaterThan(new Decimal(input.maxRatePerNight))) {
          return false;
        }
      } catch {
        // If either value isn't a valid decimal, let it through rather than silently drop.
      }
    }
    return true;
  });
}

function applyCarFilters(offers: CarOffer[], input: CarSearchInput): CarOffer[] {
  return offers.filter((o) => {
    if (input.carCategory !== undefined && o.category !== input.carCategory) return false;
    return true;
  });
}

function sortHotels(offers: HotelOffer[], sortBy: 'price' | 'rating' | 'name'): HotelOffer[] {
  const sorted = [...offers];
  if (sortBy === 'price') {
    sorted.sort((a, b) => new Decimal(a.ratePerNight).comparedTo(new Decimal(b.ratePerNight)));
  } else if (sortBy === 'rating') {
    // Descending: higher star rating first.
    sorted.sort((a, b) => b.starRating - a.starRating);
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted;
}

function sortCars(offers: CarOffer[], sortBy: 'price' | 'category'): CarOffer[] {
  const sorted = [...offers];
  if (sortBy === 'price') {
    sorted.sort((a, b) => new Decimal(a.dailyRate).comparedTo(new Decimal(b.dailyRate)));
  } else {
    sorted.sort((a, b) => a.category.localeCompare(b.category));
  }
  return sorted;
}

function computeConfidence(summary: AdapterSummary[], configuredCount: number): number {
  if (configuredCount === 0) return 0.5;
  const successes = summary.filter((s) => s.error === undefined).length;
  if (successes === 0) return 0.5;
  if (successes === configuredCount) return 1.0;
  return 0.8;
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports
// ─────────────────────────────────────────────────────────────────────────────

export type {
  AdapterSummary,
  CarAdapter,
  CarCategory,
  CarOffer,
  CarSearchInput,
  CarSearchOutput,
  CarSortBy,
  HotelAdapter,
  HotelCarOperation,
  HotelCarSearchAgentOptions,
  HotelCarSearchInput,
  HotelCarSearchOutput,
  HotelOffer,
  HotelSearchInput,
  HotelSearchOutput,
  HotelSortBy,
} from './types.js';
