/**
 * @otaip/agents-platform — Stage 9 infrastructure agents.
 *
 * Re-exports all Stage 9 agent classes.
 */

export { OrchestratorAgent } from './orchestrator/index.js';
export { PipelineBuilder } from './orchestrator/index.js';
export { WORKFLOW_PIPELINES } from './orchestrator/index.js';
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
} from './orchestrator/index.js';

export { KnowledgeAgent } from './knowledge/index.js';
export type {
  KnowledgeInput,
  KnowledgeOutput,
  KnowledgeDocument,
  KnowledgeResult,
  KnowledgeTopic,
  KnowledgeOperation,
  EmbeddingProvider,
  KnowledgeAgentConfig,
} from './knowledge/index.js';

export { MonitoringAgent } from './monitoring/index.js';
export type {
  MonitoringInput,
  MonitoringOutput,
  MetricEntry,
  AgentHealth,
  Alert,
  SlaReport,
  MonitoringOperation,
  MetricType,
  AgentStatus,
  AlertSeverity,
} from './monitoring/index.js';

export { AuditAgent } from './audit/index.js';
export type {
  AuditInput,
  AuditOutput,
  AuditLogEntry,
  ComplianceIssue,
  ComplianceReport,
  AuditOperation,
  EventType,
  ComplianceIssueType,
  ComplianceSeverity,
} from './audit/index.js';

export { PluginManagerAgent } from './plugin-manager/index.js';
export type {
  PluginInput,
  PluginOutput,
  Plugin,
  PluginCapability,
  PluginOperation,
} from './plugin-manager/index.js';

export { PlatformHealthAggregator } from './health/index.js';
export type { PlatformHealth } from './health/index.js';

export { PerformanceAuditAgent } from './performance-audit/index.js';
export { performanceAuditContract } from './performance-audit/index.js';
export type {
  PerformanceAuditInput,
  PerformanceAuditOutput,
  PerformanceReport,
} from './performance-audit/index.js';

export { RoutingAuditAgent } from './routing-audit/index.js';
export { routingAuditContract } from './routing-audit/index.js';
export type {
  RoutingAuditInput,
  RoutingAuditOutput,
  RoutingReport,
  ChannelStats,
} from './routing-audit/index.js';

export { RecommendationAgent } from './recommendation/index.js';
export { recommendationContract } from './recommendation/index.js';
export type {
  RecommendationInput,
  RecommendationOutput,
  Recommendation,
  RecommendationType,
  RecommendationSeverity,
} from './recommendation/index.js';

export { AlertAgent } from './alert/index.js';
export { alertContract } from './alert/index.js';
export { DEFAULT_THRESHOLDS } from './alert/index.js';
export type {
  AlertInput,
  AlertOutput,
  AlertItem,
  AlertThresholds,
  AlertSeverityType,
} from './alert/index.js';
