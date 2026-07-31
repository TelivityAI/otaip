/**
 * Action classifier — escalating requirements per `ActionType`.
 *
 *  - query: pass-through.
 *  - mutation_reversible: requires zero warnings on prior gates.
 *  - mutation_irreversible: requires zero warnings on prior gates AND a
 *    bound approval token (session + agent + inputHash). Plain non-empty
 *    strings are rejected by the default policy (DoD 6).
 */

import type {
  ActionType,
  GateResult,
  SemanticIssue,
  SemanticValidationResult,
} from './types.js';

/**
 * Per-deployment policy for which action types require an approval token
 * and how to validate it.
 */
export interface ApprovalPolicy {
  readonly requiresApproval: ReadonlySet<ActionType>;
  validateApprovalToken?(
    token: unknown,
    actionType: ActionType,
  ): SemanticValidationResult;
}

/** Bound token shape: base64url_body.sha256_hex_signature */
const BOUND_TOKEN_RE = /^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/;

function defaultValidateApprovalToken(
  token: unknown,
  _actionType: ActionType,
): SemanticValidationResult {
  if (typeof token !== 'string' || token.length === 0) {
    return {
      ok: false,
      issues: [
        {
          code: 'APPROVAL_TOKEN_INVALID',
          path: ['approvalToken'],
          message: 'Approval token is missing or empty',
          severity: 'error',
        },
      ],
    };
  }
  // Default policy requires bound-token format. Full crypto + single-use
  // validation is provided by createBoundApprovalPolicy / consumeBoundApprovalToken.
  if (!BOUND_TOKEN_RE.test(token)) {
    return {
      ok: false,
      issues: [
        {
          code: 'APPROVAL_TOKEN_FORGED',
          path: ['approvalToken'],
          message:
            'Approval token must be a bound token (issueBoundApprovalToken). Arbitrary strings are rejected.',
          severity: 'error',
        },
      ],
    };
  }
  return { ok: true, warnings: [] };
}

/** @deprecated Prefer bound tokens via createBoundApprovalPolicy. */
function legacyAnyNonEmpty(
  token: unknown,
  _actionType: ActionType,
): SemanticValidationResult {
  if (typeof token === 'string' && token.length > 0) {
    return { ok: true, warnings: [] };
  }
  return {
    ok: false,
    issues: [
      {
        code: 'APPROVAL_TOKEN_INVALID',
        path: ['approvalToken'],
        message: 'Approval token is missing or empty',
        severity: 'error',
      },
    ],
  };
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = Object.freeze({
  requiresApproval: new Set<ActionType>(['mutation_irreversible']),
  validateApprovalToken: defaultValidateApprovalToken,
});

/** Opt-in legacy policy — any non-empty string. Not for live money paths. */
export const LEGACY_ANY_NONEMPTY_APPROVAL_POLICY: ApprovalPolicy = Object.freeze({
  requiresApproval: new Set<ActionType>(['mutation_irreversible']),
  validateApprovalToken: legacyAnyNonEmpty,
});

/**
 * Run the action-class checks against an agent invocation.
 */
export function checkActionClassification(
  actionType: ActionType,
  input: unknown,
  priorGates: readonly GateResult[],
  policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY,
): SemanticValidationResult {
  const issues: SemanticIssue[] = [];

  if (actionType !== 'query') {
    const warnings = priorGates.flatMap((g) =>
      (g.issues ?? []).filter((i) => i.severity === 'warning'),
    );
    if (warnings.length > 0) {
      issues.push({
        code: 'MUTATION_WITH_WARNINGS',
        path: [],
        message: `Action type '${actionType}' requires zero warnings on prior gates; found ${warnings.length}`,
        severity: 'error',
      });
    }
  }

  if (policy.requiresApproval.has(actionType)) {
    const token =
      input && typeof input === 'object'
        ? (input as Record<string, unknown>)['approvalToken']
        : undefined;
    const validator = policy.validateApprovalToken;
    if (validator !== undefined) {
      const result = validator(token, actionType);
      if (!result.ok) {
        issues.push(...result.issues);
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, warnings: [] };
}
