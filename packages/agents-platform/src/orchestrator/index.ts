/**
 * Orchestrator — Agent 9.1
 *
 * Coordinates multi-agent workflows as a single callable pipeline.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type {
  OrchestratorInput,
  OrchestratorOutput,
  WorkflowStep,
  StepExecutor,
  PipelineDefinition,
  PipelineEntry,
  PipelineStep,
  ParallelStep,
} from './types.js';
import { WORKFLOW_PIPELINES } from './workflows.js';

const VALID_WORKFLOWS = new Set(Object.keys(WORKFLOW_PIPELINES));

const DEFAULT_TIMEOUT = 30000;

function isParallelStep(entry: PipelineEntry): entry is ParallelStep {
  return 'parallel' in entry;
}

export class OrchestratorAgent implements Agent<OrchestratorInput, OrchestratorOutput> {
  readonly id = '9.1';
  readonly name = 'Orchestrator';
  readonly version = '0.1.0';

  private initialized = false;
  private executor: StepExecutor;
  private customPipelines = new Map<string, PipelineDefinition>();

  constructor(executor?: StepExecutor) {
    // Default executor that throws — tests must inject their own
    this.executor =
      executor ??
      (async (
        _agentId: string,
        _input: Record<string, unknown>,
      ): Promise<Record<string, unknown>> => {
        throw new Error('No step executor configured. Inject one via constructor.');
      });
  }

  setExecutor(executor: StepExecutor): void {
    this.executor = executor;
  }

  registerPipeline(definition: PipelineDefinition): void {
    this.customPipelines.set(definition.name, definition);
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(input: AgentInput<OrchestratorInput>): Promise<AgentOutput<OrchestratorOutput>> {
    if (!this.initialized) throw new AgentNotInitializedError(this.id);

    const d = input.data;

    // Check custom pipelines first, then built-in
    const customPipeline = this.customPipelines.get(d.workflow);
    if (customPipeline) {
      return this.executeCustomPipeline(customPipeline, d);
    }

    if (!d.workflow || !VALID_WORKFLOWS.has(d.workflow)) {
      throw new AgentInputValidationError(this.id, 'workflow', 'UNKNOWN_WORKFLOW');
    }

    // Validated above that d.workflow is in VALID_WORKFLOWS
    const pipeline = WORKFLOW_PIPELINES[d.workflow as keyof typeof WORKFLOW_PIPELINES];
    if (!pipeline) throw new AgentInputValidationError(this.id, 'workflow', 'UNKNOWN_WORKFLOW');
    const stopOnError = d.options?.stop_on_error ?? true;
    const timeoutMs = d.options?.timeout_ms ?? DEFAULT_TIMEOUT;

    const startTime = Date.now();
    const steps: WorkflowStep[] = [];
    let currentInput = { ...d.input };
    let overallStatus: 'completed' | 'failed' | 'partial' = 'completed';
    let finalOutput: Record<string, unknown> | undefined;
    let timedOut = false;

    for (const agentId of pipeline) {
      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        timedOut = true;
        steps.push({
          agent_id: agentId,
          status: 'skipped',
          duration_ms: 0,
          error: 'Workflow timeout exceeded.',
        });
        overallStatus = 'partial';
        continue;
      }

      if (timedOut) {
        steps.push({
          agent_id: agentId,
          status: 'skipped',
          duration_ms: 0,
          error: 'Workflow timeout exceeded.',
        });
        continue;
      }

      const stepStart = Date.now();
      try {
        const output = await this.executor(agentId, currentInput);
        const duration = Date.now() - stepStart;
        steps.push({ agent_id: agentId, status: 'completed', duration_ms: duration, output });
        currentInput = { ...currentInput, ...output };
        finalOutput = output;
      } catch (err) {
        const duration = Date.now() - stepStart;
        const errorMsg = err instanceof Error ? err.message : String(err);
        steps.push({ agent_id: agentId, status: 'failed', duration_ms: duration, error: errorMsg });

        if (stopOnError) {
          overallStatus = 'failed';
          // Mark remaining as skipped
          const idx = pipeline.indexOf(agentId);
          for (let i = idx + 1; i < pipeline.length; i++) {
            steps.push({
              agent_id: pipeline[i]!,
              status: 'skipped',
              duration_ms: 0,
              error: 'Skipped due to prior failure.',
            });
          }
          break;
        } else {
          overallStatus = 'partial';
        }
      }
    }

    const totalDuration = Date.now() - startTime;

    return {
      data: {
        workflow: d.workflow,
        status: overallStatus,
        steps,
        total_duration_ms: totalDuration,
        final_output: finalOutput,
      },
      confidence: 1.0,
      warnings:
        overallStatus !== 'completed' ? [`Workflow ${d.workflow} ${overallStatus}.`] : undefined,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        workflow: d.workflow,
        status: overallStatus,
      },
    };
  }

  private async executeCustomPipeline(
    pipeline: PipelineDefinition,
    d: OrchestratorInput,
  ): Promise<AgentOutput<OrchestratorOutput>> {
    const stopOnError = d.options?.stop_on_error ?? true;
    const timeoutMs = d.options?.timeout_ms ?? DEFAULT_TIMEOUT;

    const startTime = Date.now();
    const steps: WorkflowStep[] = [];
    let currentInput = { ...d.input };
    let overallStatus: 'completed' | 'failed' | 'partial' = 'completed';
    let finalOutput: Record<string, unknown> | undefined;
    let shouldStop = false;

    for (const entry of pipeline.steps) {
      if (shouldStop) break;

      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        this.markRemainingAsSkipped(entry, steps, 'Workflow timeout exceeded.');
        overallStatus = 'partial';
        continue;
      }

      if (isParallelStep(entry)) {
        const results = await Promise.allSettled(
          entry.parallel.map(async (ps) => {
            if (ps.condition && !ps.condition(currentInput)) {
              return { agentId: ps.agent_id, skipped: true as const };
            }
            const stepStart = Date.now();
            const output = await this.executor(ps.agent_id, currentInput);
            return { agentId: ps.agent_id, output, duration: Date.now() - stepStart };
          }),
        );

        for (let i = 0; i < results.length; i++) {
          const result = results[i]!;
          const ps = entry.parallel[i]!;
          if (result.status === 'fulfilled') {
            if ('skipped' in result.value) {
              steps.push({ agent_id: ps.agent_id, status: 'skipped', duration_ms: 0 });
            } else {
              steps.push({
                agent_id: ps.agent_id,
                status: 'completed',
                duration_ms: result.value.duration,
                output: result.value.output,
              });
              currentInput = { ...currentInput, ...result.value.output };
              finalOutput = result.value.output;
            }
          } else {
            const errorMsg =
              result.reason instanceof Error ? result.reason.message : String(result.reason);
            steps.push({ agent_id: ps.agent_id, status: 'failed', duration_ms: 0, error: errorMsg });
            const errorBehavior = ps.onError ?? (stopOnError ? 'stop' : 'continue');
            if (errorBehavior === 'stop') {
              overallStatus = 'failed';
              shouldStop = true;
            } else if (errorBehavior === 'skip' || errorBehavior === 'continue') {
              overallStatus = 'partial';
            }
          }
        }
      } else {
        const ps = entry as PipelineStep;

        // Conditional skip
        if (ps.condition && !ps.condition(currentInput)) {
          steps.push({ agent_id: ps.agent_id, status: 'skipped', duration_ms: 0 });
          continue;
        }

        const stepStart = Date.now();
        try {
          const output = await this.executor(ps.agent_id, currentInput);
          const duration = Date.now() - stepStart;
          steps.push({ agent_id: ps.agent_id, status: 'completed', duration_ms: duration, output });
          currentInput = { ...currentInput, ...output };
          finalOutput = output;
        } catch (err) {
          const duration = Date.now() - stepStart;
          const errorMsg = err instanceof Error ? err.message : String(err);
          steps.push({ agent_id: ps.agent_id, status: 'failed', duration_ms: duration, error: errorMsg });

          const errorBehavior = ps.onError ?? (stopOnError ? 'stop' : 'continue');
          if (errorBehavior === 'stop') {
            overallStatus = 'failed';
            shouldStop = true;
          } else if (errorBehavior === 'skip' || errorBehavior === 'continue') {
            overallStatus = 'partial';
          }
        }
      }
    }

    const totalDuration = Date.now() - startTime;

    return {
      data: {
        workflow: d.workflow,
        status: overallStatus,
        steps,
        total_duration_ms: totalDuration,
        final_output: finalOutput,
      },
      confidence: 1.0,
      warnings:
        overallStatus !== 'completed'
          ? [`Workflow ${d.workflow} ${overallStatus}.`]
          : undefined,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        workflow: d.workflow,
        status: overallStatus,
      },
    };
  }

  private markRemainingAsSkipped(
    entry: PipelineEntry,
    steps: WorkflowStep[],
    reason: string,
  ): void {
    if (isParallelStep(entry)) {
      for (const ps of entry.parallel) {
        steps.push({ agent_id: ps.agent_id, status: 'skipped', duration_ms: 0, error: reason });
      }
    } else {
      steps.push({ agent_id: entry.agent_id, status: 'skipped', duration_ms: 0, error: reason });
    }
  }

  async health(): Promise<AgentHealthStatus> {
    if (!this.initialized) return { status: 'unhealthy', details: 'Not initialized.' };
    return { status: 'healthy' };
  }

  destroy(): void {
    this.initialized = false;
  }
}

export type {
  OrchestratorInput,
  OrchestratorOutput,
  WorkflowStep,
  StepExecutor,
  WorkflowName,
  WorkflowOptions,
  StepStatus,
  PipelineStep,
  ParallelStep,
  PipelineEntry,
  PipelineDefinition,
} from './types.js';

export { WORKFLOW_PIPELINES } from './workflows.js';
export { PipelineBuilder } from './pipeline-builder.js';
