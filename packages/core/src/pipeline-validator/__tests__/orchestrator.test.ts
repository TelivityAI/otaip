import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Agent } from '../../types/agent.js';
import { PipelineOrchestrator, classifyFailure } from '../orchestrator.js';
import type { RunAgentFailureReason } from '../orchestrator.js';
import type { AgentContract, ReferenceDataProvider } from '../types.js';

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

function mkEchoAgent<TIn, TOut>(
  id: string,
  transform: (input: TIn) => TOut,
  confidence = 1.0,
): Agent<TIn, TOut> {
  return {
    id,
    name: id,
    version: '0.0.1',
    async initialize() {},
    async execute(input) {
      return { data: transform(input.data), confidence };
    },
    async health() {
      return { status: 'healthy' };
    },
  };
}

describe('PipelineOrchestrator', () => {
  it('runs a contracted agent through all gates and records invocation', async () => {
    const contract: AgentContract = {
      agentId: 'echo',
      inputSchema: z.object({ msg: z.string() }),
      outputSchema: z.object({ out: z.string() }),
      actionType: 'query',
      confidenceThreshold: 0.7,
      outputContract: ['out'],
      async validate() {
        return { ok: true, warnings: [] };
      },
    };
    const agent = mkEchoAgent<{ msg: string }, { out: string }>('echo', (i) => ({
      out: i.msg.toUpperCase(),
    }));
    const orch = new PipelineOrchestrator({
      reference: emptyReference,
      contracts: new Map([['echo', contract]]),
      agents: new Map([['echo', agent as Agent]]),
    });
    const session = orch.createSession({
      type: 'test',
      origin: 'JFK',
      destination: 'LHR',
      outboundDate: '2026-05-01',
      passengerCount: 1,
    });
    const result = await orch.runAgent(session, 'echo', { msg: 'hi' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.data).toEqual({ out: 'HI' });
      expect(session.history).toHaveLength(1);
      expect(session.contractState.get('echo')).toEqual({ out: 'HI' });
      // All six logical gates fire at least once.
      const gates = result.invocation.gateResults.map((g) => g.gate);
      expect(gates).toContain('intent_lock');
      expect(gates).toContain('schema_in');
      expect(gates).toContain('semantic_in');
      expect(gates).toContain('cross_agent');
      expect(gates).toContain('schema_out');
      expect(gates).toContain('confidence');
      expect(gates).toContain('action_class');
    }
  });

  it('rejects at schema_in when input is wrong shape', async () => {
    const contract: AgentContract = {
      agentId: 'echo',
      inputSchema: z.object({ msg: z.string() }),
      outputSchema: z.object({ out: z.string() }),
      actionType: 'query',
      confidenceThreshold: 0.7,
      outputContract: [],
      async validate() {
        return { ok: true, warnings: [] };
      },
    };
    const agent = mkEchoAgent<{ msg: string }, { out: string }>('echo', (i) => ({
      out: i.msg,
    }));
    const orch = new PipelineOrchestrator({
      reference: emptyReference,
      contracts: new Map([['echo', contract]]),
      agents: new Map([['echo', agent as Agent]]),
    });
    const session = orch.createSession({
      type: 'test',
      origin: 'JFK',
      destination: 'LHR',
      outboundDate: '2026-05-01',
      passengerCount: 1,
    });
    const result = await orch.runAgent(session, 'echo', { wrong: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('schema_invalid');
      expect(result.failureClass).toBe('validation');
    }
  });

  it('rejects at low_confidence when output confidence is below threshold', async () => {
    const contract: AgentContract = {
      agentId: 'low',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      actionType: 'query',
      confidenceThreshold: 0.9,
      outputContract: [],
      async validate() {
        return { ok: true, warnings: [] };
      },
    };
    const agent = mkEchoAgent('low', () => ({}), 0.5);
    const orch = new PipelineOrchestrator({
      reference: emptyReference,
      contracts: new Map([['low', contract]]),
      agents: new Map([['low', agent as Agent]]),
    });
    const session = orch.createSession({
      type: 'test',
      origin: 'JFK',
      destination: 'LHR',
      outboundDate: '2026-05-01',
      passengerCount: 1,
    });
    const result = await orch.runAgent(session, 'low', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('low_confidence');
      expect(result.failureClass).toBe('validation');
    }
  });

  it('blocks mutation_irreversible without approval token', async () => {
    const contract: AgentContract = {
      agentId: 'irrev',
      inputSchema: z.object({ approvalToken: z.string().optional() }),
      outputSchema: z.object({}),
      actionType: 'mutation_irreversible',
      confidenceThreshold: 0.95,
      outputContract: [],
      async validate() {
        return { ok: true, warnings: [] };
      },
    };
    const agent = mkEchoAgent('irrev', () => ({}), 1.0);
    const orch = new PipelineOrchestrator({
      reference: emptyReference,
      contracts: new Map([['irrev', contract]]),
      agents: new Map([['irrev', agent as Agent]]),
    });
    const session = orch.createSession({
      type: 'test',
      origin: 'JFK',
      destination: 'LHR',
      outboundDate: '2026-05-01',
      passengerCount: 1,
    });
    const r1 = await orch.runAgent(session, 'irrev', {});
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.reason).toBe('action_class_blocked');
      expect(r1.failureClass).toBe('validation');
    }

    const r2 = await orch.runAgent(session, 'irrev', { approvalToken: 'tok' });
    expect(r2.ok).toBe(true);
  });

  it('refuses to construct when a contract declares a threshold below its floor', () => {
    const contract: AgentContract = {
      agentId: 'bad',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      actionType: 'mutation_irreversible',
      confidenceThreshold: 0.5, // below 0.95 floor
      outputContract: [],
      async validate() {
        return { ok: true, warnings: [] };
      },
    };
    expect(
      () =>
        new PipelineOrchestrator({
          reference: emptyReference,
          contracts: new Map([['bad', contract]]),
          agents: new Map(),
        }),
    ).toThrow(/floor/);
  });

  it('blocks fabricated cross-agent references', async () => {
    const search: AgentContract = {
      agentId: 'search',
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ offerId: z.string() }),
      actionType: 'query',
      confidenceThreshold: 0.7,
      outputContract: ['offerId'],
      async validate() {
        return { ok: true, warnings: [] };
      },
    };
    const price: AgentContract = {
      agentId: 'price',
      inputSchema: z.object({ offerId: z.string() }),
      outputSchema: z.object({ total: z.number() }),
      actionType: 'query',
      confidenceThreshold: 0.7,
      outputContract: ['total'],
      async validate() {
        return { ok: true, warnings: [] };
      },
    };
    const searchAgent = mkEchoAgent<{ q: string }, { offerId: string }>(
      'search',
      () => ({ offerId: 'real-offer' }),
    );
    const priceAgent = mkEchoAgent<{ offerId: string }, { total: number }>(
      'price',
      () => ({ total: 450 }),
    );
    const orch = new PipelineOrchestrator({
      reference: emptyReference,
      contracts: new Map<string, AgentContract>([
        ['search', search],
        ['price', price],
      ]),
      agents: new Map<string, Agent>([
        ['search', searchAgent as Agent],
        ['price', priceAgent as Agent],
      ]),
    });
    const session = orch.createSession({
      type: 'test',
      origin: 'JFK',
      destination: 'LHR',
      outboundDate: '2026-05-01',
      passengerCount: 1,
    });
    await orch.runAgent(session, 'search', { q: 'JFK-LHR' });
    const r = await orch.runAgent(session, 'price', { offerId: 'FABRICATED' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('cross_agent_inconsistent');
      expect(r.failureClass).toBe('validation');
    }
  });
});

