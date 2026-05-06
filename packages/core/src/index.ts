export type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from './types/agent.js';
export {
  AgentError,
  AgentNotInitializedError,
  AgentInputValidationError,
  AgentDataUnavailableError,
  UnimplementedDomainInputError,
} from './errors/agent-errors.js';

export { OfferEvaluatorAgent, evaluateOffers } from './agents/shopping/index.js';
export type {
  OfferEvaluatorRequest,
  OfferEvaluatorResponse,
  EvaluatorResult,
  EvaluatorOffer,
  TravelerConstraints,
  TravelerProfile,
  ScoringWeights,
  SelectedOffer,
  RejectedOffer,
  EvaluationSummary,
  ChainConfidence,
  ConfidenceBasis,
  ConfidenceResult,
  ScoreBreakdown,
  StructuredExplanation,
} from './agents/shopping/index.js';

export type { ToolDefinition, ValidationIssue, ValidationResult } from './tool-interface/index.js';
export { validateToolInput, validateToolOutput } from './tool-interface/index.js';
export { ToolRegistry } from './tool-interface/index.js';
export {
  AGENT_TOOL_NAMES,
  AgentToolError,
  agentToTool,
  registerAgentTools,
  generateCatalog,
  generateMcpTools,
  generateOpenAiFunctions,
} from './tool-interface/index.js';
export type {
  AgentToolBridgeOptions,
  CatalogEntry,
  McpToolEntry,
  OpenAiFunctionEntry,
} from './tool-interface/index.js';

export type { RetryConfig, IsRetryable } from './retry/index.js';
export { DEFAULT_RETRY_CONFIG, withRetry, computeDelay } from './retry/index.js';

export { fetchWithRetry } from './http/index.js';
export type { FetchWithRetryOptions } from './http/index.js';

export type { DomainInputRequired } from './domain/index.js';
export { domainInputRequired, isDomainInputRequired } from './domain/index.js';

export {
  EU261_BANDS,
  EU261_DELAY_TRIGGER_HOURS,
  EU261_LONGHAUL_PARTIAL_REDUCTION,
  EU261_CANCELLATION_NOTICE_DAYS,
  EU261_REFUND_CHOICE_DELAY_HOURS,
  applyEU261,
  greatCircleDistanceKm,
  US_DOT_IDB_DOMESTIC,
  US_DOT_IDB_INTERNATIONAL,
  applyUsDotIdb,
} from './regulations/index.js';
export type {
  EU261Input,
  EU261Result,
  UsDotIdbInput,
  UsDotIdbResult,
  UsDotIdbBand,
} from './regulations/index.js';

export type {
  LoopPhase,
  ToolCall,
  ToolResult,
  LoopMessage,
  LoopState,
  LoopEvent,
  StopCondition,
  ModelCallFn,
  LoopConfig,
} from './agent-loop/index.js';
export { AgentLoop } from './agent-loop/index.js';

export type {
  LifecycleEvent,
  HookContext,
  BeforeToolCallResult,
  HookHandler,
  HookErrorPolicy,
  HookRegistryConfig,
} from './lifecycle/index.js';
export { HookRegistry } from './lifecycle/index.js';

export type { SpawnOptions, SubAgentResult } from './sub-agent/index.js';
export { SubAgentSpawner } from './sub-agent/index.js';

export type {
  ContextEntry,
  ContextBudgetConfig,
  CompactionStrategy,
  TokenCounter,
} from './context/index.js';
export { ContextBudgetManager, CharTokenCounter } from './context/index.js';
export { TiktokenCounter } from './context/index.js';
export type { TiktokenEncoding } from './context/index.js';
export { TruncateOldestStrategy, DropLargeToolOutputsStrategy } from './context/index.js';

export type { TelemetryProvider, TelemetrySpan } from './telemetry/index.js';
export { NoopTelemetryProvider, traceAgentExecution, OTelTelemetryProvider } from './telemetry/index.js';

export type { PersistenceAdapter } from './persistence/index.js';
export { InMemoryPersistenceAdapter } from './persistence/index.js';

export type { RateLimiterConfig } from './rate-limiter/index.js';
export { RateLimiter } from './rate-limiter/index.js';

export type { AuthContext, AuthMiddleware } from './auth/index.js';

