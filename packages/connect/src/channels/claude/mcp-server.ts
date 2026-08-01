/**
 * Creates an MCP server that exposes ConnectAdapter methods as tools.
 * The server is transport-agnostic — the consumer connects it to stdio, SSE, etc.
 *
 * Live mode: create_booking / request_ticketing / cancel_booking require a
 * bound approval token (createHmac + durable single-use consume) before the
 * adapter is called (DoD 6). Tokens bind to tool name + args so a ticket
 * approval cannot authorize cancel (and vice versa).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  CasBoundApprovalTokenStore,
  consumeBoundApprovalToken,
  createBoundApprovalPolicy,
  FileCompareAndSwapPersistenceAdapter,
  isLiveModeFromEnv,
  LiveSafetyError,
  type BoundApprovalTokenStore,
} from '@otaip/core';
import { tmpdir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import type {
  ConnectAdapter,
  CreateBookingInput,
  PassengerCount,
  SearchFlightsInput,
  WhiteLabelConfig,
} from '../../types.js';
import { generateMcpTools } from './tool-generator.js';

const MUTATION_TOOLS = new Set(['create_booking', 'request_ticketing', 'cancel_booking']);

/** Reserved key in approval input hash — binds token to the MCP tool name. */
export const MCP_APPROVAL_TOOL_KEY = 'mcpTool' as const;

/**
 * Canonical input for {@link issueBoundApprovalToken} / live MCP validation.
 * Includes tool name so ticketing and cancel tokens for the same bookingId
 * cannot be cross-used.
 */
export function mcpMutationApprovalInput(
  toolName: string,
  args: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...(args ?? {}) };
  delete rest['approvalToken'];
  delete rest[MCP_APPROVAL_TOOL_KEY];
  return { [MCP_APPROVAL_TOOL_KEY]: toolName, ...rest };
}

export interface McpServerConfig {
  serverName: string;
  serverDescription?: string;
  version: string;
  whiteLabel?: WhiteLabelConfig;
  /**
   * Override live detection. Default: isLiveModeFromEnv().
   * Live mutations require approvalToken + OTAIP_APPROVAL_SECRET.
   */
  liveMode?: boolean;
  /** HMAC secret. Defaults to OTAIP_APPROVAL_SECRET. */
  approvalSecret?: string;
  /**
   * Durable token store for live single-use.
   * Live mode: inject this, or set OTAIP_MCP_APPROVAL_STORE_PATH (persistent path).
   * Paths under os.tmpdir() are refused.
   */
  approvalTokenStore?: BoundApprovalTokenStore;
  /** Session id bound into approval tokens. Default: mcp-session. */
  sessionId?: string;
  /** Agent id bound into approval tokens. Default: mcp-connect. */
  agentId?: string;
}

function arg<T>(args: Record<string, unknown> | undefined, key: string): T {
  return (args ?? {})[key] as T;
}

function argsAs<T>(args: Record<string, unknown> | undefined): T {
  return (args ?? {}) as unknown as T;
}

function isUnderTmpdir(filePath: string): boolean {
  const resolved = resolve(filePath);
  const tmp = resolve(tmpdir());
  return resolved === tmp || resolved.startsWith(tmp + '/');
}

function approvalStoreFromEnvPath(): BoundApprovalTokenStore {
  const raw = (process.env['OTAIP_MCP_APPROVAL_STORE_PATH'] ?? '').trim();
  if (!raw) {
    throw new LiveSafetyError(
      'MCP live mode requires approvalTokenStore or OTAIP_MCP_APPROVAL_STORE_PATH ' +
        '(persistent path). No tmpdir fallback.',
    );
  }
  const filePath = isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
  if (isUnderTmpdir(filePath)) {
    throw new LiveSafetyError(
      'MCP live mode refuses approval store under os.tmpdir() — set OTAIP_MCP_APPROVAL_STORE_PATH to a persistent path',
    );
  }
  return new CasBoundApprovalTokenStore(new FileCompareAndSwapPersistenceAdapter(filePath));
}

