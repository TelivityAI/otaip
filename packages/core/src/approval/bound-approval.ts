/**
 * Bound, single-use approval tokens for mutation_irreversible actions.
 *
 * Tokens bind to (sessionId, agentId, inputHash) and expire. Default policy
 * no longer accepts arbitrary non-empty strings.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  ActionType,
  SemanticIssue,
  SemanticValidationResult,
} from '../pipeline-validator/types.js';
import type { ApprovalPolicy } from '../pipeline-validator/action-classifier.js';

export interface BoundApprovalClaims {
  readonly sessionId: string;
  readonly agentId: string;
  readonly inputHash: string;
  /** Unix epoch milliseconds. */
  readonly expiresAt: number;
  /** Unique nonce for single-use tracking. */
  readonly jti: string;
}

export interface BoundApprovalTokenStore {
  /** Returns false if the jti was already consumed. */
  consume(jti: string): Promise<boolean>;
  /** Optional: check without consuming. */
  isConsumed?(jti: string): Promise<boolean>;
}

export class InMemoryBoundApprovalTokenStore implements BoundApprovalTokenStore {
  private readonly consumed = new Set<string>();

  async consume(jti: string): Promise<boolean> {
    if (this.consumed.has(jti)) return false;
    this.consumed.add(jti);
    return true;
  }

  async isConsumed(jti: string): Promise<boolean> {
    return this.consumed.has(jti);
  }
}

function hmac(secret: string, payload: string): string {
  return createHash('sha256').update(`${secret}:${payload}`).digest('hex');
}

function encodeToken(claims: BoundApprovalClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sig = hmac(secret, body);
  return `${body}.${sig}`;
}

function decodeToken(token: string, secret: string): BoundApprovalClaims | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = hmac(secret, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as BoundApprovalClaims;
  } catch {
    return null;
  }
}

export function hashApprovalInput(input: unknown): string {
  const json = JSON.stringify(input, (_k, v) => {
    if (v && typeof v === 'object' && 'approvalToken' in v) {
      const { approvalToken: _t, ...rest } = v as Record<string, unknown>;
      return rest;
    }
    return v;
  });
  return createHash('sha256').update(json).digest('hex');
}

export interface IssueBoundApprovalInput {
  readonly sessionId: string;
  readonly agentId: string;
  readonly input: unknown;
  /** TTL in milliseconds. Default 15 minutes. */
  readonly ttlMs?: number;
  readonly secret: string;
  readonly now?: () => number;
  readonly jtiFactory?: () => string;
}

export function issueBoundApprovalToken(input: IssueBoundApprovalInput): string {
  const now = input.now ?? Date.now;
  const claims: BoundApprovalClaims = {
    sessionId: input.sessionId,
    agentId: input.agentId,
    inputHash: hashApprovalInput(input.input),
    expiresAt: now() + (input.ttlMs ?? 15 * 60_000),
    jti: input.jtiFactory?.() ?? randomBytes(16).toString('hex'),
  };
  return encodeToken(claims, input.secret);
}

export interface BoundApprovalPolicyOptions {
  readonly secret: string;
  readonly store: BoundApprovalTokenStore;
  readonly sessionId: string;
  readonly agentId: string;
  /** Input used to compute expected hash (typically the agent input without token). */
  readonly expectedInput: unknown;
  readonly now?: () => number;
  readonly requiresApproval?: ReadonlySet<ActionType>;
}

function issue(
  code: string,
  message: string,
  path: readonly (string | number)[] = ['approvalToken'],
): SemanticValidationResult {
  const issue: SemanticIssue = {
    code,
    path: [...path],
    message,
    severity: 'error',
  };
  return { ok: false, issues: [issue] };
}

/**
 * Build an ApprovalPolicy that validates bound single-use tokens.
 * Note: validateApprovalToken is sync in the existing interface; consumption
 * is performed via {@link consumeBoundApprovalToken} after a sync structural check,
 * or use {@link createBoundApprovalPolicyAsync} with a pre-consumed gate.
 *
 * For the sync ApprovalPolicy interface, signature/expiry/binding are checked
 * synchronously; single-use is enforced by {@link BoundApprovalGate}.
 */
export function createBoundApprovalPolicy(options: BoundApprovalPolicyOptions): ApprovalPolicy {
  const now = options.now ?? Date.now;
  const expectedHash = hashApprovalInput(options.expectedInput);

  return {
    requiresApproval:
      options.requiresApproval ?? new Set<ActionType>(['mutation_irreversible']),
    validateApprovalToken(token: unknown, _actionType: ActionType): SemanticValidationResult {
      if (typeof token !== 'string' || token.length === 0) {
        return issue('APPROVAL_TOKEN_INVALID', 'Approval token is missing or empty');
      }
      const claims = decodeToken(token, options.secret);
      if (!claims) {
        return issue('APPROVAL_TOKEN_FORGED', 'Approval token signature invalid');
      }
      if (claims.expiresAt < now()) {
        return issue('APPROVAL_TOKEN_EXPIRED', 'Approval token expired');
      }
      if (claims.sessionId !== options.sessionId) {
        return issue('APPROVAL_TOKEN_SESSION_MISMATCH', 'Approval token session mismatch');
      }
      if (claims.agentId !== options.agentId) {
        return issue('APPROVAL_TOKEN_AGENT_MISMATCH', 'Approval token agent mismatch');
      }
      if (claims.inputHash !== expectedHash) {
        return issue('APPROVAL_TOKEN_INPUT_MISMATCH', 'Approval token input hash mismatch');
      }
      return { ok: true, warnings: [] };
    },
  };
}

/**
 * Async single-use consumption after sync policy validation passed.
 */
export async function consumeBoundApprovalToken(
  token: string,
  secret: string,
  store: BoundApprovalTokenStore,
): Promise<SemanticValidationResult> {
  const claims = decodeToken(token, secret);
  if (!claims) {
    return issue('APPROVAL_TOKEN_FORGED', 'Approval token signature invalid');
  }
  const ok = await store.consume(claims.jti);
  if (!ok) {
    return issue('APPROVAL_TOKEN_REPLAYED', 'Approval token already used');
  }
  return { ok: true, warnings: [] };
}

export function peekBoundApprovalClaims(
  token: string,
  secret: string,
): BoundApprovalClaims | null {
  return decodeToken(token, secret);
}
