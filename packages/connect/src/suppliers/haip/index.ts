/**
 * HAIP PMS Connect adapter for @otaip/connect.
 *
 * A thin HTTP client that calls the HAIP Connect API at /api/v1/connect/*
 * and maps responses to OTAIP-compatible hotel types.
 *
 * Unsafe mutations (create/modify/cancel) go through MoneyPathExecutor.
 * Extends BaseAdapter for timeout and error wrapping; unsafe ops skip auto-retry.
 */

import {
  isLiveModeFromEnv,
  MoneyPathError,
  MoneyPathExecutor,
  type MoneyPathExecutorConfig,
  type StoreDurability,
} from '@otaip/core';
import { BaseAdapter, ConnectError } from '../../base-adapter.js';
import type { HaipConfig } from './config.js';
import { validateHaipConfig } from './config.js';
import {
  mapBookingResponse,
  mapCancelResponse,
  mapModifyResponse,
  mapPropertyDetail,
  mapSearchResults,
  mapVerifyResponse,
} from './mapper.js';
import type {
  HaipHotelResult,
  HaipBookingResult,
  HaipVerificationResult,
  HaipModificationResult,
  HaipCancellationResult,
  HaipRawRate,
} from './mapper.js';
import type {
  HaipBookRequest,
  HaipBookResponse,
  HaipBookingStatusResponse,
  HaipCancelResponse,
  HaipHealthResponse,
  HaipModifyRequest,
  HaipModifyResponse,
  HaipPropertyResponse,
  HaipSearchRequest,
  HaipSearchResponse,
} from './types.js';

// ---------------------------------------------------------------------------
// Input types for adapter methods
// ---------------------------------------------------------------------------

export interface HaipSearchParams {
  destination: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  adults: number;
  children?: number;
  currency?: string;
}

export interface HaipBookingParams {
  propertyId: string;
  roomTypeId: string;
  rateId: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
  guest: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    loyaltyNumber?: string;
    loyaltyProgram?: string;
  };
  externalConfirmationCode?: string;
  specialRequests?: string;
  /** Required in live mode — same key → at most one supplier book. */
  idempotencyKey?: string;
}

export interface HaipModifyParams {
  checkIn?: string;
  checkOut?: string;
  rooms?: number;
  roomTypeId?: string;
  rateId?: string;
  guest?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  };
  specialRequests?: string;
  /** Required in live mode for money-path idempotency. */
  idempotencyKey?: string;
}

export interface HaipAdapterOptions {
  readonly moneyPath?: MoneyPathExecutorConfig;
  readonly storeDurability?: StoreDurability;
  /**
   * Override live detection. Production-looking base URLs force live —
   * cannot be overridden off.
   */
  readonly liveMode?: boolean;
}

export type {
  HaipHotelResult,
  HaipBookingResult,
  HaipVerificationResult,
  HaipModificationResult,
  HaipCancellationResult,
  HaipRawRate,
} from './mapper.js';

function resolveHaipLiveMode(
  config: HaipConfig,
  options?: HaipAdapterOptions,
): boolean {
  const base = config.baseUrl.toLowerCase();
  const forcedLive =
    base.includes('://api.') ||
    base.includes('.production.') ||
    base.endsWith('.haip.io') ||
    (process.env['HAIP_ENV'] ?? '').toLowerCase() === 'production';
  if (forcedLive) return true;
  return options?.liveMode ?? isLiveModeFromEnv();
}

export class HaipAdapter extends BaseAdapter {
  protected readonly supplierId = 'haip';
  readonly adapterId = 'haip';
  readonly adapterName = 'HAIP PMS';

  private readonly config: HaipConfig;
  private readonly moneyPath: MoneyPathExecutor;
  private readonly liveMode: boolean;

