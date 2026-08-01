/**
 * Live Hotelbeds APItude adapter — Hotels API v1.0.
 *
 * Implements:
 *   - HotelSourceAdapter (search-only) so the existing search-aggregator
 *     (Agent 20.1) can call this class through its pluggable interface.
 *   - The full Hotels lifecycle (availability, checkrate, book, retrieve,
 *     cancel) as direct methods on this class.
 *
 * Unsafe mutations (book POST, hard-cancel DELETE) use fetchOnce + MoneyPathExecutor.
 * Safe reads/search/checkrate/simulation cancel keep fetchWithRetry.
 */

import {
  CircuitBreaker,
  CircuitOpenError,
  fetchOnce,
  fetchWithRetry,
  isLiveModeFromEnv,
  MoneyPathError,
  MoneyPathExecutor,
  RateLimiter,
} from '@otaip/core';
import type { RawHotelResult } from '@otaip/agents-lodging';

import { buildAuthHeaders, type HotelbedsCredentials } from './auth.js';
import { mapHotelToRawResult, summarizeBooking, type BookingSummary } from './field-mapper.js';
import {
  mapActivityAvailability,
  mapActivityBookingResponse,
  mapActivityCancellation,
} from './activities-mapper.js';
import {
  mapTransferAvailability,
  mapTransferBookingResponse,
  mapTransferCancellation,
} from './transfers-mapper.js';
import type {
  HotelbedsAdapterConfig,
  HotelbedsAvailabilityRequest,
  HotelbedsAvailabilityResponse,
  HotelbedsBookingRequest,
  HotelbedsBookingResponse,
  HotelbedsBookingListResponse,
  HotelbedsCancellationFlag,
  HotelbedsCancellationResponse,
  HotelbedsCheckRateRequest,
  HotelbedsCheckRateResponse,
  HotelbedsEnvironment,
  HotelbedsErrorResponse,
} from './types.js';
import { HOTELBEDS_BASE_URLS } from './types.js';
import type {
  ActivityBookRequest,
  ActivityBookResponse,
  ActivityCancelResponse,
  ActivityOffer,
  ActivitySearchRequest,
  HotelbedsActivitiesAvailabilityRequest,
  HotelbedsActivitiesAvailabilityResponse,
  HotelbedsActivitiesBookingRequest,
  HotelbedsActivitiesBookingResponse,
  HotelbedsActivitiesCancellationResponse,
} from './activities-types.js';
import type {
  HotelbedsTransfersAvailabilityRequest,
  HotelbedsTransfersAvailabilityResponse,
  HotelbedsTransfersBookingRequest,
  HotelbedsTransfersBookingResponse,
  HotelbedsTransfersCancellationResponse,
  TransferBookRequest,
  TransferBookResponse,
  TransferCancelResponse,
  TransferOffer,
  TransferSearchRequest,
} from './transfers-types.js';
import type { HotelSearchParams, HotelSourceAdapter } from './lodging-source-interface.js';

const HOTELS_BASE_PATH = '/hotel-api/1.0';
const ACTIVITIES_BASE_PATH = '/activity-api/3.0';
const TRANSFERS_BASE_PATH = '/transfer-api/1.0';

interface RequestOptions {
  /**
   * Caller-supplied abort signal. Checked BEFORE issuing the request — once
   * fetch is in flight the per-attempt timeout controller in `fetchWithRetry`
   * owns cancellation. Wiring caller-cancel through to in-flight requests
   * needs an upstream change to `@otaip/core` and is tracked as future work.
   */
  signal?: AbortSignal;
}

export type { HotelSearchParams, HotelSourceAdapter } from './lodging-source-interface.js';

export interface HotelbedsBookOptions {
  /** Required in live mode — same key → at most one supplier book. */
  idempotencyKey?: string;
  /** Language path segment for activity/transfer cancel. Default: en. */
  language?: string;
}

