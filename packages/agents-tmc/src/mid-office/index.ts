/**
 * Mid-Office Automation — Agent 8.3
 *
 * PNR quality checks, ticketing deadline monitoring, duplicate/passive detection.
 */

import type { Agent, AgentInput, AgentOutput, AgentHealthStatus } from '@otaip/core';
import { AgentNotInitializedError, AgentInputValidationError } from '@otaip/core';
import type {
  MidOfficeInput,
  MidOfficeOutput,
  MockPnr,
  PnrCheckResult,
  PnrIssue,
} from './types.js';
import { classifyTtlUrgency } from './ttl-policy.js';

const PASSIVE_STATUSES = new Set(['HX', 'UN', 'NO', 'UC']);
const ACTIVE_STATUSES = new Set(['HK', 'KL']);

export class MidOfficeAgent implements Agent<MidOfficeInput, MidOfficeOutput> {
  readonly id = '8.3';
  readonly name = 'Mid-Office Automation';
  readonly version = '0.1.0';

  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async execute(input: AgentInput<MidOfficeInput>): Promise<AgentOutput<MidOfficeOutput>> {
    if (!this.initialized) throw new AgentNotInitializedError(this.id);

    const d = input.data;
    if (!d.pnrs || !Array.isArray(d.pnrs)) {
      throw new AgentInputValidationError(this.id, 'pnrs', 'Must be an array.');
    }

    const now = d.current_datetime ? new Date(d.current_datetime) : new Date();
    const results = d.pnrs.map((pnr) => this.checkPnr(pnr, now, d.active_pnrs ?? []));

    const actionCount = results.filter((r) => r.action_required).length;
    const urgentCount = results.filter((r) => r.issues.some((i) => i.severity === 'urgent')).length;

    const warnings: string[] = [];
    if (urgentCount > 0) warnings.push(`${urgentCount} PNR(s) have urgent issues.`);
    if (actionCount > 0) warnings.push(`${actionCount} PNR(s) require action.`);

    return {
      data: {
        results,
        total_pnrs: d.pnrs.length,
        action_required_count: actionCount,
        urgent_count: urgentCount,
      },
      confidence: 1.0,
      warnings: warnings.length > 0 ? warnings : undefined,
      metadata: { agent_id: this.id, agent_version: this.version, trigger: d.trigger_type },
    };
  }

  async health(): Promise<AgentHealthStatus> {
    if (!this.initialized) return { status: 'unhealthy', details: 'Not initialized.' };
    return { status: 'healthy' };
  }

  destroy(): void {
    this.initialized = false;
  }

  private checkPnr(pnr: MockPnr, now: Date, activePnrs: MockPnr[]): PnrCheckResult {
    const issues: PnrIssue[] = [];
    let checksRun = 0;

    // 1. TTL check — Zulu instants + deadline-day ADM pattern
    // (docs/knowledge-base/tmc-mid-office-ttl-queues.md)
    checksRun++;
    if (pnr.ticket_deadline) {
      const ttl = classifyTtlUrgency({
        ticketDeadline: pnr.ticket_deadline,
        now,
        ticketIssuedAt: pnr.ticket_issued_at,
      });
      if (ttl) {
        issues.push({
          code: ttl.code,
          severity: ttl.severity,
          message: ttl.message,
        });
      }
    }

    // 2. PNR completeness
    checksRun++;
    for (const seg of pnr.segments) {
      if (!ACTIVE_STATUSES.has(seg.status) && !PASSIVE_STATUSES.has(seg.status)) {
        issues.push({
          code: 'MISSING_SEGMENT_STATUS',
          severity: 'medium',
          message: `Segment ${seg.carrier}${seg.flight_number} has status ${seg.status}.`,
        });
      }
    }

    const hasInternational = pnr.segments.some((s) => s.origin_country !== s.destination_country);
    if (hasInternational && !pnr.apis_complete) {
      issues.push({
        code: 'MISSING_APIS',
        severity: 'high',
        message: 'APIS data missing for international itinerary.',
      });
    }
    if (!pnr.contact_present) {
      issues.push({
        code: 'MISSING_CONTACT',
        severity: 'medium',
        message: 'Contact information missing.',
      });
    }
    if (!pnr.fop_present) {
      issues.push({ code: 'MISSING_FOP', severity: 'medium', message: 'Form of payment missing.' });
    }

    // 3. Duplicate detection
    checksRun++;
    for (const other of activePnrs) {
      if (other.recloc === pnr.recloc) continue;
      if (other.passenger_name.toUpperCase() !== pnr.passenger_name.toUpperCase()) continue;

      for (const mySeg of pnr.segments) {
        for (const otherSeg of other.segments) {
          if (
            mySeg.origin === otherSeg.origin &&
            mySeg.destination === otherSeg.destination &&
            mySeg.departure_date === otherSeg.departure_date
          ) {
            issues.push({
              code: 'DUPLICATE_PNR',
              severity: 'high',
              message: `Duplicate: ${pnr.passenger_name} ${mySeg.origin}-${mySeg.destination} ${mySeg.departure_date} also in ${other.recloc}.`,
            });
          }
        }
      }
    }

    // 4. Passive segments
    checksRun++;
    for (const seg of pnr.segments) {
      if (PASSIVE_STATUSES.has(seg.status)) {
        issues.push({
          code: 'PASSIVE_SEGMENT',
          severity: 'high',
          message: `Passive segment ${seg.carrier}${seg.flight_number} status ${seg.status} — ADM risk.`,
        });
      }
    }

    // 5. Policy compliance (simplified — just cabin check based on spec)
    checksRun++;
    if (pnr.corporate_id) {
      for (const seg of pnr.segments) {
        if (seg.cabin === 'first' || seg.cabin === 'business') {
          const isDomestic = seg.origin_country === seg.destination_country;
          if (isDomestic) {
            issues.push({
              code: 'POLICY_VIOLATION',
              severity: 'medium',
              message: `Domestic flight ${seg.carrier}${seg.flight_number} booked in ${seg.cabin} class (corporate policy review needed).`,
            });
          }
        }
      }
    }

    // 6. Married segment integrity
    checksRun++;
    const marriedGroups = new Map<string, string[]>();
    for (const seg of pnr.segments) {
      if (seg.married_group) {
        const segs = marriedGroups.get(seg.married_group) ?? [];
        segs.push(`${seg.carrier}${seg.flight_number}`);
        marriedGroups.set(seg.married_group, segs);
      }
    }
    for (const [group, segs] of marriedGroups) {
      if (segs.length < 2) {
        issues.push({
          code: 'MARRIED_SEGMENT_INCOMPLETE',
          severity: 'high',
          message: `Married group ${group} has only ${segs.length} segment(s) — connecting itinerary incomplete.`,
        });
      }
    }

    const actionRequired = issues.some((i) => i.severity === 'urgent' || i.severity === 'high');

    return {
      recloc: pnr.recloc,
      checks_passed: checksRun - (issues.length > 0 ? 1 : 0),
      issues,
      action_required: actionRequired,
    };
  }
}

export type {
  MidOfficeInput,
  MidOfficeOutput,
  MockPnr,
  PnrCheckResult,
  PnrIssue,
  PnrSegment,
  TriggerType,
  IssueSeverity,
  IssueCode,
} from './types.js';
