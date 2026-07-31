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

export type MutationOpsSubscriber = (signal: {
  readonly kind: 'failure' | 'irreversible';
  readonly payload: BookingFailureSignal | IrreversibleAuditEntry;
}) => void;

export class MutationOpsCollector {
  private readonly failures: BookingFailureSignal[] = [];
  private readonly audits: IrreversibleAuditEntry[] = [];
  private readonly subscribers: MutationOpsSubscriber[] = [];
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  /** Optional subscribe hook — no fake external APM. */
  subscribe(subscriber: MutationOpsSubscriber): () => void {
    this.subscribers.push(subscriber);
    return () => {
      const idx = this.subscribers.indexOf(subscriber);
      if (idx >= 0) this.subscribers.splice(idx, 1);
    };
  }

  recordFailure(signal: Omit<BookingFailureSignal, 'at'> & { at?: string }): void {
    const entry: BookingFailureSignal = {
      ...signal,
      at: signal.at ?? this.now().toISOString(),
    };
    this.failures.push(entry);
    for (const sub of this.subscribers) {
      sub({ kind: 'failure', payload: entry });
    }
  }

  recordIrreversible(entry: Omit<IrreversibleAuditEntry, 'at'> & { at?: string }): void {
    const audit: IrreversibleAuditEntry = {
      ...entry,
      at: entry.at ?? this.now().toISOString(),
    };
    this.audits.push(audit);
    for (const sub of this.subscribers) {
      sub({ kind: 'irreversible', payload: audit });
    }
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

/** Process-global ops collector — mirror of process kill switch. */
const processOpsCollector = new MutationOpsCollector();

export function getProcessMutationOpsCollector(): MutationOpsCollector {
  return processOpsCollector;
}
