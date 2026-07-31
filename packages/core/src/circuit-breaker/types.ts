export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  /** Failures required to open the circuit. */
  readonly failureThreshold: number;
  /** Milliseconds to wait before probing half-open. */
  readonly resetMs: number;
  /** Optional key namespace (supplier/credential/op). */
  readonly name?: string;
}

export interface CircuitBreakerStatus {
  readonly state: CircuitState;
  readonly failureCount: number;
  readonly openedAt: string | null;
  readonly resetAt: string | null;
}
