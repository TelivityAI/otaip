/**
 * PipelineOrchestrator — the session manager.
 *
 * Creates pipeline sessions, runs contracted agents through the six gates,
 * enforces the per-gate retry budget, and appends each invocation to the
 * session history.
 *
 * Composition:
 *   - Does NOT wrap @otaip/core's AgentLoop (that's message-based).
 *   - Calls agent.execute() directly via runGates().
 *   - The Sprint B tool bridge will expose each contracted agent as a
 *     ToolDefinition whose execute() delegates to orchestrator.runAgent().
 */

import type { z } from 'zod';
import type { Agent, AgentOutput } from '../types/agent.js';
import { validateThresholdAgainstFloor } from './confidence-gate.js';
import {
  type GateRunResult,
  makeInvocation,
  runGates,
} from './validator.js';
import type { ApprovalPolicy } from './action-classifier.js';
import type { MutationKillSwitch } from '../safety/mutation-kill-switch.js';
import type {
  AgentContract,
  AgentInvocation,
  GateResult,
  PipelineIntent,
  PipelineSession,
  ReferenceDataProvider,
  SemanticIssue,
} from './types.js';

export interface PipelineOrchestratorConfig {
  readonly reference: ReferenceDataProvider;
  readonly contracts: ReadonlyMap<string, AgentContract>;
  readonly agents: ReadonlyMap<string, Agent>;
  /**
   * Max retries per (agentId, gate) combo. Only `agent_error` (execute
   * failures) trigger retries; gate failures are terminal for the given
   * input. Default: 3 per the master plan.
   */
  readonly retryBudget?: number;
  /** Set of agent ids that should be treated as reference-data agents. */
  readonly referenceAgentIds?: ReadonlySet<string>;
  readonly approvalPolicy?: ApprovalPolicy;
  /**
   * When an agent id is known to be a mutation but has no contract, fail with
   * `uncontracted_mutation` (DoD 6). Defaults to treating any missing contract
   * for ids in this set as uncontracted mutations.
   */
  readonly mutationAgentIds?: ReadonlySet<string>;
  /** Optional kill switch — blocks irreversible/mutation runs when engaged. */
  readonly killSwitch?: MutationKillSwitch;
  /** Clock injection for tests. */
  readonly now?: () => Date;
  /** Deterministic id source for sessions/invocations (tests). */
  readonly idFactory?: () => string;
}

export type RunAgentFailureReason =
  | 'contract_missing'
  | 'uncontracted_mutation'
  | 'agent_missing'
  | 'intent_lock'
  | 'schema_invalid'
  | 'semantic_invalid'
  | 'cross_agent_inconsistent'
  | 'agent_error'
  | 'schema_out_invalid'
  | 'low_confidence'
  | 'action_class_blocked'
  | 'kill_switch';

/**
 * The kind of thing that went wrong, so a consumer can never confuse an
 * infrastructure problem with a genuine validation rejection.
 *
 *  - `infra`      — the agent or its contract isn't registered. OTAIP was not
 *                   wired to validate this call; **nothing was actually
 *                   validated**. An eval/oracle must treat this as a setup
 *                   error, not as a model/data failure.
 *  - `execution`  — the agent threw while running (after its input gates
 *                   passed). The fault is in the agent or a downstream source.
 *  - `validation` — a contract gate genuinely rejected the input or output.
 *                   This is the only class that reflects on the data/model.
 */
export type FailureClass = 'infra' | 'execution' | 'validation';

/**
 * Map a {@link RunAgentFailureReason} to its {@link FailureClass}.
 *
 * Exhaustive over the union — adding a new reason without classifying it is a
 * compile error, by design.
 */
export function classifyFailure(reason: RunAgentFailureReason): FailureClass {
  switch (reason) {
    case 'contract_missing':
    case 'agent_missing':
      return 'infra';
    case 'agent_error':
      return 'execution';
    case 'intent_lock':
    case 'schema_invalid':
    case 'semantic_invalid':
    case 'cross_agent_inconsistent':
    case 'schema_out_invalid':
    case 'low_confidence':
    case 'action_class_blocked':
    case 'uncontracted_mutation':
    case 'kill_switch':
      return 'validation';
  }
}

export type RunAgentResult<TOut = unknown> =
  | {
      readonly ok: true;
      readonly output: AgentOutput<TOut>;
      readonly invocation: AgentInvocation;
    }
  | {
      readonly ok: false;
      readonly reason: RunAgentFailureReason;
      /**
       * Whether this failure is an infrastructure/registration problem, an
       * agent execution error, or a genuine contract-gate rejection. Derived
       * from `reason` via {@link classifyFailure}.
       */
      readonly failureClass: FailureClass;
      readonly issues: readonly SemanticIssue[];
      readonly invocation: AgentInvocation;
    };

/**
 * Orchestrates pipeline sessions. All state lives on the `PipelineSession`
 * objects returned by `createSession` — the orchestrator itself is stateless
 * across sessions, so a single orchestrator may serve many concurrent flows.
 */
export class PipelineOrchestrator {
  private readonly config: Required<
    Pick<PipelineOrchestratorConfig, 'reference' | 'contracts' | 'agents'>
  > &
    PipelineOrchestratorConfig;

