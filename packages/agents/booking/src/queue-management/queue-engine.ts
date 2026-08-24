/**
 * Queue Management Engine — Priority assignment, categorization, routing.
 *
 * Processes GDS queue entries and determines action + priority.
 * Travelport host commands: docs/knowledge-base/tmc-mid-office-ttl-queues.md
 */

import type {
  QueueEntry,
  QueueProcessingResult,
  QueueCommand,
  QueuePriority,
  QueueAction,
  QueueGdsSystem,
  QueueManagementInput,
  QueueManagementOutput,
  TravelportHost,
} from './types.js';

function currentTime(input: QueueManagementInput): Date {
  return input.current_time ? new Date(input.current_time) : new Date();
}

/** Zulu calendar day YYYY-MM-DD — TTL urgency default (KB). */
function zuluDateString(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Priority assignment
// ---------------------------------------------------------------------------

function hoursUntilDeadline(deadline: string, now: Date): number {
  const dl = new Date(deadline);
  return (dl.getTime() - now.getTime()) / (1000 * 60 * 60);
}

function assignPriority(entry: QueueEntry, now: Date): QueuePriority {
  switch (entry.entry_type) {
    case 'TTL_DEADLINE': {
      if (!entry.deadline) return 'high';
      const deadline = new Date(entry.deadline);
      // Deadline-day ADM pattern in Zulu (entire calendar day is urgent).
      if (zuluDateString(now) === zuluDateString(deadline)) {
        return 'urgent';
      }
      const hours = hoursUntilDeadline(entry.deadline, now);
      if (hours < 0) return 'urgent'; // already past deadline
      if (hours < 24) return 'urgent';
      if (hours < 72) return 'high';
      return 'normal';
    }
    case 'SCHEDULE_CHANGE':
      return 'high';
    case 'INVOLUNTARY_REBOOK':
      return 'urgent';
    case 'WAITLIST_CLEAR':
      return 'normal';
    case 'TICKET_REMINDER':
      return 'normal';
    case 'GENERAL':
      return 'low';
  }
}

// ---------------------------------------------------------------------------
// Action routing
// ---------------------------------------------------------------------------

function determineAction(
  entry: QueueEntry,
  priority: QueuePriority,
): { action: QueueAction; reason: string; target_agent?: string } {
  switch (entry.entry_type) {
    case 'TTL_DEADLINE':
      if (priority === 'urgent') {
        return {
          action: 'ROUTE_TO_TICKETING',
          reason: `TTL deadline ${entry.deadline ?? 'unknown'} — urgent ticketing required.`,
          target_agent: '3.3', // PNR Validation first, then ticketing
        };
      }
      return {
        action: 'ROUTE_TO_TICKETING',
        reason: `TTL deadline ${entry.deadline ?? 'unknown'} — ticketing within window.`,
        target_agent: '3.3',
      };

    case 'SCHEDULE_CHANGE':
      return {
        action: 'ROUTE_TO_SCHEDULE_CHANGE',
        reason: `Schedule change detected: ${entry.remark ?? 'details in PNR'}. Review and accept/reject.`,
        target_agent: '3.1', // GDS/NDC Router for rebooking
      };

    case 'WAITLIST_CLEAR':
      return {
        action: 'ROUTE_TO_WAITLIST',
        reason: `Waitlist cleared: ${entry.remark ?? 'segment confirmed'}. Verify and proceed to ticketing.`,
        target_agent: '3.3',
      };

    case 'INVOLUNTARY_REBOOK':
      return {
        action: 'ROUTE_TO_REISSUE',
        reason: `Involuntary change: ${entry.remark ?? 'rebooking needed'}. Protect passenger on alternative.`,
        target_agent: '3.1',
      };

    case 'TICKET_REMINDER':
      return {
        action: 'ROUTE_TO_TICKETING',
        reason: `Ticket reminder: ${entry.remark ?? 'follow up required'}.`,
        target_agent: '3.3',
      };

    case 'GENERAL':
      return {
        action: 'ROUTE_TO_MANUAL_REVIEW',
        reason: `General queue item: ${entry.remark ?? 'review needed'}.`,
      };
  }
}

// ---------------------------------------------------------------------------
// GDS queue commands
// ---------------------------------------------------------------------------

/**
 * Travelport place / list / remove / sign-in / count per host.
 * Source: https://support.travelport.com/webhelp/formats/Content/FormatCompare/Queues.htm
 *
 * // TODO: DOMAIN_QUESTION DQ-TQ1: Worldspan sign-out glyph (QX‡I vs QX#I) — omitted until resolved.
 * // TODO: DOMAIN_QUESTION DQ-TQ2: Is QW truly N/A on Worldspan in all markets?
 */
function buildTravelportHostCommands(
  host: TravelportHost,
  queueNumber: number,
): QueueCommand[] {
  const gds: QueueGdsSystem = 'TRAVELPORT';
  const commands: QueueCommand[] = [
    {
      gds,
      command: `Q/${queueNumber}`,
      description: `Sign into queue ${queueNumber} (${host})`,
    },
  ];

  switch (host) {
    case 'APOLLO':
      commands.push(
        {
          gds,
          command: `QEP/${queueNumber}`,
          description: `Place PNR on Apollo queue ${queueNumber}`,
        },
        {
          gds,
          command: 'QW',
          description: 'List all queues where current PNR resides (Apollo)',
        },
        {
          gds,
          command: 'QR',
          description: 'Remove current PNR from queue (Apollo)',
        },
        {
          gds,
          command: `QC/${queueNumber}`,
          description: `Queue count for Apollo queue ${queueNumber}`,
        },
        {
          gds,
          command: 'QXI',
          description: 'Sign out of queue and ignore last PNR (Apollo)',
        },
      );
      break;

    case 'GALILEO':
      // Galileo ≡ Travelport+ column in format compare
      commands.push(
        {
          gds,
          command: `QEB/${queueNumber}`,
          description: `Place BF on Travelport+/Galileo queue ${queueNumber}`,
        },
        {
          gds,
          command: 'QW',
          description: 'List all queues where current BF resides (Travelport+/Galileo)',
        },
        {
          gds,
          command: 'QR',
          description: 'Remove current BF from queue (Travelport+/Galileo)',
        },
        {
          gds,
          command: `QCB/${queueNumber}`,
          description: `Queue count for Travelport+/Galileo queue ${queueNumber}`,
        },
        {
          gds,
          command: 'QXI',
          description: 'Sign out of queue and ignore last BF (Travelport+/Galileo)',
        },
      );
      break;

    case 'WORLDSPAN':
      commands.push(
        {
          gds,
          command: `QEP/${queueNumber}`,
          description: `Place BF on Worldspan queue ${queueNumber}`,
        },
        // QW is N/A on Worldspan in the public format-compare table (DQ-TQ2).
        {
          gds,
          command: 'QR',
          description: 'Remove current BF from queue (Worldspan)',
        },
        {
          gds,
          command: `QC/${queueNumber}`,
          description: `Queue count for Worldspan queue ${queueNumber}`,
        },
        // TODO: DOMAIN_QUESTION DQ-TQ1: Worldspan sign-out QX‡I vs QX#I — omit rather than guess.
      );
      break;
  }

  return commands;
}

function buildQueueCommands(
  gds: QueueGdsSystem,
  queueNumber: number,
  travelportHost?: TravelportHost,
): QueueCommand[] {
  switch (gds) {
    case 'AMADEUS':
      return [
        { gds, command: `QR/${queueNumber}`, description: `Read queue ${queueNumber}` },
        { gds, command: `QD/${queueNumber}`, description: `Display queue ${queueNumber} count` },
        {
          gds,
          command: `QC/${queueNumber}`,
          description: `Clear current item from queue ${queueNumber}`,
        },
        { gds, command: `QN`, description: 'Move to next item in queue' },
        { gds, command: `QF`, description: 'Exit queue mode' },
      ];

    case 'SABRE':
      return [
        { gds, command: `Q/${queueNumber}`, description: `Access queue ${queueNumber}` },
        { gds, command: `QD/${queueNumber}`, description: `Display queue ${queueNumber} count` },
        { gds, command: `QR`, description: 'Remove current PNR from queue' },
        { gds, command: `QN`, description: 'Move to next item in queue' },
        { gds, command: `QP`, description: 'Exit queue mode' },
      ];

    case 'TRAVELPORT':
      if (!travelportHost) {
        // Host required for place/list/remove — emit only shared sign-in + remove (QR).
        // TODO: DOMAIN_QUESTION: default Travelport host when caller omits travelport_host?
        return [
          {
            gds,
            command: `Q/${queueNumber}`,
            description: `Sign into queue ${queueNumber} (Travelport host unspecified)`,
          },
          {
            gds,
            command: 'QR',
            description: 'Remove current item from queue (shared across Travelport hosts)',
          },
        ];
      }
      return buildTravelportHostCommands(travelportHost, queueNumber);
  }
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export function processQueue(input: QueueManagementInput): QueueManagementOutput {
  const now = currentTime(input);

  const results: QueueProcessingResult[] = input.entries.map((entry) => {
    const priority = assignPriority(entry, now);
    const { action, reason, target_agent } = determineAction(entry, priority);

    return {
      item_id: entry.item_id,
      record_locator: entry.record_locator,
      priority,
      status: 'pending' as const,
      action,
      reason,
      target_agent,
    };
  });

  // Sort by priority: urgent > high > normal > low
  const priorityOrder: Record<QueuePriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  results.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const summary = {
    total: results.length,
    urgent: results.filter((r) => r.priority === 'urgent').length,
    high: results.filter((r) => r.priority === 'high').length,
    normal: results.filter((r) => r.priority === 'normal').length,
    low: results.filter((r) => r.priority === 'low').length,
  };

  const commands =
    input.gds && input.queue_number != null
      ? buildQueueCommands(input.gds, input.queue_number, input.travelport_host)
      : undefined;

  return { results, commands, summary };
}