  constructor(config: unknown, options?: HaipAdapterOptions) {
    const validated = validateHaipConfig(config);
    super({
      maxRetries: validated.maxRetries,
      baseDelayMs: validated.baseDelayMs,
    });
    this.config = validated;
    this.liveMode = resolveHaipLiveMode(validated, options);
    this.moneyPath = new MoneyPathExecutor({
      reconcileHint: 'getBookingStatus',
      ...options?.moneyPath,
      liveMode: this.liveMode,
      ...(options?.storeDurability !== undefined
        ? { storeDurability: options.storeDurability }
        : {}),
    });
  }

  get moneyPathExecutor(): MoneyPathExecutor {
    return this.moneyPath;
  }

  // -----------------------------------------------------------------------
  // Search (compatible with HotelSourceAdapter pattern)
  // -----------------------------------------------------------------------

  async searchHotels(params: HaipSearchParams): Promise<HaipHotelResult[]> {
    return this.withRetry('searchHotels', async () => {
      const body: HaipSearchRequest = {
        destination: params.destination,
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        rooms: params.rooms,
        adults: params.adults,
        children: params.children,
        currency: params.currency,
      };

      const response = await this.request<HaipSearchResponse>(
        'POST',
        '/api/v1/connect/search',
        body,
      );

      return mapSearchResults(response);
    });
  }

  async getPropertyDetails(propertyId: string): Promise<HaipHotelResult | null> {
    return this.withRetry('getPropertyDetails', async () => {
      try {
        const response = await this.request<HaipPropertyResponse>(
          'GET',
          `/api/v1/connect/properties/${encodeURIComponent(propertyId)}`,
        );
        return mapPropertyDetail(response);
      } catch (error) {
        if (error instanceof ConnectError && error.message.includes('404')) {
          return null;
        }
        throw error;
      }
    });
  }

