import type { CircuitBreakerConfig, CircuitBreakerStatus, CircuitState } from './types.js';

const DEFAULTS: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetMs: 30_000,
};

/**
 * Process-local circuit breaker for supplier HTTP paths.
 * Key instances per supplier/credential/operation class in the adapter layer.
 */
export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private openedAt: number | null = null;
  private readonly now: () => number;

  constructor(config?: Partial<CircuitBreakerConfig>, now: () => number = Date.now) {
    this.config = { ...DEFAULTS, ...config };
    this.now = now;
  }

  getStatus(): CircuitBreakerStatus {
    this.maybeHalfOpen();
    return {
      state: this.state,
      failureCount: this.failureCount,
      openedAt: this.openedAt !== null ? new Date(this.openedAt).toISOString() : null,
      resetAt:
        this.openedAt !== null
          ? new Date(this.openedAt + this.config.resetMs).toISOString()
          : null,
    };
  }

  /** Throws CircuitOpenError when open (not yet half-open). */
  assertClosed(): void {
    this.maybeHalfOpen();
    if (this.state === 'open') {
      throw new CircuitOpenError(
        `Circuit breaker open${this.config.name ? ` (${this.config.name})` : ''}`,
      );
    }
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
    this.openedAt = null;
  }

  recordFailure(): void {
    this.failureCount += 1;
    if (this.state === 'half_open' || this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }

  reset(): void {
    this.failureCount = 0;
    this.state = 'closed';
    this.openedAt = null;
  }

  private maybeHalfOpen(): void {
    if (this.state !== 'open' || this.openedAt === null) return;
    if (this.now() >= this.openedAt + this.config.resetMs) {
      this.state = 'half_open';
    }
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
