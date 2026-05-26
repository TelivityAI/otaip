/**
 * API Client Engine — circuit breaker, retry, rate limiting, error normalization.
 *
 * No real HTTP calls — all provider responses are mocked via the
 * request handler injection pattern for testability.
 */

import type {
  ProviderConfig,
  CircuitState,
  CircuitBreakerStatus,
  RateLimitStatus,
  ApiRequest,
  ApiResponse,
  NormalizedError,
  ErrorCategory,
  ApiAbstractionInput,
  ApiAbstractionOutput,
} from './types.js';
// JSON imported directly so esbuild inlines it into dist/index.js — using
// createRequire on the bundled output would fail with MODULE_NOT_FOUND when
// this package is consumed as a built dep.
import providerConfigsJson from './data/provider-configs.json';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

interface ProviderData {
  providers: Record<string, ProviderConfig>;
}

const providerData = providerConfigsJson as unknown as ProviderData;

// ---------------------------------------------------------------------------
// Circuit breaker state (per provider, in-memory)
// ---------------------------------------------------------------------------

interface CircuitBreakerState {
  state: CircuitState;
  failure_count: number;
  last_failure_at: number | null;
  reset_at: number | null;
}

// ---------------------------------------------------------------------------
// Rate limit state (per provider, in-memory)
// ---------------------------------------------------------------------------

interface RateLimitState {
  request_count: number;
  window_start: number;
}

// ---------------------------------------------------------------------------
// Request handler type (injectable for testing)
// ---------------------------------------------------------------------------

export type RequestHandler = (
  provider: ProviderConfig,
  request: ApiRequest,
  timeout_ms: number,
) => Promise<ApiResponse>;

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

export class ApiClient {
  private circuits = new Map<string, CircuitBreakerState>();
  private rateLimits = new Map<string, RateLimitState>();
  private requestHandler: RequestHandler;

  constructor(handler?: RequestHandler) {
    // Default handler always throws — real calls are never made
    this.requestHandler =
      handler ??
      ((): Promise<ApiResponse> => {
        return Promise.reject(
          new Error('No request handler configured. Inject a mock handler for testing.'),
        );
      });
  }

  // -----------------------------------------------------------------------
  // Provider registry
  // -----------------------------------------------------------------------

  getProvider(id: string): ProviderConfig | undefined {
    return providerData.providers[id];
  }

  listProviders(): ProviderConfig[] {
    return Object.values(providerData.providers);
  }

  // -----------------------------------------------------------------------
  // Main execute
  // -----------------------------------------------------------------------