  async checkRate(propertyId: string, roomTypeId: string): Promise<HaipRawRate | null> {
    return this.withRetry('checkRate', async () => {
      const body: HaipSearchRequest = {
        destination: propertyId,
        checkIn: new Date().toISOString().split('T')[0] as string,
        checkOut: new Date(Date.now() + 86_400_000).toISOString().split('T')[0] as string,
        rooms: 1,
        adults: 1,
      };

      const response = await this.request<HaipSearchResponse>(
        'POST',
        '/api/v1/connect/search',
        body,
      );

      const results = mapSearchResults(response);
      for (const result of results) {
        const rate = result.rates.find((r) => r.roomTypeId === roomTypeId);
        if (rate) return rate;
      }

      return null;
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const health = await this.healthCheck();
      return health.healthy;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Booking lifecycle
  // -----------------------------------------------------------------------

  async createBooking(params: HaipBookingParams): Promise<HaipBookingResult> {
    const key = params.idempotencyKey?.trim();
    if (this.liveMode && !key) {
      throw new MoneyPathError(
        'HaipAdapter.createBooking requires idempotencyKey in live mode (DoD 1/2)',
      );
    }
    const idempotencyKey =
      key ??
      `haip-book:${params.externalConfirmationCode ?? `${params.propertyId}:${params.checkIn}`}`;

    return this.moneyPath.executeUnsafeOrThrow({
      operation: 'createBooking',
      idempotencyKey,
      request: {
        propertyId: params.propertyId,
        roomTypeId: params.roomTypeId,
        rateId: params.rateId,
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        rooms: params.rooms,
      },
      supplierId: 'haip',
      fn: () => this.#createBookingOnce(params),
    });
  }

  /** Single-attempt book with RL+CB (unsafe → maxRetries 0). */
  async #createBookingOnce(params: HaipBookingParams): Promise<HaipBookingResult> {
    return this.withRetry('createBooking', async () => {
      const body: HaipBookRequest = {
        propertyId: params.propertyId,
        roomTypeId: params.roomTypeId,
        rateId: params.rateId,
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        rooms: params.rooms,
        guest: params.guest,
        externalConfirmationCode: params.externalConfirmationCode,
        specialRequests: params.specialRequests,
      };

      const response = await this.request<HaipBookResponse>('POST', '/api/v1/connect/book', body);
      return mapBookingResponse(response, params.externalConfirmationCode);
    });
  }

  async getBookingStatus(confirmationNumber: string): Promise<HaipVerificationResult> {
    return this.withRetry('getBookingStatus', async () => {
      const response = await this.request<HaipBookingStatusResponse>(
        'GET',
        `/api/v1/connect/bookings/${encodeURIComponent(confirmationNumber)}/verify`,
      );

      return mapVerifyResponse(response);
    });
  }

  async modifyBooking(
    confirmationNumber: string,
    changes: HaipModifyParams,
  ): Promise<HaipModificationResult> {
    const key = changes.idempotencyKey?.trim();
    if (this.liveMode && !key) {
      throw new MoneyPathError(
        'HaipAdapter.modifyBooking requires idempotencyKey in live mode (DoD 1/2)',
      );
    }
    const idempotencyKey = key ?? `haip-modify:${confirmationNumber}`;

    return this.moneyPath.executeUnsafeOrThrow({
      operation: 'modifyBooking',
      idempotencyKey,
      request: { confirmationNumber, changes },
      supplierId: 'haip',
      fn: () => this.#modifyBookingOnce(confirmationNumber, changes),
    });
  }

  async #modifyBookingOnce(
    confirmationNumber: string,
    changes: HaipModifyParams,
  ): Promise<HaipModificationResult> {
    return this.withRetry('modifyBooking', async () => {
      const body: HaipModifyRequest = {
        checkIn: changes.checkIn,
        checkOut: changes.checkOut,
        rooms: changes.rooms,
        roomTypeId: changes.roomTypeId,
        rateId: changes.rateId,
        guest: changes.guest,
        specialRequests: changes.specialRequests,
      };

      const response = await this.request<HaipModifyResponse>(
        'PATCH',
        `/api/v1/connect/bookings/${encodeURIComponent(confirmationNumber)}`,
        body,
      );

      return mapModifyResponse(response);
    });
  }

  async cancelBooking(
    confirmationNumber: string,
    options?: { idempotencyKey?: string },
  ): Promise<HaipCancellationResult> {
    const key = options?.idempotencyKey?.trim();
    if (this.liveMode && !key) {
      throw new MoneyPathError(
        'HaipAdapter.cancelBooking requires idempotencyKey in live mode (DoD 1/2)',
      );
    }
    const idempotencyKey = key ?? `haip-cancel:${confirmationNumber}`;

    return this.moneyPath.executeUnsafeOrThrow({
      operation: 'cancelBooking',
      idempotencyKey,
      request: { confirmationNumber },
      supplierId: 'haip',
      fn: () => this.#cancelBookingOnce(confirmationNumber),
    });
  }

  async #cancelBookingOnce(confirmationNumber: string): Promise<HaipCancellationResult> {
    return this.withRetry('cancelBooking', async () => {
      const response = await this.request<HaipCancelResponse>(
        'DELETE',
        `/api/v1/connect/bookings/${encodeURIComponent(confirmationNumber)}`,
      );

      return mapCancelResponse(response);
    });
  }

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const response = await this.request<HaipHealthResponse>('GET', '/health');
      return {
        healthy: response.status === 'ok' || response.status === 'healthy',
        latencyMs: Date.now() - start,
      };
    } catch {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
      };
    }
  }

  // -----------------------------------------------------------------------
  // HTTP helper
  // -----------------------------------------------------------------------

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const init: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
      init.body = JSON.stringify(body);
    }

    const response = await this.fetchWithTimeout(url, init, this.config.timeoutMs);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const retryable = response.status === 429 || response.status >= 500;
      throw new ConnectError(
        `HAIP ${method} ${path} returned ${response.status}: ${text}`,
        this.supplierId,
        `${method} ${path}`,
        retryable,
      );
    }

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }
}
