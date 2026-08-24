/**
 * Mid-office TTL urgency — Zulu (UTC) policy.
 *
 * Source: docs/knowledge-base/tmc-mid-office-ttl-queues.md
 * Travelport T.TAU / T.TAW / ORB are Zulu; QCC TZ is display-only.
 */

/** Zulu calendar day as YYYY-MM-DD (UTC). */
export function zuluDateString(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

export function hoursUntilDeadline(deadline: Date, now: Date): number {
  return (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
}

export interface TtlUrgencyInput {
  ticketDeadline: string;
  now: Date;
  /** ISO timestamp if already issued — used for deadline-day ADM pattern. */
  ticketIssuedAt?: string;
}

export type TtlUrgencyResult =
  | {
      code: 'TTL_URGENT' | 'TTL_APPROACHING';
      severity: 'urgent' | 'high';
      message: string;
    }
  | null;

/**
 * Classify TTL urgency using Zulu instants and the deadline-day ADM pattern.
 */
export function classifyTtlUrgency(input: TtlUrgencyInput): TtlUrgencyResult {
  const deadline = new Date(input.ticketDeadline);
  if (Number.isNaN(deadline.getTime())) {
    // TODO: DOMAIN_QUESTION: how should mid-office treat unparseable TTL strings?
    return null;
  }

  const deadlineZuluDay = zuluDateString(deadline);
  const nowZuluDay = zuluDateString(input.now);

  if (input.ticketIssuedAt) {
    const issued = new Date(input.ticketIssuedAt);
    if (!Number.isNaN(issued.getTime()) && zuluDateString(issued) === deadlineZuluDay) {
      return {
        code: 'TTL_URGENT',
        severity: 'urgent',
        message: `Ticket issued on deadline day ${deadlineZuluDay}Z — ADM risk for same-day-of-deadline issuance (Zulu).`,
      };
    }
    // Already ticketed on a different Zulu day — no open-TTL urgency.
    return null;
  }

  const hours = hoursUntilDeadline(deadline, input.now);

  if (hours < 0) {
    return {
      code: 'TTL_URGENT',
      severity: 'urgent',
      message: `Ticketing deadline expired at ${input.ticketDeadline} (Zulu).`,
    };
  }

  // Deadline-day ADM pattern: entire Zulu calendar day is urgent for open PNRs.
  if (nowZuluDay === deadlineZuluDay) {
    return {
      code: 'TTL_URGENT',
      severity: 'urgent',
      message: `Ticketing deadline day ${deadlineZuluDay}Z — urgent (deadline-day ADM pattern; Zulu).`,
    };
  }

  if (hours <= 1) {
    return {
      code: 'TTL_URGENT',
      severity: 'urgent',
      message: `Ticketing deadline in ${Math.round(hours * 60)} minutes (Zulu).`,
    };
  }

  if (hours <= 4) {
    return {
      code: 'TTL_APPROACHING',
      severity: 'high',
      message: `Ticketing deadline in ${Math.round(hours)} hours (Zulu).`,
    };
  }

  return null;
}
