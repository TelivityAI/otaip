import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { PipelineOrchestrator } from '../orchestrator.js';
import type { Agent } from '../../types/agent.js';
import type { AgentContract, ReferenceDataProvider } from '../types.js';
import {
  InMemoryBoundApprovalTokenStore,
  issueBoundApprovalToken,
} from '../../approval/bound-approval.js';

const emptyReference: ReferenceDataProvider = {
  async resolveAirport() {
    return null;
  },
  async resolveAirline() {
    return null;
  },
  async decodeFareBasis() {
    return null;
  },
};

describe('approval before execute (DoD 6)', () => {
  it('does not call execute when approval fails', async () => {
    const execute = vi.fn(async () => ({ data: {}, confidence: 1 }));
    const contract: AgentContract = {
      agentId: 'irrev',
      inputSchema: z.object({ approvalToken: z.string().optional() }).passthrough(),
      outputSchema: z.object({}).passthrough(),
      actionType: 'mutation_irreversible',
      confidenceThreshold: 0.95,
      intentRelevance: ['test'],
      outputContract: [],
      async validate() {
        return { ok: true, warnings: [] };
      },
    };
    const agent = {
      id: 'irrev',
      name: 'irrev',
      version: '1',
      async initialize() {},
      async health() {
        return { status: 'healthy' as const };
      },
      execute,
    } satisfies Agent;

    const orch = new PipelineOrchestrator({
      reference: emptyReference,
      contracts: new Map([['irrev', contract]]),
      agents: new Map([['irrev', agent]]),
      liveMode: false,
    });
    const session = orch.createSession({
      type: 'test',
      origin: 'JFK',
      destination: 'LHR',
      outboundDate: '2026-05-01',
      passengerCount: 1,
    });

    const result = await orch.runAgent(session, 'irrev', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('action_class_blocked');
    expect(execute).not.toHaveBeenCalled();
  });

  it('live mode consumes single-use HMAC token before execute', async () => {
    const execute = vi.fn(async () => ({ data: { ok: true }, confidence: 1 }));
    const store = new InMemoryBoundApprovalTokenStore();
    const secret = 'live-secret';
    const contract: AgentContract = {
      agentId: 'irrev',
      inputSchema: z.object({ x: z.number(), approvalToken: z.string().optional() }),
      outputSchema: z.object({ ok: z.boolean() }),
      actionType: 'mutation_irreversible',
      confidenceThreshold: 0.95,
      intentRelevance: ['test'],
      outputContract: [],
      async validate() {
        return { ok: true, warnings: [] };
      },
    };
    const agent = {
      id: 'irrev',
      name: 'irrev',
      version: '1',
      async initialize() {},
      async health() {
        return { status: 'healthy' as const };
      },
      execute,
    } satisfies Agent;

    const orch = new PipelineOrchestrator({
      reference: emptyReference,
      contracts: new Map([['irrev', contract]]),
      agents: new Map([['irrev', agent]]),
      liveMode: true,
      approvalSecret: secret,
      approvalTokenStore: store,
    });
    const session = orch.createSession({
      type: 'test',
      origin: 'JFK',
      destination: 'LHR',
      outboundDate: '2026-05-01',
      passengerCount: 1,
    });

    const input = { x: 1 };
    const token = issueBoundApprovalToken({
      sessionId: session.sessionId,
      agentId: 'irrev',
      input,
      secret,
    });

    const ok = await orch.runAgent(session, 'irrev', { ...input, approvalToken: token });
    expect(ok.ok).toBe(true);
    expect(execute).toHaveBeenCalledOnce();

    // Replay same token must fail and not execute again
    execute.mockClear();
    const replay = await orch.runAgent(session, 'irrev', {
      ...input,
      approvalToken: token,
    });
    expect(replay.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('live mode without approval secret refuses irreversible', async () => {
    const execute = vi.fn(async () => ({ data: {}, confidence: 1 }));
    const contract: AgentContract = {
      agentId: 'irrev',
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({}).passthrough(),
      actionType: 'mutation_irreversible',
      confidenceThreshold: 0.95,
      intentRelevance: ['test'],
      outputContract: [],
      async validate() {
        return { ok: true, warnings: [] };
      },
    };
    const agent = {
      id: 'irrev',
      name: 'irrev',
      version: '1',
      async initialize() {},
      async health() {
        return { status: 'healthy' as const };
      },
      execute,
    } satisfies Agent;

    const orch = new PipelineOrchestrator({
      reference: emptyReference,
      contracts: new Map([['irrev', contract]]),
      agents: new Map([['irrev', agent]]),
      liveMode: true,
      approvalSecret: '',
    });
    const session = orch.createSession({
      type: 'test',
      origin: 'JFK',
      destination: 'LHR',
      outboundDate: '2026-05-01',
      passengerCount: 1,
    });
    const result = await orch.runAgent(session, 'irrev', {});
    expect(result.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