  async execute(input: ApiAbstractionInput): Promise<ApiAbstractionOutput> {
    const provider = this.getProvider(input.request.provider_id);
    if (!provider) {
      return this.buildErrorOutput(
        input.request.provider_id,
        'VALIDATION_ERROR',
        `Unknown provider: ${input.request.provider_id}`,
        'UNKNOWN_PROVIDER',
        false,
      );
    }

    // Check circuit breaker (no per-attempt outbound traffic if open).
    if (!input.force) {
      const cbState = this.getCircuitState(provider);
      if (cbState.state === 'open') {
        return this.buildErrorOutput(
          provider.id,
          'CIRCUIT_OPEN',
          `Circuit breaker is open for ${provider.id}. Resets at ${cbState.reset_at ? new Date(cbState.reset_at).toISOString() : 'unknown'}`,
          'CIRCUIT_OPEN',
          true,
        );
      }
    }

    // Execute with retry — rate-limit check + counter increment happen
    // PER ATTEMPT. The previous implementation incremented once before
    // the loop, so retries to the upstream provider went uncounted and
    // we under-reported traffic against provider quotas.
    const maxRetries = input.max_retries ?? provider.max_retries;
    const timeoutMs = input.timeout_ms ?? provider.timeout_ms;

    let lastError: NormalizedError | null = null;
    let retries = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Per-attempt rate-limit guard.
      const rlStatus = this.checkRateLimit(provider);
      if (rlStatus.exceeded) {
        // If we've already issued at least one outbound attempt, surface
        // the prior failure (if any). Otherwise return the rate-limit
        // error directly.
        if (lastError) {
          break;
        }
        return this.buildErrorOutput(
          provider.id,
          'RATE_LIMITED',
          `Rate limit exceeded for ${provider.id}: ${rlStatus.request_count}/${rlStatus.max_requests}`,
          'RATE_LIMIT_EXCEEDED',
          true,
        );
      }

      try {
        // Exponential backoff (skip for first attempt)
        if (attempt > 0) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          await this.sleep(backoffMs);
          retries = attempt;
        }

        // Count this outbound attempt against the provider's quota
        // BEFORE the call so concurrent attempts cannot race past the
        // limit, and so retries are correctly accounted for.
        this.incrementRateLimit(provider);

        const response = await this.requestHandler(provider, input.request, timeoutMs);

        // Success — reset circuit breaker
        this.recordSuccess(provider);

        return {
          response: { ...response, retries },
          error: null,
          circuit_breaker: this.getCircuitBreakerStatus(provider),
          rate_limit: this.getRateLimitStatus(provider),
          success: true,
        };
      } catch (err) {
        lastError = this.normalizeError(provider.id, err);
        this.recordFailure(provider);

        // Don't retry non-retryable errors
        if (!lastError.retryable) break;
      }
    }

    return {
      response: null,
      error: lastError,
      circuit_breaker: this.getCircuitBreakerStatus(provider),
      rate_limit: this.getRateLimitStatus(provider),
      success: false,
    };
  }

  // -----------------------------------------------------------------------
  // Circuit breaker
  // -----------------------------------------------------------------------

  private getCircuitState(provider: ProviderConfig): CircuitBreakerState {
    const existing = this.circuits.get(provider.id);
    if (!existing) {
      const initial: CircuitBreakerState = {
        state: 'closed',
        failure_count: 0,
        last_failure_at: null,
        reset_at: null,
      };
      this.circuits.set(provider.id, initial);
      return initial;
    }

    // Check if open circuit should transition to half-open
    if (existing.state === 'open' && existing.reset_at && Date.now() >= existing.reset_at) {
      existing.state = 'half-open';
    }

    return existing;
  }

  private recordSuccess(provider: ProviderConfig): void {
    const state = this.getCircuitState(provider);
    state.state = 'closed';
    state.failure_count = 0;
  }

  private recordFailure(provider: ProviderConfig): void {
    const state = this.getCircuitState(provider);
    state.failure_count++;
    state.last_failure_at = Date.now();

    if (state.failure_count >= provider.circuit_breaker_threshold) {
      state.state = 'open';
      state.reset_at = Date.now() + provider.circuit_breaker_reset_ms;
    }
  }

  getCircuitBreakerStatus(provider: ProviderConfig): CircuitBreakerStatus {
    const state = this.getCircuitState(provider);
    return {
      state: state.state,
      failure_count: state.failure_count,
      threshold: provider.circuit_breaker_threshold,
      last_failure_at: state.last_failure_at ? new Date(state.last_failure_at).toISOString() : null,
      reset_at: state.reset_at ? new Date(state.reset_at).toISOString() : null,
    };
  }

  /** Reset circuit breaker for a provider (for testing) */
  resetCircuitBreaker(providerId: string): void {
    this.circuits.delete(providerId);
  }

  /** Force circuit breaker to a specific state (for testing) */
  setCircuitState(providerId: string, state: CircuitState, resetAt?: number): void {
    const config = this.getProvider(providerId);
    if (!config) return;
    this.circuits.set(providerId, {
      state,
      failure_count: state === 'open' ? config.circuit_breaker_threshold : 0,
      last_failure_at: state === 'open' ? Date.now() : null,
      reset_at: resetAt ?? (state === 'open' ? Date.now() + config.circuit_breaker_reset_ms : null),
    });
  }

  // -----------------------------------------------------------------------
  // Rate limiting
  // -----------------------------------------------------------------------

  private checkRateLimit(provider: ProviderConfig): RateLimitStatus {
    const state = this.getRateLimitState(provider);
    return {
      provider_id: provider.id,
      request_count: state.request_count,
      max_requests: provider.rate_limit_max,
      window_start: new Date(state.window_start).toISOString(),
      exceeded: state.request_count >= provider.rate_limit_max,
    };
  }

  private getRateLimitState(provider: ProviderConfig): RateLimitState {
    const now = Date.now();
    const existing = this.rateLimits.get(provider.id);

    if (!existing || now - existing.window_start >= provider.rate_limit_window_ms) {
      const fresh: RateLimitState = { request_count: 0, window_start: now };
      this.rateLimits.set(provider.id, fresh);
      return fresh;
    }

    return existing;
  }

  private incrementRateLimit(provider: ProviderConfig): void {
    const state = this.getRateLimitState(provider);
    state.request_count++;
  }

  getRateLimitStatus(provider: ProviderConfig): RateLimitStatus {
    return this.checkRateLimit(provider);
  }

  /** Reset rate limit for a provider (for testing) */
  resetRateLimit(providerId: string): void {
    this.rateLimits.delete(providerId);
  }

  // -----------------------------------------------------------------------
  // Error normalization
  // -----------------------------------------------------------------------

  normalizeError(providerId: string, err: unknown): NormalizedError {
    if (err instanceof ProviderError) {
      return {
        category: err.category,
        original_code: err.originalCode,
        message: err.message,
        provider_id: providerId,
        retryable: err.retryable,
        details: err.details,
      };
    }

    if (err instanceof Error) {
      // Detect common error patterns
      const msg = err.message.toLowerCase();

      if (msg.includes('timeout') || msg.includes('timed out')) {
        return {
          category: 'TIMEOUT',
          original_code: 'TIMEOUT',
          message: err.message,
          provider_id: providerId,
          retryable: true,
        };
      }

      if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('econnreset')) {
        return {
          category: 'NETWORK_ERROR',
          original_code: 'NETWORK',
          message: err.message,
          provider_id: providerId,
          retryable: true,
        };
      }

      if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('auth')) {
        return {
          category: 'AUTH_FAILURE',
          original_code: '401',
          message: err.message,
          provider_id: providerId,
          retryable: false,
        };
      }

      if (msg.includes('404') || msg.includes('not found')) {
        return {
          category: 'NOT_FOUND',
          original_code: '404',
          message: err.message,
          provider_id: providerId,
          retryable: false,
        };
      }

      if (msg.includes('409') || msg.includes('conflict')) {
        return {
          category: 'CONFLICT',
          original_code: '409',
          message: err.message,
          provider_id: providerId,
          retryable: false,
        };
      }

      if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many')) {
        return {
          category: 'RATE_LIMITED',
          original_code: '429',
          message: err.message,
          provider_id: providerId,
          retryable: true,
        };
      }

      if (msg.includes('500') || msg.includes('internal server') || msg.includes('server error')) {
        return {
          category: 'SERVER_ERROR',
          original_code: '500',
          message: err.message,
          provider_id: providerId,
          retryable: true,
        };
      }

      // EDIFACT error patterns
      if (msg.includes('edifact') || /^[A-Z]{3}\d{3}/.test(err.message)) {
        return {
          category: 'EDIFACT_ERROR',
          original_code: err.message.slice(0, 6),
          message: err.message,
          provider_id: providerId,
          retryable: false,
        };
      }

      // SOAP fault patterns
      if (msg.includes('soap') || msg.includes('fault')) {
        return {
          category: 'SOAP_FAULT',
          original_code: 'SOAP_FAULT',
          message: err.message,
          provider_id: providerId,
          retryable: false,
        };
      }

      // NDC error patterns
      if (msg.includes('ndc') || msg.includes('order')) {
        return {
          category: 'NDC_ERROR',
          original_code: 'NDC_ERROR',
          message: err.message,
          provider_id: providerId,
          retryable: false,
        };
      }

      return {
        category: 'UNKNOWN',
        original_code: 'UNKNOWN',
        message: err.message,
        provider_id: providerId,
        retryable: false,
      };
    }

    return {
      category: 'UNKNOWN',
      original_code: 'UNKNOWN',
      message: String(err),
      provider_id: providerId,
      retryable: false,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildErrorOutput(
    providerId: string,
    category: ErrorCategory,
    message: string,
    code: string,
    retryable: boolean,
  ): ApiAbstractionOutput {
    const provider = this.getProvider(providerId);
    return {
      response: null,
      error: {
        category,
        original_code: code,
        message,
        provider_id: providerId,
        retryable,
      },
      circuit_breaker: provider
        ? this.getCircuitBreakerStatus(provider)
        : {
            state: 'closed',
            failure_count: 0,
            threshold: 0,
            last_failure_at: null,
            reset_at: null,
          },
      rate_limit: provider
        ? this.getRateLimitStatus(provider)
        : {
            provider_id: providerId,
            request_count: 0,
            max_requests: 0,
            window_start: new Date().toISOString(),
            exceeded: false,
          },
      success: false,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ---------------------------------------------------------------------------
// Custom error class for provider-specific errors
// ---------------------------------------------------------------------------

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly category: ErrorCategory,
    public readonly originalCode: string,
    public readonly retryable: boolean,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
