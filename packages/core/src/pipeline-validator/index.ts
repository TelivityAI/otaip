/**
 * Public barrel for the OTAIP pipeline validator.
 *
 * Re-exported from `@otaip/core` package root. Import from
 * `@otaip/core` in application code; only pipeline-validator internals
 * should reach into individual files.
 */

export type {
  ActionType,
  AgentContract,
  AgentInvocation,
  AirlineRef,
  AirportRef,
  FareBasisRef,
  GateName,
  GateResult,
  PipelineIntent,
  PipelineSession,
  ReferenceDataProvider,
  SemanticIssue,
  SemanticValidationResult,
  ValidationContext,
} from './types.js';
export { CONFIDENCE_FLOORS, REFERENCE_CONFIDENCE_FLOOR } from './types.js';

export { zodToJsonSchema } from './schema-bridge.js';
export type { JSONSchema, ZodToJsonSchemaOptions } from './schema-bridge.js';

export { checkIntentDrift, checkIntentRelevance } from './intent-lock.js';

export {
  captureOutputContract,
  checkCrossAgentConsistency,
} from './cross-agent-checker.js';

export {
  checkConfidence,
  resolveFloor,
  validateThresholdAgainstFloor,
} from './confidence-gate.js';
export type { ConfidenceCheckInput } from './confidence-gate.js';

export {
  DEFAULT_APPROVAL_POLICY,
  checkActionClassification,
} from './action-classifier.js';
export type { ApprovalPolicy } from './action-classifier.js';

export {
  resolveAirlineStrict,
  resolveAirportStrict,
  resolveFareBasisStrict,
  validateFutureDate,
  validateIataCode,
} from './shared-validators.js';
export type { ReferenceStrictOptions } from './shared-validators.js';

export { makeInvocation, runGates } from './validator.js';
export type { GateFailureReason, GateRunResult, RunGatesConfig } from './validator.js';

export { PipelineOrchestrator, classifyFailure } from './orchestrator.js';
export type {
  FailureClass,
  PipelineOrchestratorConfig,
  RunAgentFailureReason,
  RunAgentResult,
} from './orchestrator.js';
