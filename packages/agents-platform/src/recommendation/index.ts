/**
 * Recommendation — Agent 9.8
 *
 * Accepts performance and routing audit reports and produces deterministic
 * recommendations. Read-only — no side effects.
 *
 * Implements the base Agent interface from @otaip/core.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type { RecommendationInput, RecommendationOutput } from './types.js';
import { computeRecommendations } from './recommendation-engine.js';

export class RecommendationAgent
  implements Agent<RecommendationInput, RecommendationOutput>
{
  readonly id = '9.8';
  readonly name = 'Recommendation';
  readonly version = '0.1.0';

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(
    input: AgentInput<RecommendationInput>,
  ): Promise<AgentOutput<RecommendationOutput>> {
    if (!this.initialized) {
      throw new AgentNotInitializedError(this.id);
    }

    this.validateInput(input.data);

    const recommendations = computeRecommendations(input.data);

    // Confidence based on data volume.
    const totalEvents =
      input.data.performance_report.report.total_executions +
      input.data.routing_report.report.total_decisions;
    const confidence = totalEvents > 100 ? 0.9 : totalEvents > 10 ? 0.7 : 0.5;

    return {
      data: { recommendations },
      confidence,
      metadata: {
        agent_id: this.id,
        agent_version: this.version,
        recommendation_count: recommendations.length,
      },
    };
  }

  async health(): Promise<AgentHealthStatus> {
    if (!this.initialized) {
      return { status: 'unhealthy', details: 'Not initialized. Call initialize() first.' };
    }
    return { status: 'healthy' };
  }

  private validateInput(data: RecommendationInput): void {
    if (!data.performance_report?.report) {
      throw new AgentInputValidationError(this.id, 'performance_report', 'Required object with report field.');
    }
    if (!data.routing_report?.report) {
      throw new AgentInputValidationError(this.id, 'routing_report', 'Required object with report field.');
    }
  }
}

export type {
  RecommendationInput,
  RecommendationOutput,
  Recommendation,
  RecommendationType,
  RecommendationSeverity,
} from './types.js';
export { recommendationContract } from './contract.js';
