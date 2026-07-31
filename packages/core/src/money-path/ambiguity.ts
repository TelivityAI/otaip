/**
 * Classify whether a thrown error means the supplier effect may have applied.
 */

function messageLooksAmbiguous(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('fetch failed') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('network') ||
    lower.includes('aborted') ||
    lower.includes('timeout') ||
    lower.includes('429') ||
    /\b5\d\d\b/.test(lower)
  );
}

function walkCauses(error: unknown, depth = 0): unknown[] {
  if (error === null || error === undefined || depth > 6) return [];
  const out: unknown[] = [error];
  if (typeof error === 'object' && error !== null && 'cause' in error) {
    out.push(...walkCauses((error as { cause: unknown }).cause, depth + 1));
  }
  return out;
}

/**
 * True when the caller must not re-issue the mutation — reconcile first.
 */
export function isAmbiguousMutationError(error: unknown): boolean {
  for (const node of walkCauses(error)) {
    if (
      typeof node === 'object' &&
      node !== null &&
      'retryable' in node &&
      (node as { retryable: unknown }).retryable === true
    ) {
      return true;
    }
    if (node instanceof Error && messageLooksAmbiguous(node.message)) {
      return true;
    }
    if (typeof node === 'string' && messageLooksAmbiguous(node)) {
      return true;
    }
  }
  return false;
}