describe('classifyFailure', () => {
  // Exhaustive table — guards the infra/execution/validation split that lets
  // consumers (and eval oracles) avoid scoring a setup error as a model failure.
  const cases: ReadonlyArray<[RunAgentFailureReason, 'infra' | 'execution' | 'validation']> = [
    ['contract_missing', 'infra'],
    ['agent_missing', 'infra'],
    ['agent_error', 'execution'],
    ['intent_lock', 'validation'],
    ['schema_invalid', 'validation'],
    ['semantic_invalid', 'validation'],
    ['cross_agent_inconsistent', 'validation'],
    ['schema_out_invalid', 'validation'],
    ['low_confidence', 'validation'],
    ['action_class_blocked', 'validation'],
  ];
  for (const [reason, expected] of cases) {
    it(`classifies ${reason} as ${expected}`, () => {
      expect(classifyFailure(reason)).toBe(expected);
    });
  }
});

describe('PipelineOrchestrator — failure classification on runAgent', () => {
  const baseIntent = {
    type: 'test',
    origin: 'JFK',
    destination: 'LHR',
    outboundDate: '2026-05-01',
    passengerCount: 1,
  };

  it('reports infra (not validation) when no contract is registered', async () => {
    const orch = new PipelineOrchestrator({
      reference: emptyReference,
      contracts: new Map(),
      agents: new Map(),
    });
    const session = orch.createSession(baseIntent);
    const r = await orch.runAgent(session, 'nope', {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('contract_missing');
      expect(r.failureClass).toBe('infra');
    }
  });

  it('reports infra when the contract exists but the agent is not wired', async () => {
    const contract: AgentContract = {
      agentId: 'orphan',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      actionType: 'query',
      confidenceThreshold: 0.7,
      outputContract: [],
      async validate() {
        return { ok: true, warnings: [] };
      },
    };
    const orch = new PipelineOrchestrator({
      reference: emptyReference,
      contracts: new Map([['orphan', contract]]),
      agents: new Map(),
    });
    const session = orch.createSession(baseIntent);
    const r = await orch.runAgent(session, 'orphan', {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('agent_missing');
      expect(r.failureClass).toBe('infra');
    }
  });

  it('reports execution (not validation) when the agent throws', async () => {
    const contract: AgentContract = {
      agentId: 'boom',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      actionType: 'query',
      confidenceThreshold: 0.7,
      outputContract: [],
      async validate() {
        return { ok: true, warnings: [] };
      },
    };
    const throwingAgent: Agent<unknown, unknown> = {
      id: 'boom',
      name: 'boom',
      version: '0.0.1',
      async initialize() {},
      async execute() {
        throw new Error('downstream source exploded');
      },
      async health() {
        return { status: 'healthy' };
      },
    };
    const orch = new PipelineOrchestrator({
      reference: emptyReference,
      contracts: new Map([['boom', contract]]),
      agents: new Map([['boom', throwingAgent as Agent]]),
      retryBudget: 0,
    });
    const session = orch.createSession(baseIntent);
    const r = await orch.runAgent(session, 'boom', {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('agent_error');
      expect(r.failureClass).toBe('execution');
    }
  });
});
