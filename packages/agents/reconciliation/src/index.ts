/**
 * @otaip/agents-reconciliation — Stage 7 BSP & ARC reconciliation agents.
 *
 * Re-exports all Stage 7 agent classes and parsers.
 */

export { BSPReconciliation, HOTFileParser } from './bsp-reconciliation/index.js';
export type {
  BSPReconciliationInput,
  BSPReconciliationOutput,
  HOTFileRecord,
  HOTFileFormat,
  HOTTransactionType,
  DishTransactionCode,
  RelatedDocumentRef,
  AgencyRecord,
  Discrepancy,
  DiscrepancyType,
  DiscrepancySeverity,
  PatternDetection,
  ReconciliationSummary,
} from './bsp-reconciliation/index.js';

export { ARCReconciliation, IARParser } from './arc-reconciliation/index.js';
export type {
  ARCReconciliationInput,
  ARCReconciliationOutput,
  ARCReconciliationSummary,
  IARRecord,
  IARFormat,
  ARCAgencyRecord,
  ARCDiscrepancy,
  ARCDiscrepancyType,
  ARCDiscrepancySeverity,
  ARCPatternDetection,
  AirlineContract,
} from './arc-reconciliation/index.js';

export { CommissionManagementAgent } from './commission-management/index.js';
export type {
  CommissionManagementInput,
  CommissionManagementOutput,
  CommissionAgreement,
  CommissionRate,
  CommissionValidationResult,
  IncentiveResult,
  AgreementType,
  CommissionBasis,
  ValidationStatus,
  CommissionOperation,
} from './commission-management/index.js';

// Coming soon — pending domain input (prorate/SIS)
export { InterlineSettlementAgent } from './interline-settlement/index.js';

export { FinancialReportingAgent } from './financial-reporting/index.js';
export type {
  FinancialReportingInput,
  FinancialReportingOutput,
  FinancialReport,
  FinancialRecord,
  ReportLineItem,
  ReportTotals,
  FinReportType,
  RecordType,
  FinancialReportRequest,
} from './financial-reporting/index.js';

export { RevenueAccountingAgent } from './revenue-accounting/index.js';
export type {
  RevenueAccountingInput,
  RevenueAccountingOutput,
  LiftRecord,
  CouponLiftInput,
  RevenueRecognitionResult,
  UpliftReport,
  DeferredRevenueReport,
  CouponNumber,
  LiftStatus,
  RevAcctOperation,
} from './revenue-accounting/index.js';
