/**
 * Built-in orchestrator workflow pipelines.
 *
 * Kept in a dedicated module so tooling (agent graph generator) can import
 * the same source of truth the OrchestratorAgent executes — no duplicated
 * agent-id sequences.
 */

import type { WorkflowName } from './types.js';

/** Ordered agent ids for each built-in workflow name. */
export const WORKFLOW_PIPELINES: Record<WorkflowName, readonly string[]> = {
  search_to_price: ['1.1', '1.4', '2.1', '2.2', '2.3'],
  book_to_ticket: ['3.3', '3.1', '3.2', '4.1'],
  full_booking: ['1.1', '1.4', '2.1', '2.2', '2.3', '3.3', '3.1', '3.2', '4.1'],
  exchange_flow: ['5.1', '5.2'],
  refund_flow: ['6.1', '6.2'],
};
