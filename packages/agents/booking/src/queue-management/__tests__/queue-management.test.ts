/**
 * Queue Management — Unit Tests
 *
 * Agent 3.4: GDS queue monitoring and processing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueueManagement } from '../index.js';
import type { QueueManagementInput, QueueEntry } from '../types.js';

let agent: QueueManagement;

beforeAll(async () => {
  agent = new QueueManagement();
  await agent.initialize();
});

afterAll(() => {
  agent.destroy();
});

function makeEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    item_id: 'Q001',
    record_locator: 'ABC123',
    gds: 'AMADEUS',
    queue_number: 7,
    entry_type: 'TTL_DEADLINE',
    placed_at: '2026-03-29T10:00:00Z',
    deadline: '2026-03-30T23:59:00Z',
    remark: 'TTL/30MAR',
    passenger_count: 2,
    segment_count: 4,
    ...overrides,
  };
}

function makeInput(overrides: Partial<QueueManagementInput> = {}): QueueManagementInput {
  return {
    entries: [makeEntry()],
    current_time: '2026-03-30T12:00:00Z', // 12 hours before deadline
    ...overrides,
  };
}

describe('Queue Management', () => {
  // -------------------------------------------------------------------------
  // Priority assignment
  // -------------------------------------------------------------------------
  describe('Priority assignment', () => {
    it('assigns urgent to TTL < 24h', async () => {
      const input = makeInput({
        entries: [makeEntry({ deadline: '2026-03-30T23:59:00Z' })],
        current_time: '2026-03-30T12:00:00Z', // ~12h before deadline
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.priority).toBe('urgent');
    });

    it('assigns urgent to TTL already past deadline', async () => {
      const input = makeInput({
        entries: [makeEntry({ deadline: '2026-03-29T23:59:00Z' })],
        current_time: '2026-03-30T12:00:00Z', // past deadline
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.priority).toBe('urgent');
    });

    it('assigns high to TTL 24–72h away', async () => {
      const input = makeInput({
        entries: [makeEntry({ deadline: '2026-04-01T12:00:00Z' })],
        current_time: '2026-03-30T12:00:00Z', // 48h before
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.priority).toBe('high');
    });

    it('assigns normal to TTL > 72h away', async () => {
      const input = makeInput({
        entries: [makeEntry({ deadline: '2026-04-05T23:59:00Z' })],
        current_time: '2026-03-30T12:00:00Z', // ~6 days
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.priority).toBe('normal');
    });

    it('assigns high to TTL with no deadline', async () => {
      const input = makeInput({
        entries: [makeEntry({ deadline: undefined })],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.priority).toBe('high');
    });

    it('assigns high to schedule change', async () => {
      const input = makeInput({
        entries: [makeEntry({ entry_type: 'SCHEDULE_CHANGE' })],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.priority).toBe('high');
    });

    it('assigns urgent to involuntary rebook', async () => {
      const input = makeInput({
        entries: [makeEntry({ entry_type: 'INVOLUNTARY_REBOOK' })],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.priority).toBe('urgent');
    });

    it('assigns normal to waitlist clear', async () => {
      const input = makeInput({
        entries: [makeEntry({ entry_type: 'WAITLIST_CLEAR' })],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.priority).toBe('normal');
    });

    it('assigns low to general', async () => {
      const input = makeInput({
        entries: [makeEntry({ entry_type: 'GENERAL' })],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.priority).toBe('low');
    });

    it('assigns normal to ticket reminder', async () => {
      const input = makeInput({
        entries: [makeEntry({ entry_type: 'TICKET_REMINDER' })],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.priority).toBe('normal');
    });
  });

  // -------------------------------------------------------------------------
  // Action routing
  // -------------------------------------------------------------------------
  describe('Action routing', () => {
    it('routes TTL to ticketing agent', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.results[0]!.action).toBe('ROUTE_TO_TICKETING');
      expect(result.data.results[0]!.target_agent).toBe('3.3');
    });

    it('routes schedule change to GDS/NDC router', async () => {
      const input = makeInput({
        entries: [makeEntry({ entry_type: 'SCHEDULE_CHANGE' })],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.action).toBe('ROUTE_TO_SCHEDULE_CHANGE');
      expect(result.data.results[0]!.target_agent).toBe('3.1');
    });

    it('routes waitlist clear to validation', async () => {
      const input = makeInput({
        entries: [makeEntry({ entry_type: 'WAITLIST_CLEAR' })],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.action).toBe('ROUTE_TO_WAITLIST');
      expect(result.data.results[0]!.target_agent).toBe('3.3');
    });

    it('routes involuntary rebook to reissue', async () => {
      const input = makeInput({
        entries: [makeEntry({ entry_type: 'INVOLUNTARY_REBOOK' })],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.action).toBe('ROUTE_TO_REISSUE');
      expect(result.data.results[0]!.target_agent).toBe('3.1');
    });

    it('routes general to manual review', async () => {
      const input = makeInput({
        entries: [makeEntry({ entry_type: 'GENERAL' })],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.action).toBe('ROUTE_TO_MANUAL_REVIEW');
    });

    it('includes reason in result', async () => {
      const input = makeInput({
        entries: [makeEntry({ remark: 'FLIGHT CANCELLED' })],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.reason).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Result sorting
  // -------------------------------------------------------------------------
  describe('Result sorting', () => {
    it('sorts results by priority (urgent first)', async () => {
      const input = makeInput({
        entries: [
          makeEntry({ item_id: 'Q1', entry_type: 'GENERAL' }),
          makeEntry({ item_id: 'Q2', entry_type: 'INVOLUNTARY_REBOOK' }),
          makeEntry({ item_id: 'Q3', entry_type: 'SCHEDULE_CHANGE' }),
          makeEntry({ item_id: 'Q4', entry_type: 'WAITLIST_CLEAR' }),
        ],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.item_id).toBe('Q2'); // urgent
      expect(result.data.results[1]!.item_id).toBe('Q3'); // high
      expect(result.data.results[2]!.item_id).toBe('Q4'); // normal
      expect(result.data.results[3]!.item_id).toBe('Q1'); // low
    });
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  describe('Summary counts', () => {
    it('counts priorities correctly', async () => {
      const input = makeInput({
        entries: [
          makeEntry({ item_id: 'Q1', entry_type: 'INVOLUNTARY_REBOOK' }), // urgent
          makeEntry({ item_id: 'Q2', entry_type: 'INVOLUNTARY_REBOOK', record_locator: 'DEF456' }), // urgent
          makeEntry({ item_id: 'Q3', entry_type: 'SCHEDULE_CHANGE', record_locator: 'GHI789' }), // high
          makeEntry({ item_id: 'Q4', entry_type: 'WAITLIST_CLEAR', record_locator: 'JKL012' }), // normal
          makeEntry({ item_id: 'Q5', entry_type: 'GENERAL', record_locator: 'MNO345' }), // low
        ],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.summary.total).toBe(5);
      expect(result.data.summary.urgent).toBe(2);
      expect(result.data.summary.high).toBe(1);
      expect(result.data.summary.normal).toBe(1);
      expect(result.data.summary.low).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // GDS queue commands
  // -------------------------------------------------------------------------
  describe('GDS queue commands', () => {
    it('generates Amadeus queue commands', async () => {
      const input = makeInput({ gds: 'AMADEUS', queue_number: 7 });
      const result = await agent.execute({ data: input });
      expect(result.data.commands).toBeDefined();
      expect(result.data.commands!.length).toBeGreaterThanOrEqual(3);
      expect(result.data.commands!.some((c) => c.command === 'QR/7')).toBe(true);
      expect(result.data.commands!.some((c) => c.command === 'QD/7')).toBe(true);
      expect(result.data.commands!.some((c) => c.command === 'QC/7')).toBe(true);
    });

    it('generates Sabre queue commands', async () => {
      const input = makeInput({
        entries: [makeEntry({ gds: 'SABRE', queue_number: 100 })],
        gds: 'SABRE',
        queue_number: 100,
      });
      const result = await agent.execute({ data: input });
      expect(result.data.commands).toBeDefined();
      expect(result.data.commands!.some((c) => c.command === 'Q/100')).toBe(true);
      expect(result.data.commands!.some((c) => c.command === 'QD/100')).toBe(true);
    });

    it('generates Travelport queue commands without host (shared only)', async () => {
      const input = makeInput({
        entries: [makeEntry({ gds: 'TRAVELPORT', queue_number: 7 })],
        gds: 'TRAVELPORT',
        queue_number: 7,
      });
      const result = await agent.execute({ data: input });
      expect(result.data.commands).toBeDefined();
      expect(result.data.commands!.some((c) => c.command === 'Q/7')).toBe(true);
      expect(result.data.commands!.some((c) => c.command === 'QR')).toBe(true);
      // Place/list require an explicit host — must not invent Galileo/Apollo.
      expect(result.data.commands!.some((c) => c.command.startsWith('QEB/'))).toBe(false);
      expect(result.data.commands!.some((c) => c.command.startsWith('QEP/'))).toBe(false);
    });

    it('generates Apollo place/list/remove commands', async () => {
      const input = makeInput({
        entries: [makeEntry({ gds: 'TRAVELPORT', queue_number: 40 })],
        gds: 'TRAVELPORT',
        queue_number: 40,
        travelport_host: 'APOLLO',
      });
      const result = await agent.execute({ data: input });
      const cmds = result.data.commands!.map((c) => c.command);
      expect(cmds).toContain('QEP/40');
      expect(cmds).toContain('QW');
      expect(cmds).toContain('QR');
      expect(cmds).toContain('QC/40');
      expect(cmds).toContain('QXI');
    });

    it('generates Galileo (Travelport+) place/list/remove commands', async () => {
      const input = makeInput({
        entries: [makeEntry({ gds: 'TRAVELPORT', queue_number: 40 })],
        gds: 'TRAVELPORT',
        queue_number: 40,
        travelport_host: 'GALILEO',
      });
      const result = await agent.execute({ data: input });
      const cmds = result.data.commands!.map((c) => c.command);
      expect(cmds).toContain('QEB/40');
      expect(cmds).toContain('QW');
      expect(cmds).toContain('QR');
      expect(cmds).toContain('QCB/40');
      expect(cmds).toContain('QXI');
    });

    it('generates Worldspan place/remove without QW or disputed sign-out', async () => {
      const input = makeInput({
        entries: [makeEntry({ gds: 'TRAVELPORT', queue_number: 40 })],
        gds: 'TRAVELPORT',
        queue_number: 40,
        travelport_host: 'WORLDSPAN',
      });
      const result = await agent.execute({ data: input });
      const cmds = result.data.commands!.map((c) => c.command);
      expect(cmds).toContain('QEP/40');
      expect(cmds).toContain('QR');
      expect(cmds).toContain('QC/40');
      expect(cmds).not.toContain('QW');
      // DQ-TQ1: omit Worldspan sign-out until glyph conflict resolved
      expect(cmds.some((c) => c.startsWith('QX'))).toBe(false);
    });

    it('assigns urgent on Zulu deadline day for TTL queue items', async () => {
      const input = makeInput({
        entries: [makeEntry({ deadline: '2026-03-30T23:59:00Z', entry_type: 'TTL_DEADLINE' })],
        current_time: '2026-03-30T01:00:00Z', // same Zulu day, many hours remain
      });
      const result = await agent.execute({ data: input });
      expect(result.data.results[0]!.priority).toBe('urgent');
    });

    it('omits commands when gds/queue_number not provided', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.commands).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Agent warnings
  // -------------------------------------------------------------------------
  describe('Agent warnings', () => {
    it('warns when urgent items exist', async () => {
      const input = makeInput({
        entries: [makeEntry({ entry_type: 'INVOLUNTARY_REBOOK' })],
      });
      const result = await agent.execute({ data: input });
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.includes('urgent'))).toBe(true);
    });

    it('warns when high-priority items exist', async () => {
      const input = makeInput({
        entries: [makeEntry({ entry_type: 'SCHEDULE_CHANGE' })],
      });
      const result = await agent.execute({ data: input });
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.includes('high-priority'))).toBe(true);
    });

    it('no warnings for only normal/low items', async () => {
      const input = makeInput({
        entries: [makeEntry({ entry_type: 'GENERAL' })],
      });
      const result = await agent.execute({ data: input });
      expect(result.warnings).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------
  describe('Input validation', () => {
    it('rejects empty entries', async () => {
      await expect(agent.execute({ data: { entries: [] } })).rejects.toThrow('Invalid input');
    });

    it('rejects invalid record locator', async () => {
      const input = makeInput({
        entries: [makeEntry({ record_locator: 'bad' })],
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects invalid GDS', async () => {
      const input = makeInput({
        entries: [makeEntry({ gds: 'INVALID' as 'AMADEUS' })],
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects invalid entry type', async () => {
      const input = makeInput({
        entries: [makeEntry({ entry_type: 'UNKNOWN' as 'GENERAL' })],
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects negative queue number', async () => {
      const input = makeInput({
        entries: [makeEntry({ queue_number: -1 })],
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects invalid GDS for commands', async () => {
      const input = makeInput({ gds: 'INVALID' as 'AMADEUS', queue_number: 7 });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });
  });

  // -------------------------------------------------------------------------
  // Agent interface compliance
  // -------------------------------------------------------------------------
  describe('Agent interface compliance', () => {
    it('has correct metadata', () => {
      expect(agent.id).toBe('3.4');
      expect(agent.name).toBe('Queue Management');
      expect(agent.version).toBe('0.1.0');
    });

    it('reports healthy', async () => {
      const health = await agent.health();
      expect(health.status).toBe('healthy');
    });

    it('returns metadata in output', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.metadata!['agent_id']).toBe('3.4');
      expect(result.metadata!['total_items']).toBe(1);
    });

    it('throws when not initialized', async () => {
      const uninit = new QueueManagement();
      await expect(uninit.execute({ data: makeInput() })).rejects.toThrow('not been initialized');
    });

    it('reports unhealthy when not initialized', async () => {
      const uninit = new QueueManagement();
      const health = await uninit.health();
      expect(health.status).toBe('unhealthy');
    });
  });
});
