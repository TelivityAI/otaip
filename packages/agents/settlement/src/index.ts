/**
 * @otaip/agents-settlement — Stage 6 refund & ADM prevention agents.
 *
 * Re-exports all Stage 6 agent classes.
 */

export { RefundProcessing } from './refund-processing/index.js';
export type {
  RefundProcessingInput,
  RefundProcessingOutput,
  RefundRecord,
  RefundAuditTrail,
  RefundType,
  SettlementSystem,
  CommissionType,
  CommissionData,
  TaxItem,
  CouponRefundItem,
  BspRefundFields,
  ArcRefundFields,
  RefundPenaltyRule,
} from './refund-processing/index.js';

export {
  ADMPrevention,
  ADM_CHECK_COUNT,
  CORE_BLOCKING_STATUSES,
  EXTENDED_BLOCKING_STATUSES,
  isBlockingSegmentStatus,
  DEFAULT_CHURN_CYCLE_THRESHOLD,
  DEFAULT_CHURN_WINDOW_HOURS,
} from './adm-prevention/index.js';
export type {
  ADMPreventionInput,
  ADMPreventionOutput,
  ADMPreventionResult,
  ADMCheck,
  ADMCheckId,
  ADMSeverity,
  BookingRecord,
  BookingSegment,
  DuplicateCheckPnr,
  SegmentHistoryEvent,
  SegmentHistoryAction,
  TtlSource,
  GdsHost,
} from './adm-prevention/index.js';

export { ADMACMProcessingAgent } from './adm-acm-processing/index.js';
export type {
  ADMACMProcessingInput,
  ADMACMProcessingOutput,
  ADMRecord,
  ACMRecord,
  ADMAssessment,
  ADMDisputeResult,
  PendingDeadlineItem,
  StatusChange,
  ADMStatus,
  ACMStatus,
  DisputeGround,
  ADMACMErrorCode,
} from './adm-acm-processing/index.js';

export { CustomerCommunicationAgent } from './customer-communication/index.js';
export type {
  CustomerCommunicationInput,
  CustomerCommunicationOutput,
  GeneratedNotification,
  TemplateInfo,
  NotificationType,
  Channel,
  NotificationVariables,
} from './customer-communication/index.js';

export { FeedbackComplaintAgent } from './feedback-complaint/index.js';
export type {
  FeedbackComplaintInput,
  FeedbackComplaintOutput,
  ComplaintCase,
  CompensationResult,
  DOTRecord,
  ComplaintType,
  ComplaintStatus,
  Priority,
  Regulation,
  CabinClass,
  DOTCategory,
} from './feedback-complaint/index.js';

export { LoyaltyMileageAgent } from './loyalty-mileage/index.js';
export type {
  LoyaltyMileageInput,
  LoyaltyMileageOutput,
  AccrualResult,
  RedemptionEligibility,
  StatusBenefitsResult,
  StatusBenefit,
  StatusMatchResult,
  LoyaltyStatus,
  Alliance,
  RedemptionCabin,
} from './loyalty-mileage/index.js';
