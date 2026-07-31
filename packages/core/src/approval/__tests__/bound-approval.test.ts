import { describe, it, expect } from 'vitest';
import {
  InMemoryBoundApprovalTokenStore,
  consumeBoundApprovalToken,
  createBoundApprovalPolicy,
  hashApprovalInput,
  issueBoundApprovalToken,
} from '../bound-approval.js';

const secret = 'unit-test-secret';

describe('bound approval tokens', () => {
  it('issues and validates matching input hash', () => {
    const input = { amount: '10.00', currency: 'USD' };
    const token = issueBoundApprovalToken({
      sessionId: 'sess-1',
      agentId: '4.1',
      input,
      secret,
    });
    const policy = createBoundApprovalPolicy({
      secret,
      store: new InMemoryBoundApprovalTokenStore(),
      sessionId: 'sess-1',
      agentId: '4.1',
      expectedInput: input,
    });
    const result = policy.validateApprovalToken?.(token, 'mutation_irreversible');
    expect(result?.ok).toBe(true);
  });

  it('rejects wrong input hash', () => {
    const token = issueBoundApprovalToken({
      sessionId: 'sess-1',
      agentId: '4.1',
      input: { amount: '10.00' },
      secret,
    });
    const policy = createBoundApprovalPolicy({
      secret,
      store: new InMemoryBoundApprovalTokenStore(),
      sessionId: 'sess-1',
      agentId: '4.1',
      expectedInput: { amount: '999.00' },
    });
    const result = policy.validateApprovalToken?.(token, 'mutation_irreversible');
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.issues[0]?.code).toBe('APPROVAL_TOKEN_INPUT_MISMATCH');
    }
  });

  it('rejects forged token', () => {
    const policy = createBoundApprovalPolicy({
      secret,
      store: new InMemoryBoundApprovalTokenStore(),
      sessionId: 's',
      agentId: 'a',
      expectedInput: {},
    });
    const result = policy.validateApprovalToken?.('not.a.real.token', 'mutation_irreversible');
    expect(result?.ok).toBe(false);
  });

  it('rejects expired token', () => {
    let now = 1_000_000;
    const token = issueBoundApprovalToken({
      sessionId: 's',
      agentId: 'a',
      input: {},
      secret,
      ttlMs: 10,
      now: () => now,
    });
    now = 1_000_100;
    const policy = createBoundApprovalPolicy({
      secret,
      store: new InMemoryBoundApprovalTokenStore(),
      sessionId: 's',
      agentId: 'a',
      expectedInput: {},
      now: () => now,
    });
    const result = policy.validateApprovalToken?.(token, 'mutation_irreversible');
    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.issues[0]?.code).toBe('APPROVAL_TOKEN_EXPIRED');
    }
  });

  it('rejects replayed token on consume', async () => {
    const store = new InMemoryBoundApprovalTokenStore();
    const token = issueBoundApprovalToken({
      sessionId: 's',
      agentId: 'a',
      input: { x: 1 },
      secret,
      jtiFactory: () => 'fixed-jti',
    });
    const first = await consumeBoundApprovalToken(token, secret, store);
    const second = await consumeBoundApprovalToken(token, secret, store);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.issues[0]?.code).toBe('APPROVAL_TOKEN_REPLAYED');
  });

  it('hashApprovalInput ignores approvalToken field', () => {
    expect(hashApprovalInput({ a: 1, approvalToken: 'x' })).toBe(hashApprovalInput({ a: 1 }));
  });
});
