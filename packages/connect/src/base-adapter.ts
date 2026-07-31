/**
 * Base adapter utilities — retry logic, error wrapping, rate limiting,
 * circuit breaking, and shared helpers for all ConnectAdapter implementations.
 */

import {
  withRetry as coreRetry,
  RateLimiter,
  CircuitBreaker,
  CircuitOpenError,
  type RetryConfig as CoreRetryConfig,
  type RateLimiterConfig,
  type CircuitBreakerConfig,
} from '@otaip/core';
import { isUnsafeAdapterOperation } from './operation-class.js';

export class ConnectError extends Error {
  constructor(
    message: string,
    public readonly supplier: string,
    public readonly operation: string,
    public readonly retryable: boolean = false,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ConnectError';
  }
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
};

export interface BaseAdapterResilienceConfig {
  readonly rateLimiter?: RateLimiterConfig;
  readonly circuitBreaker?: Partial<CircuitBreakerConfig>;
  /**
   * When true (default), unsafe ops (book/ticket/cancel) are never
   * auto-retried by withRetry after failure — callers must use
   * MutationExecutor + reconcile.
   */
  readonly disableUnsafeAutoRetry?: boolean;
}

export abstract class BaseAdapter {
  protected readonly retryConfig: RetryConfig;
  protected abstract readonly supplierId: string;
  private readonly rateLimiter: RateLimiter | null;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly disableUnsafeAutoRetry: boolean;

  constructor(
    retryConfig?: Partial<RetryConfig>,
    resilience?: BaseAdapterResilienceConfig,
  ) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
    this.rateLimiter = resilience?.rateLimiter
      ? new RateLimiter(resilience.rateLimiter)
      : null;
    this.circuitBreaker = new CircuitBreaker({
      name: undefined,
      failureThreshold: 5,
      resetMs: 30_000,
      ...resilience?.circuitBreaker,
    });
    this.disableUnsafeAutoRetry = resilience?.disableUnsafeAutoRetry ?? true;
  }

  /** Expose breaker status for health / tests. */
  getCircuitBreakerStatus(): ReturnType<CircuitBreaker['getStatus']> {
    return this.circuitBreaker.getStatus();
  }

  /** Test helper — reset breaker state. */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }

  protected async withRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const unsafe = isUnsafeAdapterOperation(operation);
    const maxRetries =
      unsafe && this.disableUnsafeAutoRetry ? 0 : this.retryConfig.maxRetries;

    const coreConfig: Partial<CoreRetryConfig> = {
      maxRetries,
      baseDelayMs: this.retryConfig.baseDelayMs,
      maxDelayMs: this.retryConfig.maxDelayMs,
    };

    try {
      this.circuitBreaker.assertClosed();
      if (this.rateLimiter) {
        await this.rateLimiter.acquire();
      }

      const result = await coreRetry(fn, coreConfig, (error) => {
        if (unsafe && this.disableUnsafeAutoRetry) return false;
        return this.isRetryable(error);
      });
      this.circuitBreaker.recordSuccess();
      return result;
    } catch (lastError) {
      if (!(lastError instanceof CircuitOpenError)) {
        // Business/validation errors should not trip the breaker.
        if (this.isTransportFailure(lastError)) {
          this.circuitBreaker.recordFailure();
        }
      }

      if (lastError instanceof CircuitOpenError) {
        throw new ConnectError(
          lastError.message,
          this.supplierId,
          operation,
          true,
          lastError,
        );
      }

      if (lastError instanceof ConnectError) {
        throw lastError;
      }

      throw new ConnectError(
        `${operation} failed after ${maxRetries + 1} attempts`,
        this.supplierId,
        operation,
        false,
        lastError,
      );
    }
  }

  protected wrapError(operation: string, error: unknown, retryable: boolean = false): ConnectError {
    if (error instanceof ConnectError) return error;

    const message = error instanceof Error ? error.message : String(error);
    return new ConnectError(
      `${operation}: ${message}`,
      this.supplierId,
      operation,
      retryable,
      error,
    );
  }

  protected async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number = 30_000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const err = new ConnectError(
          `Rate limited (429)${retryAfter ? ` retry-after=${retryAfter}` : ''}`,
          this.supplierId,
          'http',
          true,
        );
        this.circuitBreaker.recordFailure();
        throw err;
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private isTransportFailure(error: unknown): boolean {
    if (error instanceof ConnectError) return error.retryable;
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('timeout') ||
        msg.includes('aborted') ||
        msg.includes('econnreset') ||
        msg.includes('econnrefused') ||
        msg.includes('network') ||
        msg.includes('fetch failed') ||
        msg.includes('429') ||
        /\b5\d\d\b/.test(msg)
      );
    }
    return false;
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof ConnectError) return error.retryable;

    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('timeout') ||
        msg.includes('econnreset') ||
        msg.includes('econnrefused') ||
        msg.includes('network') ||
        msg.includes('fetch failed')
      );
    }

    return false;
  }
}
