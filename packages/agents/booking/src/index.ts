/**
 * @otaip/agents-booking — Stage 3 booking agents.
 *
 * Re-exports all Stage 3 agent classes.
 */

export { ApiAbstraction, ApiClient, ProviderError } from './api-abstraction/index.js';
export type {
  RequestHandler,
  ApiAbstractionInput,
  ApiAbstractionOutput,
  ApiRequest,
  ApiResponse,
  ProviderConfig,
  ProviderType,
  CircuitState,
  CircuitBreakerStatus,
  RateLimitStatus,
  NormalizedError,
  ErrorCategory,
  HttpMethod,
} from './api-abstraction/index.js';

export { GdsNdcRouter } from './gds-ndc-router/index.js';
export type {
  GdsNdcRouterInput,
  GdsNdcRouterOutput,
  RoutingSegment,
  ChannelRouting,
  CarrierChannelConfig,
  DistributionChannel,
  NdcVersion,
  GdsSystem,
  GdsPnrFormat,
  GdsPnrSegment,
  NdcOrderFormat,
  NdcOfferItem,
} from './gds-ndc-router/index.js';
export { gdsNdcRouterContract } from './gds-ndc-router/contract.js';
export {
  gdsNdcRouterInputSchema,
  gdsNdcRouterOutputSchema,
} from './gds-ndc-router/schema.js';
export { buildCarrierCapabilities } from './gds-ndc-router/registry-adapter.js';
export {
  getSeedCapabilityMatrix,
  parseCapabilityMatrixCsv,
  lookupMatrixRow,
  matrixRowToCarrierConfig,
  buildCapabilityOverridesFromMatrix,
  MATRIX_TO_AGENT_TRANSACTION,
  matrixTransactionsForAgentType,
  parseNdcVersionNotes,
} from './gds-ndc-router/capability-matrix.js';
export type {
  CapabilityMatrixRow,
  MatrixTransaction,
  MatrixVendor,
  MatrixChannel,
  CapabilityMatrixInputRow,
  DistributionVendor,
} from './gds-ndc-router/index.js';

export { PnrBuilder } from './pnr-builder/index.js';
export type {
  PnrBuilderInput,
  PnrBuilderOutput,
  PnrCommand,
  PnrPassenger,
  PnrSegment,
  PnrContact,
  PnrTicketing,
  SsrElement,
  OsiElement,
  PnrGdsSystem,
  SsrCode,
} from './pnr-builder/index.js';
export { pnrBuilderContract } from './pnr-builder/contract.js';
export {
  pnrBuilderInputSchema,
  pnrBuilderOutputSchema,
} from './pnr-builder/schema.js';

export { PnrValidation } from './pnr-validation/index.js';
export type {
  PnrValidationInput,
  PnrValidationOutput,
  ValidationCheck,
  ValidationSeverity,
  PnrPassengerData,
  PnrSegmentData,
  PnrContactData,
  PnrTicketingData,
  PnrFareData,
  SegmentStatus,
} from './pnr-validation/index.js';

export { QueueManagement } from './queue-management/index.js';
export type {
  QueueManagementInput,
  QueueManagementOutput,
  QueueEntry,
  QueueProcessingResult,
  QueueCommand,
  QueueEntryType,
  QueuePriority,
  QueueItemStatus,
  QueueGdsSystem,
  QueueAction,
} from './queue-management/index.js';

export { OrderManagement } from './order-management/index.js';
export type {
  OrderManagementConfig,
  OrderManagementInput,
  OrderManagementOutput,
  Order,
  OrderItem,
  OrderStatus,
  OrderOperationType,
  OrderErrorCode,
  OrderHistoryEntry,
  CreateOrderData,
  ModifyOrderData,
  CancelOrderData,
  GetOrderData,
  ListOrdersData,
  ListOrdersFilter,
} from './order-management/index.js';
export {
  PaymentConfirmationStateMachine,
} from './order-management/state-machine.js';
export type {
  AuditPort,
  MonitoringPort,
  ManagedOrder,
  ConflictResolution,
  ConflictResolutionAction,
} from './order-management/state-machine.js';
export { DurablePaymentConfirmationStateMachine } from './order-management/durable-state-machine.js';

export { PaymentProcessing } from './payment-processing/index.js';
export type {
  PaymentProcessingInput,
  PaymentProcessingOutput,
  FormOfPayment,
  FOPType,
  CardBrand,
  PaymentOperationType,
  PaymentRecordStatus,
  PaymentErrorCode,
  PaymentInstruction,
  PaymentRecord,
  FOPValidationResult,
  ValidateFOPData,
  BuildPaymentInstructionData,
  RecordPaymentData,
  GetPaymentRecordData,
  BuildGDSFOPStringData,
} from './payment-processing/index.js';

export { PnrRetrieval } from './pnr-retrieval/index.js';
export type {
  PnrRetrievalInput,
  PnrRetrievalOutput,
  RetrievedPassenger,
  RetrievedSegment,
  RetrievedContact,
  RetrievedTicketing,
  RetrievalSource,
  BookingStatus as PnrRetrievalBookingStatus,
  PnrRetrievalSegmentStatus,
} from './pnr-retrieval/index.js';
export { pnrRetrievalContract } from './pnr-retrieval/contract.js';
export {
  pnrRetrievalInputSchema,
  pnrRetrievalOutputSchema,
} from './pnr-retrieval/schema.js';

export { executeFallbackChain } from './fallback-chain/index.js';
export type {
  ChannelExecutor,
  CircuitChecker,
  FallbackAttempt,
  FallbackChainInput,
  FallbackChainOutput,
  FallbackStatus,
} from './fallback-chain/index.js';
