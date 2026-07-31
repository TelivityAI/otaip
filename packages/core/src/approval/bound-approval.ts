/**
 * Bound, single-use approval tokens for mutation_irreversible actions.
 *
 * Tokens bind to (sessionId, agentId, inputHash) and expire. Default policy
 * no longer accepts arbitrary non-empty strings. Signatures use createHmac.
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  ActionType,
  SemanticIssue,
  SemanticValidationResult,
} from '../pipeline-validator/types.js';
import type { ApprovalPolicy } from '../pipeline-validator/action-classifier.js';
import type { CompareAndSwapPersistenceAdapter } from '../persistence/types.js';
import type { StoreDurability } from '../safety/live-safety-mode.js';
import { canonicalJson } from '../util/canonical-json.js';

/** Token format version — old concatenated-hash tokens are rejected. */
const TOKEN_VERSION = 'v1';

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
  /** Store-declared durability for live-mode refusal of ephemeral stores. */
  readonly durability: StoreDurability;
  /** Returns false if the jti was already consumed. */
  consume(jti: string): Promise<boolean>;
  /** Optional: check without consuming. */
  isConsumed?(jti: string): Promise<boolean>;
}

export class InMemoryBoundApprovalTokenStore implements BoundApprovalTokenStore {
  readonly durability = 'ephemeral' as const;
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

/**
 * CAS-backed single-use jti tombstones — durable when the persistence
 * adapter is durable (e.g. FileCompareAndSwapPersistenceAdapter).
 */
export class CasBoundApprovalTokenStore implements BoundApprovalTokenStore {
  readonly durability: StoreDurability;
  private readonly persistence: CompareAndSwapPersistenceAdapter;
  private readonly keyPrefix: string;

  constructor(
    persistence: CompareAndSwapPersistenceAdapter,
    options?: { keyPrefix?: string },
  ) {
    this.persistence = persistence;
    this.durability = persistence.durability;
    this.keyPrefix = options?.keyPrefix ?? 'approval-jti:';
  }

  async consume(jti: string): Promise<boolean> {
    const key = `${this.keyPrefix}${jti}`;
    return this.persistence.setIfAbsent(key, { consumedAt: Date.now() });
  }

  async isConsumed(jti: string): Promise<boolean> {
    return this.persistence.has(`${this.keyPrefix}${jti}`);
  }
}

function hmac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function encodeToken(claims: BoundApprovalClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const sig = hmac(secret, body);
  return `${TOKEN_VERSION}.${body}.${sig}`;
}

function decodeToken(token: string, secret: string): BoundApprovalClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [version, body, sig] = parts;
  if (version !== TOKEN_VERSION || !body || !sig) return null;
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
  const stripped = stripApprovalToken(input);
  return createHash('sha256').update(canonicalJson(stripped)).digest('hex');
}

function stripApprovalToken(input: unknown): unknown {
  if (input && typeof input === 'object' && !Array.isArray(input) && 'approvalToken' in input) {
    const rest: Record<string, unknown> = { ...(input as Record<string, unknown>) };
    delete rest['approvalToken'];
    return rest;
  }
  return input;
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