  constructor(config: PipelineOrchestratorConfig) {
    // Validate contracts at construction time: each declared threshold must
    // meet the floor for its action type.
    for (const contract of config.contracts.values()) {
      const isRef = config.referenceAgentIds?.has(contract.agentId) ?? false;
      const check = validateThresholdAgainstFloor(
        contract.agentId,
        contract.confidenceThreshold,
        contract.actionType,
        isRef,
      );
      if (!check.ok) {
        throw new Error(
          `Contract registration failed: ${check.issues.map((i) => i.message).join('; ')}`,
        );
      }
    }
    this.config = {
      ...config,
      reference: config.reference,
      contracts: config.contracts,
      agents: config.agents,
    };
  }

  /** Open a new session with the given locked intent. */
  createSession(
    intent: Omit<PipelineIntent, 'lockedAt' | 'lockedBy'> & {
      lockedBy?: string;
    },
  ): PipelineSession {
    const now = this.now();
    const fullIntent: PipelineIntent = {
      ...intent,
      lockedAt: now.toISOString(),
      lockedBy: intent.lockedBy ?? 'default',
    };
    return {
      sessionId: this.nextId('sess'),
      intent: fullIntent,
      history: [],
      contractState: new Map(),
      retriesUsed: new Map(),
    };
  }

  /**
   * Run a contracted agent through the six gates. The invocation is always
   * appended to `session.history`, success or failure.
   */
  async runAgent<TOut = unknown>(
    session: PipelineSession,
    agentId: string,
    input: unknown,
  ): Promise<RunAgentResult<TOut>> {
    const contract = this.config.contracts.get(agentId) as
      | AgentContract<z.ZodType, z.ZodType>
      | undefined;
    const agent = this.config.agents.get(agentId);
    const startedAt = this.now();

    if (this.config.killSwitch?.isEngaged) {
      return this.recordFailure(session, agentId, startedAt, input, 'kill_switch', [
        {
          code: 'MUTATION_KILL_SWITCH',
          path: [],
          message: `Mutation kill switch engaged: ${this.config.killSwitch.engagedReason ?? 'unspecified'}`,
          severity: 'error',
        },
      ]);
    }

    if (contract === undefined) {
      const isMutation = this.config.mutationAgentIds?.has(agentId) ?? false;
      const reason: RunAgentFailureReason = isMutation
        ? 'uncontracted_mutation'
        : 'contract_missing';
      return this.recordFailure(session, agentId, startedAt, input, reason, [
        {
          code: isMutation ? 'UNCONTRACTED_MUTATION' : 'CONTRACT_MISSING',
          path: [],
          message: isMutation
            ? `Refusing uncontracted mutation agent '${agentId}'. Register an AgentContract before invoking.`
            : `No AgentContract registered for agentId '${agentId}'`,
          severity: 'error',
        },
      ]);
    }
    if (agent === undefined) {
      return this.recordFailure(session, agentId, startedAt, input, 'agent_missing', [
        {
          code: 'AGENT_MISSING',
          path: [],
          message: `No Agent registered for agentId '${agentId}'`,
          severity: 'error',
        },
      ]);
    }

    const retryBudget = this.config.retryBudget ?? 3;
    let attempt = 0;
    let lastResult: GateRunResult | undefined;

    while (attempt <= retryBudget) {
      const result = await runGates(contract, agent as Agent, input, session, {
        now: startedAt,
        reference: this.config.reference,
        approvalPolicy: this.config.approvalPolicy,
        isReferenceAgent:
          this.config.referenceAgentIds?.has(agentId) ?? false,
      });
      lastResult = result;
      if (result.ok) {
        const invocation = makeInvocation(
          this.nextId('inv'),
          agentId,
          startedAt,
          input,
          result,
          this.now(),
        );
        session.history.push(invocation);
        return {
          ok: true,
          output: result.output as AgentOutput<TOut>,
          invocation,
        };
      }
      // Only 'agent_error' is retryable.
      if (result.reason !== 'agent_error') break;
      attempt++;
      const key = `${agentId}:execute`;
      session.retriesUsed.set(key, (session.retriesUsed.get(key) ?? 0) + 1);
    }

    const finalResult = lastResult!;
    const invocation = makeInvocation(
      this.nextId('inv'),
      agentId,
      startedAt,
      input,
      finalResult,
      this.now(),
    );
    session.history.push(invocation);
    const reason = mapReason(finalResult);
    return {
      ok: false,
      reason,
      failureClass: classifyFailure(reason),
      issues: finalResult.ok ? [] : finalResult.issues,
      invocation,
    };
  }

  /** Count how many times `gateName` passed across all history in a session. */
  static countGatePasses(session: PipelineSession, gateName: GateResult['gate']): number {
    let n = 0;
    for (const inv of session.history) {
      for (const g of inv.gateResults) {
        if (g.gate === gateName && g.passed) n++;
      }
    }
    return n;
  }

  private recordFailure<TOut>(
    session: PipelineSession,
    agentId: string,
    startedAt: Date,
    input: unknown,
    reason: RunAgentFailureReason,
    issues: readonly SemanticIssue[],
  ): RunAgentResult<TOut> {
    const finishedAt = this.now();
    const invocation: AgentInvocation = {
      invocationId: this.nextId('inv'),
      agentId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      input,
      gateResults: [],
      status: 'blocked',
    };
    session.history.push(invocation);
    return { ok: false, reason, failureClass: classifyFailure(reason), issues, invocation };
  }

  private now(): Date {
    return this.config.now ? this.config.now() : new Date();
  }

  private nextId(prefix: string): string {
    if (this.config.idFactory) return this.config.idFactory();
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

function mapReason(result: GateRunResult): RunAgentFailureReason {
  if (result.ok) throw new Error('mapReason called on successful result');
  return result.reason;
}