function toolError(message: string): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

export function generateMcpServer(adapter: ConnectAdapter, config: McpServerConfig): Server {
  const server = new Server(
    { name: config.serverName, version: config.version },
    { capabilities: { tools: {} } },
  );

  const liveMode = config.liveMode ?? isLiveModeFromEnv();
  const approvalSecret =
    (config.approvalSecret ?? process.env['OTAIP_APPROVAL_SECRET'] ?? '').trim() || undefined;
  const sessionId = config.sessionId ?? 'mcp-session';
  const agentId = config.agentId ?? 'mcp-connect';
  let approvalTokenStore = config.approvalTokenStore;
  if (liveMode && !approvalTokenStore) {
    approvalTokenStore = approvalStoreFromEnvPath();
  }

  if (liveMode && approvalTokenStore && approvalTokenStore.durability === 'ephemeral') {
    throw new LiveSafetyError(
      'MCP live mode refuses ephemeral BoundApprovalTokenStore — inject CasBoundApprovalTokenStore with durable CAS',
    );
  }

  const tools = generateMcpTools(adapter, config.whiteLabel, { liveMode });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (MUTATION_TOOLS.has(name) && liveMode) {
        if (!approvalSecret) {
          return toolError(
            'Live mode requires OTAIP_APPROVAL_SECRET (or approvalSecret) for MCP mutation tools',
          );
        }
        if (!approvalTokenStore) {
          return toolError('Live mode requires a durable BoundApprovalTokenStore');
        }
        const token = args?.['approvalToken'];
        if (typeof token !== 'string' || token.length === 0) {
          return toolError('Approval token is missing or empty');
        }
        const expectedInput = mcpMutationApprovalInput(name, args as Record<string, unknown>);
        const policy = createBoundApprovalPolicy({
          secret: approvalSecret,
          store: approvalTokenStore,
          sessionId,
          agentId,
          expectedInput,
        });
        const structural = policy.validateApprovalToken?.(token, 'mutation_irreversible');
        if (!structural?.ok) {
          const msg =
            structural && !structural.ok
              ? (structural.issues[0]?.message ?? 'Approval token invalid')
              : 'Approval token invalid';
          return toolError(msg);
        }
        const consumed = await consumeBoundApprovalToken(token, approvalSecret, approvalTokenStore);
        if (!consumed.ok) {
          const msg =
            !consumed.ok
              ? (consumed.issues[0]?.message ?? 'Approval token rejected')
              : 'Approval token rejected';
          return toolError(msg);
        }
      }

      let result: unknown;

      switch (name) {
        case 'search_flights':
          result = await adapter.searchFlights(argsAs<SearchFlightsInput>(args));
          break;

        case 'price_itinerary':
          result = await adapter.priceItinerary(
            arg<string>(args, 'offerId'),
            arg<PassengerCount>(args, 'passengers'),
          );
          break;

        case 'create_booking': {
          const bookingArgs = { ...(args ?? {}) };
          delete bookingArgs['approvalToken'];
          result = await adapter.createBooking(argsAs<CreateBookingInput>(bookingArgs));
          break;
        }

        case 'get_booking':
          result = await adapter.getBookingStatus(arg<string>(args, 'bookingId'));
          break;

        case 'request_ticketing':
          if (!adapter.requestTicketing) {
            return toolError('Ticketing is not supported by this supplier.');
          }
          result = await adapter.requestTicketing(arg<string>(args, 'bookingId'));
          break;

        case 'cancel_booking':
          if (!adapter.cancelBooking) {
            return toolError('Cancellation is not supported by this supplier.');
          }
          result = await adapter.cancelBooking(arg<string>(args, 'bookingId'));
          break;

        case 'health_check':
          result = await adapter.healthCheck();
          break;

        default:
          return toolError(`Unknown tool: ${name}`);
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(message);
    }
  });

  return server;
}
