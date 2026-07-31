/**
 * Ops signals for money-path mutations: failure-by-stage, unknown-outcome age,
 * irreversible audit trail (no PII in labels).
 */

export type BookingFailureStage =
  | 'search'
  | 'price'
  | 'book'
  | 'pay'
  | 'ticket'
  | 'confirm'
  | 'cancel'
  | 'void'
  | 'refund'
  | 'unknown';

export interface BookingFailureSignal {
  readonly stage: BookingFailureStage;
  readonly code: string;
  readonly at: string;
  readonly correlationId?: string;
  readonly supplierId?: string;
}

export interface IrreversibleAuditEntry {
  readonly actionId: string;
  readonly effectType: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly payloadHash: string;
  readonly externalRef?: string;
  readonly at: string;
}

export class MutationOpsCollector {
  private readonly failures: BookingFailureSignal[] = [];
  private readonly audits: IrreversibleAuditEntry[] = [];
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  recordFailure(signal: Omit<BookingFailureSignal, 'at'> & { at?: string }): void {
    this.failures.push({
      ...signal,
      at: signal.at ?? this.now().toISOString(),
    });
  }

  recordIrreversible(entry: Omit<IrreversibleAuditEntry, 'at'> & { at?: string }): void {
    this.audits.push({
      ...entry,
      at: entry.at ?? this.now().toISOString(),
    });
  }

  failuresByStage(): ReadonlyMap<BookingFailureStage, number> {
    const map = new Map<BookingFailureStage, number>();
    for (const f of this.failures) {
      map.set(f.stage, (map.get(f.stage) ?? 0) + 1);
    }
    return map;
  }

  listFailures(): readonly BookingFailureSignal[] {
    return this.failures;
  }

  listAudits(): readonly IrreversibleAuditEntry[] {
    return this.audits;
  }
}
