/**
 * MCP live mutations require bound approval before adapter is called.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CasBoundApprovalTokenStore,
  FileCompareAndSwapPersistenceAdapter,
  issueBoundApprovalToken,
  LiveSafetyError,
} from '@otaip/core';
import type { ConnectAdapter } from '../../../types.js';
import { generateMcpServer } from '../mcp-server.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockAdapter(spies: {
  createBooking: ReturnType<typeof vi.fn>;
  cancelBooking: ReturnType<typeof vi.fn>;
}): ConnectAdapter {
  return {
    supplierId: 'mock',
    supplierName: 'Mock',
    async searchFlights() {
      return [];
    },
    async priceItinerary() {
      throw new Error('n/a');
    },
    createBooking: spies.createBooking,
    async getBookingStatus() {
      throw new Error('n/a');
    },
    requestTicketing: vi.fn(async () => ({
      bookingId: 'B1',
      supplier: 'mock',
      status: 'ticketed' as const,
      segments: [],
      passengers: [],
      totalPrice: { amount: '1', currency: 'USD' },
    })),
    cancelBooking: spies.cancelBooking,
    async healthCheck() {
      return { healthy: true, latencyMs: 1 };
    },
  };
}

async function withClient(
  adapter: ConnectAdapter,
  config: Parameters<typeof generateMcpServer>[1],
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const server = generateMcpServer(adapter, config);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe('MCP live approval gate', () => {
  it('refuses create_booking without token in live mode — adapter not called', async () => {
    const createBooking = vi.fn(async () => ({ bookingId: 'B1' }));
    const cancelBooking = vi.fn(async () => ({ success: true, message: 'ok' }));
    const store = new CasBoundApprovalTokenStore(
      new FileCompareAndSwapPersistenceAdapter(
        join(mkdtempSync(join(tmpdir(), 'mcp-appr-')), 'jti.json'),
      ),
    );

    await withClient(
      mockAdapter({ createBooking, cancelBooking }),
      {
        serverName: 'test',
        version: '1',
        liveMode: true,
        approvalSecret: 'live-secret',
        approvalTokenStore: store,
        sessionId: 'mcp-session',
        agentId: 'mcp-connect',
      },
      async (client) => {
        const result = await client.callTool({
          name: 'create_booking',
          arguments: {
            offerId: 'off_1',
            passengers: [
              {
                type: 'adult',
                gender: 'M',
                firstName: 'A',
                lastName: 'B',
                dateOfBirth: '1990-01-01',
              },
            ],
            contact: { email: 'a@b.com', phone: '+1' },
            idempotencyKey: 'k1',
          },
        });
        expect(result.isError).toBe(true);
        const content = result.content as Array<{ type: string; text: string }>;
        expect(content[0]!.text).toMatch(/approval/i);
        expect(createBooking).not.toHaveBeenCalled();
      },
    );
  });

  it('refuses forged token — adapter not called', async () => {
    const createBooking = vi.fn(async () => ({ bookingId: 'B1' }));
    const cancelBooking = vi.fn(async () => ({ success: true, message: 'ok' }));
    const store = new CasBoundApprovalTokenStore(
      new FileCompareAndSwapPersistenceAdapter(
        join(mkdtempSync(join(tmpdir(), 'mcp-appr-')), 'jti.json'),
      ),
    );

    await withClient(
      mockAdapter({ createBooking, cancelBooking }),
      {
        serverName: 'test',
        version: '1',
        liveMode: true,
        approvalSecret: 'live-secret',
        approvalTokenStore: store,
      },
      async (client) => {
        const result = await client.callTool({
          name: 'cancel_booking',
          arguments: {
            bookingId: 'B1',
            approvalToken: 'v1.forged.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
          },
        });
        expect(result.isError).toBe(true);
        expect(cancelBooking).not.toHaveBeenCalled();
      },
    );
  });

  it('accepts valid token once; replay rejected', async () => {
    const createBooking = vi.fn(async () => ({
      bookingId: 'B1',
      supplier: 'mock',
      status: 'confirmed' as const,
      segments: [],
      passengers: [],
      totalPrice: { amount: '1', currency: 'USD' },
    }));
    const cancelBooking = vi.fn(async () => ({ success: true, message: 'ok' }));
    const store = new CasBoundApprovalTokenStore(
      new FileCompareAndSwapPersistenceAdapter(
        join(mkdtempSync(join(tmpdir(), 'mcp-appr-')), 'jti.json'),
      ),
    );
    const secret = 'live-secret';
    const sessionId = 'mcp-session';
    const agentId = 'mcp-connect';

    await withClient(
      mockAdapter({ createBooking, cancelBooking }),
      {
        serverName: 'test',
        version: '1',
        liveMode: true,
        approvalSecret: secret,
        approvalTokenStore: store,
        sessionId,
        agentId,
      },
      async (client) => {
        const input = {
          offerId: 'off_1',
          passengers: [
            {
              type: 'adult' as const,
              gender: 'M' as const,
              firstName: 'A',
              lastName: 'B',
              dateOfBirth: '1990-01-01',
            },
          ],
          contact: { email: 'a@b.com', phone: '+1' },
          idempotencyKey: 'k1',
        };
        const token = issueBoundApprovalToken({
          sessionId,
          agentId,
          input,
          secret,
        });

        const ok = await client.callTool({
          name: 'create_booking',
          arguments: { ...input, approvalToken: token },
        });
        expect(ok.isError).toBeFalsy();
        expect(createBooking).toHaveBeenCalledOnce();

        createBooking.mockClear();
        const replay = await client.callTool({
          name: 'create_booking',
          arguments: { ...input, approvalToken: token },
        });
        expect(replay.isError).toBe(true);
        expect(createBooking).not.toHaveBeenCalled();
      },
    );
  });

  it('live mode without store or OTAIP_MCP_APPROVAL_STORE_PATH throws at construction', () => {
    const prev = process.env['OTAIP_MCP_APPROVAL_STORE_PATH'];
    delete process.env['OTAIP_MCP_APPROVAL_STORE_PATH'];
    try {
      expect(() =>
        generateMcpServer(mockAdapter({ createBooking: vi.fn(), cancelBooking: vi.fn() }), {
          serverName: 'test',
          version: '1',
          liveMode: true,
          approvalSecret: 'live-secret',
        }),
      ).toThrow(LiveSafetyError);
    } finally {
      if (prev !== undefined) process.env['OTAIP_MCP_APPROVAL_STORE_PATH'] = prev;
      else delete process.env['OTAIP_MCP_APPROVAL_STORE_PATH'];
    }
  });

  it('live mode refuses approval store path under os.tmpdir()', () => {
    const prev = process.env['OTAIP_MCP_APPROVAL_STORE_PATH'];
    const underTmp = join(mkdtempSync(join(tmpdir(), 'mcp-bad-')), 'jti.json');
    process.env['OTAIP_MCP_APPROVAL_STORE_PATH'] = underTmp;
    try {
      expect(() =>
        generateMcpServer(mockAdapter({ createBooking: vi.fn(), cancelBooking: vi.fn() }), {
          serverName: 'test',
          version: '1',
          liveMode: true,
          approvalSecret: 'live-secret',
        }),
      ).toThrow(/tmpdir/i);
    } finally {
      if (prev !== undefined) process.env['OTAIP_MCP_APPROVAL_STORE_PATH'] = prev;
      else delete process.env['OTAIP_MCP_APPROVAL_STORE_PATH'];
    }
  });

  it('restart-replay: consumed jti refused on fresh store sharing persistent path', async () => {
    const persistentDir = join(process.cwd(), '.tmp-mcp-appr-test');
    mkdirSync(persistentDir, { recursive: true });
    const storePath = join(persistentDir, `jti-${Date.now()}.json`);
    const secret = 'live-secret';
    const sessionId = 'mcp-session';
    const agentId = 'mcp-connect';
    const input = {
      offerId: 'off_1',
      passengers: [
        {
          type: 'adult' as const,
          gender: 'M' as const,
          firstName: 'A',
          lastName: 'B',
          dateOfBirth: '1990-01-01',
        },
      ],
      contact: { email: 'a@b.com', phone: '+1' },
      idempotencyKey: 'k-restart',
    };
    const token = issueBoundApprovalToken({ sessionId, agentId, input, secret });

    const storeA = new CasBoundApprovalTokenStore(
      new FileCompareAndSwapPersistenceAdapter(storePath),
    );
    const createBooking = vi.fn(async () => ({
      bookingId: 'B1',
      supplier: 'mock',
      status: 'confirmed' as const,
      segments: [],
      passengers: [],
      totalPrice: { amount: '1', currency: 'USD' },
    }));

    await withClient(
      mockAdapter({ createBooking, cancelBooking: vi.fn() }),
      {
        serverName: 'test',
        version: '1',
        liveMode: true,
        approvalSecret: secret,
        approvalTokenStore: storeA,
        sessionId,
        agentId,
      },
      async (client) => {
        const ok = await client.callTool({
          name: 'create_booking',
          arguments: { ...input, approvalToken: token },
        });
        expect(ok.isError).toBeFalsy();
      },
    );

    createBooking.mockClear();
    const storeB = new CasBoundApprovalTokenStore(
      new FileCompareAndSwapPersistenceAdapter(storePath),
    );
    await withClient(
      mockAdapter({ createBooking, cancelBooking: vi.fn() }),
      {
        serverName: 'test',
        version: '1',
        liveMode: true,
        approvalSecret: secret,
        approvalTokenStore: storeB,
        sessionId,
        agentId,
      },
      async (client) => {
        const replay = await client.callTool({
          name: 'create_booking',
          arguments: { ...input, approvalToken: token },
        });
        expect(replay.isError).toBe(true);
        expect(createBooking).not.toHaveBeenCalled();
      },
    );
  });
});