export type { Idempotent, Cancellable, Checkpointable } from './mixins/index.js';

export type { CacheAdapter, CacheConfig } from './cache/index.js';
export { LRUCacheAdapter } from './cache/index.js';

// Filesystem-only agent discovery — used by the CLI and the OTA server.
export { discoverAgents } from './discovery/agent-discovery.js';
export type { DiscoveredAgent } from './discovery/agent-discovery.js';

export type {
  PassengerType,
  PassengerCount,
  SearchSegment,
  SearchRequest,
  FlightSegment,
  Itinerary,
  PriceBreakdown,
  PerPassengerPrice,
  SearchOffer,
  SearchResponse,
  PriceRequest,
  PriceResponse,
  DistributionAdapter,
} from './types/distribution.js';

// Channel capability types (CapabilityRegistry class lives in @otaip/connect).
export type {
  ChannelCapability,
  ChannelFunction,
  ChannelType,
  ResolvedCapability,
} from './types/capabilities.js';

// Pipeline validator — the platform contract layer.
export type {
  ActionType,
  AgentContract,
  AgentInvocation,
  AirlineRef,
  AirportRef,
  FareBasisRef,
  GateName,
  GateResult,
  JSONSchema,
  PipelineIntent,
  PipelineOrchestratorConfig,
  PipelineSession,
  ReferenceDataProvider,
  ReferenceStrictOptions,
  RunAgentFailureReason,
  RunAgentResult,
  SemanticIssue,
  SemanticValidationResult,
  ValidationContext,
  ZodToJsonSchemaOptions,
  ApprovalPolicy,
  ConfidenceCheckInput,
  GateFailureReason,
  GateRunResult,
  RunGatesConfig,
} from './pipeline-validator/index.js';
export {
  CONFIDENCE_FLOORS,
  DEFAULT_APPROVAL_POLICY,
  PipelineOrchestrator,
  REFERENCE_CONFIDENCE_FLOOR,
  captureOutputContract,
  checkActionClassification,
  checkConfidence,
  checkCrossAgentConsistency,
  checkIntentDrift,
  checkIntentRelevance,
  makeInvocation,
  resolveAirlineStrict,
  resolveAirportStrict,
  resolveFareBasisStrict,
  resolveFloor,
  runGates,
  validateFutureDate,
  validateIataCode,
  validateThresholdAgainstFloor,
  zodToJsonSchema,
} from './pipeline-validator/index.js';

// Event store — persistent event and outcome logging.
export type {
  AdapterHealthEvent,
  AgentExecutedEvent,
  AggregateResult,
  BookingCompletedEvent,
  BookingFailedEvent,
  EventFilter,
  EventStore,
  OtaipEvent,
  OtaipEventType,
  RoutingDecidedEvent,
  RoutingOutcomeEvent,
  TimeWindow,
} from './event-store/index.js';
export { InMemoryEventStore } from './event-store/index.js';

// Offers & Orders — AIDM 24.1 aligned data model.
export type {
  BookingReference,
  FareDetail,
  FlightService,
  LoyaltyInfo,
  Money,
  Offer,
  OfferItem,
  Order,
  OrderChange,
  OrderChangeRequest,
  OrderChangeType,
  OrderEvent,
  OrderEventType,
  OrderItem,
  OrderItemStatus,
  OrderOperations,
  OrderPassenger,
  OrderPayment,
  OrderReference,
  OrderStatus,
  PassengerTypeCode,
  PnrReference,
  Service,
  ServiceType,
  TicketDocument,
  TravelDocument,
} from './orders/index.js';
export {
  createOrderReference,
  createPnrReference,
  getBookingIdentifier,
  getBookingOwner,
  isOrderReference,
  isPnrReference,
  orderToReference,
  pnrPassengerToOrderPassenger,
  supportsOrderModel,
} from './orders/index.js';
export {
  fareDetailSchema,
  flightServiceSchema,
  moneySchema,
  offerItemSchema,
  offerSchema,
  orderChangeRequestSchema,
  orderEventSchema,
  orderItemSchema,
  orderPassengerSchema,
  orderPaymentSchema,
  orderSchema,
  serviceSchema,
  ticketDocumentSchema,
} from './orders/index.js';
