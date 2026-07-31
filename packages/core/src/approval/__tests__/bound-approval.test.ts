import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCompareAndSwapPersistenceAdapter } from '../../persistence/file-cas-adapter.js';
import {
  CasBoundApprovalTokenStore,
  InMemoryBoundApprovalTokenStore,
  consumeBoundApprovalToken,
  createBoundApprovalPolicy,
  hashApprovalInput,
  issueBoundApprovalToken,
  peekBoundApprovalClaims,
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
    expect(token.startsWith('v1.')).toBe(true);
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

  it('uses createHmac not hash-concat', () => {
    const token = issueBoundApprovalToken({
      sessionId: 's',
      agentId: 'a',
      input: { z: 1, a: 2 },
      secret,
      jtiFactory: () => 'fixed-jti',
      now: () => 1_000_000,
      ttlMs: 60_000,
    });
    const [, body, sig] = token.split('.');
    expect(body).toBeTruthy();
    const hmacSig = createHmac('sha256', secret).update(body!).digest('hex');
    const concatSig = createHash('sha256').update(`${secret}:${body}`).digest('hex');
    expect(sig).toBe(hmacSig);
    expect(sig).not.toBe(concatSig);
  });

  it('canonical key order for input hash', () => {
    expect(hashApprovalInput({ b: 1, a: 2 })).toBe(hashApprovalInput({ a: 2, b: 1 }));
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

  it('rejects length-extension-shaped legacy hash-concat token', () => {
    const claims = {
      sessionId: 's',
      agentId: 'a',
      inputHash: hashApprovalInput({}),
      expiresAt: Date.now() + 60_000,
      jti: 'legacy',
    };
    const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const legacySig = createHash('sha256').update(`${secret}:${body}`).digest('hex');
    const legacyToken = `${body}.${legacySig}`;
    const policy = createBoundApprovalPolicy({
      secret,
      store: new InMemoryBoundApprovalTokenStore(),
      sessionId: 's',
      agentId: 'a',
      expectedInput: {},
    });
    expect(policy.validateApprovalToken?.(legacyToken, 'mutation_irreversible')?.ok).toBe(false);
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

  it('single-use consume rejects replay', async () => {
    const store = new InMemoryBoundApprovalTokenStore();
    const token = issueBoundApprovalToken({
      sessionId: 's',
      agentId: 'a',
      input: { x: 1 },
      secret,
    });
    const first = await consumeBoundApprovalToken(token, secret, store);
    expect(first.ok).toBe(true);
    const second = await consumeBoundApprovalToken(token, secret, store);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.issues[0]?.code).toBe('APPROVAL_TOKEN_REPLAYED');
    }
  });

  it('CasBoundApprovalTokenStore rejects replay across two store instances sharing file CAS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'otaip-appr-'));
    const persistence = new FileCompareAndSwapPersistenceAdapter(join(dir, 'jti.json'));
    expect(persistence.durability).toBe('durable');
    const storeA = new CasBoundApprovalTokenStore(persistence);
    const storeB = new CasBoundApprovalTokenStore(persistence);
    expect(storeA.durability).toBe('durable');

    const token = issueBoundApprovalToken({
      sessionId: 's',
      agentId: 'a',
      input: { n: 1 },
      secret,
    });
    const claims = peekBoundApprovalClaims(token, secret);
    expect(claims).not.toBeNull();

    const first = await consumeBoundApprovalToken(token, secret, storeA);
    expect(first.ok).toBe(true);
    const second = await consumeBoundApprovalToken(token, secret, storeB);
    expect(second.ok).toBe(false);
  });
});