export interface HotelbedsTransferCancelOptions extends HotelbedsBookOptions {
  /** When true, simulate cancel (retryable). Hard cancel when false/absent. */
  simulation?: boolean;
}

function isUnsafeHotelbedsPath(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  const pathOnly = path.split('?')[0] ?? path;
  const query = path.includes('?') ? (path.split('?')[1] ?? '') : '';

  if (upper === 'POST') {
    if (pathOnly === `${HOTELS_BASE_PATH}/bookings`) return true;
    if (pathOnly === `${ACTIVITIES_BASE_PATH}/activities/booking`) return true;
    if (pathOnly === `${TRANSFERS_BASE_PATH}/bookings`) return true;
  }
  if (upper === 'DELETE') {
    // Hard hotel cancel — SIMULATION may retry
    if (
      pathOnly.startsWith(`${HOTELS_BASE_PATH}/bookings/`) &&
      query.includes('cancellationFlag=CANCELLATION')
    ) {
      return true;
    }
    // Hard activity cancel
    if (
      pathOnly.startsWith(`${ACTIVITIES_BASE_PATH}/bookings/`) &&
      query.includes('cancellationFlag=CANCELLATION')
    ) {
      return true;
    }
    // Hard transfer cancel: DELETE .../reference/{ref} without simulation=true
    if (
      pathOnly.includes(`${TRANSFERS_BASE_PATH}/bookings/`) &&
      pathOnly.includes('/reference/') &&
      !query.includes('simulation=true')
    ) {
      return true;
    }
  }
  return false;
}

function resolveLiveMode(config: HotelbedsAdapterConfig, environment: HotelbedsEnvironment, baseUrl: string): boolean {
  const productionUrl = HOTELBEDS_BASE_URLS.production;
  const forcedLive =
    environment === 'production' || baseUrl === productionUrl || baseUrl.startsWith(`${productionUrl}/`);
  if (forcedLive) return true;
  return config.liveMode ?? isLiveModeFromEnv();
}

export class HotelbedsAdapter implements HotelSourceAdapter {
  readonly adapterId = 'hotelbeds';
  readonly adapterName = 'Hotelbeds APItude API';

  private readonly credentials: HotelbedsCredentials;
  private readonly baseUrl: string;
  private readonly environment: HotelbedsEnvironment;
  private readonly timeoutMs: number | undefined;
  private readonly rateLimiter: RateLimiter;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly moneyPath: MoneyPathExecutor;
  private readonly liveMode: boolean;

  constructor(config: HotelbedsAdapterConfig = {}) {
    const apiKey = config.apiKey ?? process.env['HOTELBEDS_API_KEY'] ?? '';
    const secret = config.secret ?? process.env['HOTELBEDS_SECRET'] ?? '';

    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error(
        'HotelbedsAdapter requires HOTELBEDS_API_KEY (constructor or env var).',
      );
    }
    if (!secret || secret.trim().length === 0) {
      throw new Error(
        'HotelbedsAdapter requires HOTELBEDS_SECRET (constructor or env var).',
      );
    }

    const envFromArgsOrEnv =
      config.environment ?? (process.env['HOTELBEDS_ENV'] as HotelbedsEnvironment | undefined);
    this.environment = envFromArgsOrEnv === 'production' ? 'production' : 'test';
    this.baseUrl = config.baseUrl ?? HOTELBEDS_BASE_URLS[this.environment];
    this.credentials = { apiKey, secret };
    this.timeoutMs = config.timeoutMs;
    this.liveMode = resolveLiveMode(config, this.environment, this.baseUrl);

    this.rateLimiter = new RateLimiter({ maxRequests: 50, windowMs: 1_000 });
    this.circuitBreaker = new CircuitBreaker({
      name: 'hotelbeds',
      failureThreshold: 5,
      resetMs: 30_000,
    });

