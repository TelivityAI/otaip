import { describe, it, expect } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('opens after failure threshold and blocks', () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 2, resetMs: 1000 }, () => now);
    cb.recordFailure();
    expect(() => cb.assertClosed()).not.toThrow();
    cb.recordFailure();
    expect(cb.getStatus().state).toBe('open');
    expect(() => cb.assertClosed()).toThrow(CircuitOpenError);
    now = 1000;
    expect(cb.getStatus().state).toBe('half_open');
    cb.recordSuccess();
    expect(cb.getStatus().state).toBe('closed');
  });
});
