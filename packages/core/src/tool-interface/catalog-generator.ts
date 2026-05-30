/**
 * Agent catalog generator.
 *
 * Generates LLM tool definitions from `AgentContract` Zod schemas.
 * Three output formats:
 *  - Claude MCP tool definitions
 *  - OpenAI function definitions (strict mode, draft-7)
 *  - Standalone JSON Schema catalog
 *
 * All schemas come from `zodToJsonSchema()` — no hand-written JSON.
 */

import { zodToJsonSchema, type JSONSchema } from '../pipeline-validator/schema-bridge.js';
import type { AgentContract } from '../pipeline-validator/types.js';
import { AGENT_TOOL_NAMES } from './agent-tool-bridge.js';

// ─────────────────────────────────────────────────────────────────────────────
// Output shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface McpToolEntry {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JSONSchema;
}

export interface OpenAiFunctionEntry {
  readonly name: string;
  readonly description: string;
  readonly parameters: JSONSchema;
  readonly strict: boolean;
}

export interface CatalogEntry {
  readonly input: JSONSchema;
  readonly output: JSONSchema;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generators
// ─────────────────────────────────────────────────────────────────────────────

function resolveName(agentId: string, names?: Readonly<Record<string, string>>): string {
  return names?.[agentId] ?? AGENT_TOOL_NAMES[agentId] ?? agentId.replace(/\./g, '_');
}

function resolveDescription(contract: AgentContract): string {
  return contract.description ?? `OTAIP agent ${contract.agentId} (${contract.actionType})`;
}

/**
 * Generate Claude MCP tool definitions.
 *
 * Output shape matches `McpToolDefinition` from the existing MCP
 * channel generator in `@otaip/connect`.
 */
export function generateMcpTools(
  contracts: readonly AgentContract[],
  names?: Readonly<Record<string, string>>,
): McpToolEntry[] {
  return contracts.map((c) => ({
    name: resolveName(c.agentId, names),
    description: resolveDescription(c),
    inputSchema: zodToJsonSchema(c.inputSchema),
  }));
}

/**
 * Generate OpenAI function-calling definitions.
 *
 * Uses `draft-7` target because OpenAI function calling requires
 * JSON Schema draft-7. Enables `strict: true` for all functions.
 */
export function generateOpenAiFunctions(
  contracts: readonly AgentContract[],
  names?: Readonly<Record<string, string>>,
): OpenAiFunctionEntry[] {
  return contracts.map((c) => ({
    name: resolveName(c.agentId, names),
    description: resolveDescription(c),
    parameters: zodToJsonSchema(c.inputSchema, { target: 'draft-7' }),
    strict: true,
  }));
}

/**
 * Generate a standalone JSON Schema catalog keyed by agent ID.
 *
 * Includes both input and output schemas — useful for documentation,
 * code generation, and any LLM framework not covered by the
 * MCP / OpenAI specific generators.
 */
export function generateCatalog(
  contracts: readonly AgentContract[],
): Record<string, CatalogEntry> {
  const result: Record<string, CatalogEntry> = {};
  for (const c of contracts) {
    result[c.agentId] = {
      input: zodToJsonSchema(c.inputSchema),
      output: zodToJsonSchema(c.outputSchema),
    };
  }
  return result;
}