    this.moneyPath = new MoneyPathExecutor({
      reconcileHint: 'getBookingStatus',
      ...config.moneyPath,
      liveMode: this.liveMode,
      ...(config.storeDurability !== undefined
        ? { storeDurability: config.storeDurability }
        : {}),
    });
  }

  get moneyPathExecutor(): MoneyPathExecutor {
    return this.moneyPath;
  }

  getCircuitBreakerStatus(): ReturnType<CircuitBreaker['getStatus']> {
    return this.circuitBreaker.getStatus();
  }

  // -------------------------------------------------------------------------
  // HotelSourceAdapter — search bridge
  // -------------------------------------------------------------------------

  async searchHotels(params: HotelSearchParams): Promise<RawHotelResult[]> {
    const start = Date.now();
    const occupancies = [
      {
        rooms: params.rooms,
        adults: params.adults,
        children: params.children ?? 0,
      },
    ];

    const body: HotelbedsAvailabilityRequest = {
      stay: { checkIn: params.checkIn, checkOut: params.checkOut },
      occupancies,
      destination: { code: params.destination.toUpperCase() },
    };

    const response = await this.availability(body);
    const latency = Date.now() - start;

    const hotels = response.hotels?.hotels ?? [];
    return hotels.map((h) =>
      mapHotelToRawResult(h, {
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        responseLatencyMs: latency,
      }),
    );
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.request('GET', `${HOTELS_BASE_PATH}/status`);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Hotels API — direct operations
  // -------------------------------------------------------------------------

  async availability(request: HotelbedsAvailabilityRequest): Promise<HotelbedsAvailabilityResponse> {
    return (await this.request(
      'POST',
      `${HOTELS_BASE_PATH}/hotels`,
      request,
    )) as HotelbedsAvailabilityResponse;
  }

  async checkRate(request: HotelbedsCheckRateRequest): Promise<HotelbedsCheckRateResponse> {
    return (await this.request(
      'POST',
      `${HOTELS_BASE_PATH}/checkrates`,
      request,
    )) as HotelbedsCheckRateResponse;
  }

  async book(
    request: HotelbedsBookingRequest,
    options?: HotelbedsBookOptions,
  ): Promise<HotelbedsBookingResponse> {
    const key = options?.idempotencyKey?.trim();
    if (this.liveMode && !key) {
      throw new MoneyPathError(
        'HotelbedsAdapter.book requires idempotencyKey in live mode (DoD 1/2)',
      );
    }
    const idempotencyKey = key ?? `hotelbeds-book:${request.clientReference ?? 'noref'}`;

    return this.moneyPath.executeUnsafeOrThrow({
      operation: 'book',
      idempotencyKey,
      request: {
        clientReference: request.clientReference,
        holder: request.holder,
      },
      supplierId: 'hotelbeds',
      fn: () =>
        this.request(
          'POST',
          `${HOTELS_BASE_PATH}/bookings`,
          request,
        ) as Promise<HotelbedsBookingResponse>,
    });
  }

  async getBooking(reference: string): Promise<HotelbedsBookingResponse> {
    return (await this.request(
      'GET',
      `${HOTELS_BASE_PATH}/bookings/${encodeURIComponent(reference)}`,
    )) as HotelbedsBookingResponse;
  }

  async listBookings(params: { from: string; to: string; filterType?: 'CHECKIN' | 'CHECKOUT' | 'CREATION' } = {
    from: '',
    to: '',
  }): Promise<HotelbedsBookingListResponse> {
    const search = new URLSearchParams();
    if (params.from) search.set('from', params.from);
    if (params.to) search.set('to', params.to);
    if (params.filterType) search.set('filterType', params.filterType);
    const query = search.toString();
    return (await this.request(
      'GET',
      `${HOTELS_BASE_PATH}/bookings${query ? `?${query}` : ''}`,
    )) as HotelbedsBookingListResponse;
  }

  /**
   * Cancel a booking. Two-step pattern recommended by Hotelbeds:
   *   1. Call with `flag = 'SIMULATION'` to preview the penalty.
   *   2. Call with `flag = 'CANCELLATION'` to actually cancel.
   *
   * Hard cancel (CANCELLATION) goes through MoneyPathExecutor + fetchOnce.
   */
  async cancelBooking(
    reference: string,
    flag: HotelbedsCancellationFlag = 'SIMULATION',
    options?: HotelbedsBookOptions,
  ): Promise<HotelbedsCancellationResponse> {
    const path = `${HOTELS_BASE_PATH}/bookings/${encodeURIComponent(reference)}?cancellationFlag=${flag}`;

    if (flag !== 'CANCELLATION') {
      return (await this.request('DELETE', path)) as HotelbedsCancellationResponse;
    }

    const key = options?.idempotencyKey?.trim();
    if (this.liveMode && !key) {
      throw new MoneyPathError(
        'HotelbedsAdapter.cancelBooking (CANCELLATION) requires idempotencyKey in live mode (DoD 1/2)',
      );
    }
    const idempotencyKey = key ?? `hotelbeds-cancel:${reference}`;

    return this.moneyPath.executeUnsafeOrThrow({
      operation: 'cancelBooking',
      idempotencyKey,
      request: { reference, flag },
      supplierId: 'hotelbeds',
      fn: () => this.request('DELETE', path) as Promise<HotelbedsCancellationResponse>,
    });
  }

  // -------------------------------------------------------------------------
  // Activities API — search / book / cancel
  // -------------------------------------------------------------------------

  async searchActivities(request: ActivitySearchRequest): Promise<ActivityOffer[]> {
    const body: HotelbedsActivitiesAvailabilityRequest = {
      filters: {
        searchFilterItems: [{ type: 'destination', value: request.destination.toUpperCase() }],
      },
      from: request.dateFrom,
      to: request.dateTo,
      paxes: {
        adults: request.paxes.adults,
        ...(request.paxes.children ? { children: request.paxes.children } : {}),
      },
      ...(request.category ? { category: request.category } : {}),
    };
    const response = (await this.request(
      'POST',
      `${ACTIVITIES_BASE_PATH}/activities/availability`,
      body,
      request.signal ? { signal: request.signal } : {},
    )) as HotelbedsActivitiesAvailabilityResponse;
    return mapActivityAvailability(response);
  }

  async bookActivity(request: ActivityBookRequest): Promise<ActivityBookResponse> {
    const key = request.idempotencyKey?.trim();
    if (this.liveMode && !key) {
      throw new MoneyPathError(
        'HotelbedsAdapter.bookActivity requires idempotencyKey in live mode (DoD 1/2)',
      );
    }
    const idempotencyKey = key ?? `hotelbeds-activity-book:${request.clientReference}`;

    const body: HotelbedsActivitiesBookingRequest = {
      activities: [
        {
          activityCode: request.activityCode,
          modalityCode: request.modalityCode,
          from: request.date,
          paxes: request.paxes,
        },
      ],
      holder: request.holder,
      clientReference: request.clientReference,
    };

    return this.moneyPath.executeUnsafeOrThrow({
      operation: 'bookActivity',
      idempotencyKey,
      request: {
        activityCode: request.activityCode,
        modalityCode: request.modalityCode,
        clientReference: request.clientReference,
      },
      supplierId: 'hotelbeds',
      fn: async () => {
        const response = (await this.request(
          'POST',
          `${ACTIVITIES_BASE_PATH}/activities/booking`,
          body,
          request.signal ? { signal: request.signal } : {},
        )) as HotelbedsActivitiesBookingResponse;
        return mapActivityBookingResponse(response);
      },
    });
  }

  /**
   * Cancel an activity booking.
   * Official: DELETE /activity-api/3.0/bookings/{language}/{reference}?cancellationFlag=
   * SIMULATION | CANCELLATION (see Hotelbeds Activities Cancel docs).
   */
  async cancelActivity(
    bookingReference: string,
    flag: HotelbedsCancellationFlag = 'SIMULATION',
    options?: HotelbedsBookOptions,
  ): Promise<ActivityCancelResponse> {
    const language = options?.language?.trim() || 'en';
    const path =
      `${ACTIVITIES_BASE_PATH}/bookings/${encodeURIComponent(language)}/` +
      `${encodeURIComponent(bookingReference)}?cancellationFlag=${flag}`;

    if (flag !== 'CANCELLATION') {
      const response = (await this.request(
        'DELETE',
        path,
      )) as HotelbedsActivitiesCancellationResponse;
      return mapActivityCancellation(response);
    }

    const key = options?.idempotencyKey?.trim();
    if (this.liveMode && !key) {
      throw new MoneyPathError(
        'HotelbedsAdapter.cancelActivity (CANCELLATION) requires idempotencyKey in live mode (DoD 1/2)',
      );
    }
    const idempotencyKey = key ?? `hotelbeds-activity-cancel:${bookingReference}`;

    return this.moneyPath.executeUnsafeOrThrow({
      operation: 'cancelActivity',
      idempotencyKey,
      request: { bookingReference, flag, language },
      supplierId: 'hotelbeds',
      fn: async () => {
        const response = (await this.request(
          'DELETE',
          path,
        )) as HotelbedsActivitiesCancellationResponse;
        return mapActivityCancellation(response);
      },
    });
  }

  // -------------------------------------------------------------------------
  // Transfers API — search / book / cancel
  // -------------------------------------------------------------------------

  async searchTransfers(request: TransferSearchRequest): Promise<TransferOffer[]> {
    const body: HotelbedsTransfersAvailabilityRequest = {
      language: 'en',
      from: { type: request.from.type, code: request.from.code },
      to: { type: request.to.type, code: request.to.code },
      outbound: { date: request.outboundDate, time: request.outboundTime },
      adults: request.adults,
      ...(request.children !== undefined ? { children: request.children } : {}),
    };
    const response = (await this.request(
      'POST',
      `${TRANSFERS_BASE_PATH}/availability`,
      body,
      request.signal ? { signal: request.signal } : {},
    )) as HotelbedsTransfersAvailabilityResponse;
    return mapTransferAvailability(response);
  }

  async bookTransfer(request: TransferBookRequest): Promise<TransferBookResponse> {
    const key = request.idempotencyKey?.trim();
    if (this.liveMode && !key) {
      throw new MoneyPathError(
        'HotelbedsAdapter.bookTransfer requires idempotencyKey in live mode (DoD 1/2)',
      );
    }
    const idempotencyKey = key ?? `hotelbeds-transfer-book:${request.clientReference}`;

    const body: HotelbedsTransfersBookingRequest = {
      transferCode: request.transferCode,
      holder: request.holder,
      passengers: request.passengers,
      clientReference: request.clientReference,
    };

    return this.moneyPath.executeUnsafeOrThrow({
      operation: 'bookTransfer',
      idempotencyKey,
      request: {
        transferCode: request.transferCode,
        clientReference: request.clientReference,
      },
      supplierId: 'hotelbeds',
      fn: async () => {
        const response = (await this.request(
          'POST',
          `${TRANSFERS_BASE_PATH}/bookings`,
          body,
          request.signal ? { signal: request.signal } : {},
        )) as HotelbedsTransfersBookingResponse;
        return mapTransferBookingResponse(response);
      },
    });
  }

  /**
   * Cancel a transfer booking.
   * Official: DELETE /transfer-api/1.0/bookings/{language}/reference/{ref}
   * Optional ?simulation=true. Absent simulation = hard cancel.
   * Partial cancel via /id/{service_id} is out of scope.
   */
  async cancelTransfer(
    bookingReference: string,
    options?: HotelbedsTransferCancelOptions,
  ): Promise<TransferCancelResponse> {
    const language = options?.language?.trim() || 'en';
    const simulation = options?.simulation === true;
    let path =
      `${TRANSFERS_BASE_PATH}/bookings/${encodeURIComponent(language)}/reference/` +
      `${encodeURIComponent(bookingReference)}`;
    if (simulation) {
      path += '?simulation=true';
    }

    if (simulation) {
      const response = (await this.request(
        'DELETE',
        path,
      )) as HotelbedsTransfersCancellationResponse;
      return mapTransferCancellation(response);
    }

    const key = options?.idempotencyKey?.trim();
    if (this.liveMode && !key) {
      throw new MoneyPathError(
        'HotelbedsAdapter.cancelTransfer (hard cancel) requires idempotencyKey in live mode (DoD 1/2)',
      );
    }
    const idempotencyKey = key ?? `hotelbeds-transfer-cancel:${bookingReference}`;

    return this.moneyPath.executeUnsafeOrThrow({
      operation: 'cancelTransfer',
      idempotencyKey,
      request: { bookingReference, language, simulation: false },
      supplierId: 'hotelbeds',
      fn: async () => {
        const response = (await this.request(
          'DELETE',
          path,
        )) as HotelbedsTransfersCancellationResponse;
        return mapTransferCancellation(response);
      },
    });
  }

  // -------------------------------------------------------------------------
  // Convenience helpers — mapped output
  // -------------------------------------------------------------------------

  async availabilityRawResults(
    request: HotelbedsAvailabilityRequest,
  ): Promise<RawHotelResult[]> {
    const start = Date.now();
    const response = await this.availability(request);
    const latency = Date.now() - start;
    const hotels = response.hotels?.hotels ?? [];
    return hotels.map((h) =>
      mapHotelToRawResult(h, {
        checkIn: request.stay.checkIn,
        checkOut: request.stay.checkOut,
        responseLatencyMs: latency,
      }),
    );
  }

  async bookSummary(
    request: HotelbedsBookingRequest,
    options?: HotelbedsBookOptions,
  ): Promise<BookingSummary | null> {
    const response = await this.book(request, options);
    if (!response.booking) return null;
    return summarizeBooking(response.booking);
  }

  // -------------------------------------------------------------------------
  // Low-level request
  // -------------------------------------------------------------------------

  private async request(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<unknown> {
    if (options.signal?.aborted) {
      throw new Error('Hotelbeds API request aborted before dispatch');
    }

    try {
      this.circuitBreaker.assertClosed();
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        throw new Error(`Hotelbeds API circuit open: ${err.message}`);
      }
      throw err;
    }
    await this.rateLimiter.acquire();

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      ...buildAuthHeaders(this.credentials),
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const unsafe = isUnsafeHotelbedsPath(method, path);
    const init: RequestInit = {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };
    const fetchOpts = this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {};

    let response: Response;
    try {
      response = unsafe
        ? await fetchOnce(url, init, fetchOpts)
        : await fetchWithRetry(url, init, fetchOpts);
    } catch (err: unknown) {
      this.circuitBreaker.recordFailure();
      const message = err instanceof Error ? err.message : 'Unknown network error';
      throw new Error(`Hotelbeds API network error: ${message}`);
    }

    if (!response.ok) {
      let detail = '';
      try {
        const errorBody = (await response.json()) as HotelbedsErrorResponse;
        detail = errorBody.error?.message ?? '';
      } catch {
        // ignore parse errors — Hotelbeds occasionally returns text/html on 5xx
      }

      if (response.status === 429 || response.status >= 500) {
        this.circuitBreaker.recordFailure();
      }

      if (response.status === 429) {
        throw new Error(`Hotelbeds API rate limited (429). ${detail}`.trim());
      }

      throw new Error(
        `Hotelbeds API error ${response.status}: ${detail || response.statusText}`.trim(),
      );
    }

    this.circuitBreaker.recordSuccess();

    // 204 No Content — uncommon but the spec allows it for some empty results.
    if (response.status === 204) return {};
    return response.json();
  }
}
