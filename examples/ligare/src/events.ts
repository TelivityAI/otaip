/**
 * Tool-call event capture for Ligare.
 *
 * Records every ChatGPT Action call — the structured params + a non-PII outcome
 * summary — for product analytics and training data. Note: ChatGPT only sends
 * the *structured* call (e.g. origin/destination/date), never the user's raw
 * sentence, so this captures intent-as-parameters, not natural language.
 *
 * Sink: Supabase (PostgREST) when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
 * set; otherwise appends to events.jsonl. Never throws — logging must never
 * break a tool call.
 */

import { appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateBookingInput } from '@otaip/connect';

const here = dirname(fileURLToPath(import.meta.url));
const EVENTS_FILE = join(here, '..', 'events.jsonl');

export type ToolName = 'searchFlights' | 'priceItinerary' | 'createBooking' | 'getBookingStatus';

export interface ToolCallEvent {
  tool: ToolName;
  sessionId?: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  status: 'ok' | 'error';
  error?: string;
  latencyMs: number;
}

/** Strip PII from a booking request — keep only the non-identifying shape. */
export function scrubBooking(input: CreateBookingInput): Record<string, unknown> {
  return {
    offerId: input.offerId,
    passengerCount: input.passengers.length,
    passengerTypes: input.passengers.map((p) => p.type),
  };
}

export async function logToolCall(event: ToolCallEvent): Promise<void> {
  const row = {
    ts: new Date().toISOString(),
    tool: event.tool,
    session_id: event.sessionId ?? null,
    request: event.request,
    response: event.response,
    status: event.status,
    error: event.error ?? null,
    latency_ms: event.latencyMs,
  };

  try {
    const url = process.env['SUPABASE_URL'];
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    if (url && key) {
      const table = process.env['LIGARE_EVENTS_TABLE'] ?? 'ligare_tool_calls';
      await fetch(`${url}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(row),
      });
      return;
    }
    await appendFile(EVENTS_FILE, `${JSON.stringify(row)}\n`, 'utf8');
  } catch {
    // Logging must never break a tool call.
  }
}
