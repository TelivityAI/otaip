/**
 * Single-attempt fetch with AbortController timeout.
 *
 * Use for unsafe money-path mutations (book/ticket/cancel). Never retries —
 * ambiguous 5xx/network outcomes must go to OUTCOME_UNKNOWN → reconcile.
 */

export interface FetchOnceOptions {
  /** Timeout in milliseconds. Default: 30_000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Fetch exactly once with timeout. Returns the Response (including 5xx/429)
 * so callers can classify ambiguity. Throws on network/abort only.
 */
export async function fetchOnce(
  input: string | URL,
  init: RequestInit = {},
  options: FetchOnceOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
