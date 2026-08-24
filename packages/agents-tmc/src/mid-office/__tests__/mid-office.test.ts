/**
 * Mid-Office Automation — Unit Tests (Agent 8.3)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MidOfficeAgent } from '../index.js';
import type { MidOfficeInput, MockPnr, PnrSegment } from '../types.js';

let agent: MidOfficeAgent;

beforeAll(async () => {
  agent = new MidOfficeAgent();
  await agent.initialize();
});

afterAll(() => {
  agent.destroy();
});

function makeSeg(overrides: Partial<PnrSegment> = {}): PnrSegment {
  return {
    carrier: 'BA',
    flight_number: '115',
    origin: 'LHR',
    destination: 'JFK',
    origin_country: 'GB',
    destination_country: 'US',
    departure_date: '2026-06-15',
    departure_time: '09:00',
    status: 'HK',
    booking_class: 'Y',
    ...overrides,
  };
}

function makePnr(overrides: Partial<MockPnr> = {}): MockPnr {
  return {
    recloc: 'ABC123',
    passenger_name: 'SMITH/JOHN',
    segments: [makeSeg()],
    ticket_deadline: '2026-06-10T12:00:00Z',
    apis_complete: true,
    contact_present: true,
    fop_present: true,
    ...overrides,
  };
}

function makeInput(overrides: Partial<MidOfficeInput> = {}): MidOfficeInput {
  return {
    trigger_type: 'scheduled_sweep',
    pnrs: [makePnr()],
    current_datetime: '2026-04-01T12:00:00Z',
    ...overrides,
  };
}

describe('Mid-Office Automation', () => {
  describe('TTL check', () => {
    it('no issue when deadline is far away', async () => {
      const res = await agent.execute({ data: makeInput() });
      expect(res.data.results[0]!.issues.find((i) => i.code === 'TTL_URGENT')).toBeUndefined();
    });

    it('urgent when deadline within 1 hour (different Zulu day)', async () => {
      // Crossing midnight Zulu: not deadline-day, but ≤1h window.
      const res = await agent.execute({
        data: makeInput({
          pnrs: [makePnr({ ticket_deadline: '2026-04-02T00:15:00Z' })],
          current_datetime: '2026-04-01T23:30:00Z',
        }),
      });
      expect(
        res.data.results[0]!.issues.some((i) => i.code === 'TTL_URGENT' && i.severity === 'urgent'),
      ).toBe(true);
    });

    it('high when deadline within 4 hours (different Zulu day)', async () => {
      // Same-day rule must not apply — different Zulu dates, 3h remaining.
      const res = await agent.execute({
        data: makeInput({
          pnrs: [makePnr({ ticket_deadline: '2026-04-02T01:00:00Z' })],
          current_datetime: '2026-04-01T22:00:00Z',
        }),
      });
      expect(res.data.results[0]!.issues.some((i) => i.code === 'TTL_APPROACHING')).toBe(true);
    });

    it('urgent when deadline expired', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [makePnr({ ticket_deadline: '2026-04-01T10:00:00Z' })],
          current_datetime: '2026-04-01T12:00:00Z',
        }),
      });
      expect(res.data.results[0]!.issues.some((i) => i.code === 'TTL_URGENT')).toBe(true);
    });

    it('urgent on Zulu deadline day even with many hours remaining', async () => {
      // Agency TZ (e.g. US Pacific) would still be prior calendar day at 01:00Z —
      // OTAIP uses Zulu only (T.TAU/T.TAW/ORB); QCC TZ is display-only.
      const res = await agent.execute({
        data: makeInput({
          pnrs: [makePnr({ ticket_deadline: '2026-04-01T23:00:00Z' })],
          current_datetime: '2026-04-01T01:00:00Z',
        }),
      });
      const issue = res.data.results[0]!.issues.find((i) => i.code === 'TTL_URGENT');
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(/deadline day 2026-04-01Z/i);
    });

    it('not deadline-day urgent just before Zulu midnight when >4h remain', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [makePnr({ ticket_deadline: '2026-04-02T12:00:00Z' })],
          current_datetime: '2026-04-01T23:00:00Z',
        }),
      });
      expect(res.data.results[0]!.issues.some((i) => i.code === 'TTL_URGENT')).toBe(false);
      expect(res.data.results[0]!.issues.some((i) => i.code === 'TTL_APPROACHING')).toBe(false);
    });

    it('urgent when ticket issued on deadline day (Zulu ADM pattern)', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [
            makePnr({
              ticket_deadline: '2026-04-01T23:59:00Z',
              ticket_issued_at: '2026-04-01T08:00:00Z',
            }),
          ],
          current_datetime: '2026-04-02T12:00:00Z',
        }),
      });
      const issue = res.data.results[0]!.issues.find((i) => i.code === 'TTL_URGENT');
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(/issued on deadline day/i);
    });

    it('no TTL issue when issued on a different Zulu day than deadline', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [
            makePnr({
              ticket_deadline: '2026-04-02T12:00:00Z',
              ticket_issued_at: '2026-04-01T20:00:00Z',
            }),
          ],
          current_datetime: '2026-04-03T12:00:00Z',
        }),
      });
      expect(res.data.results[0]!.issues.some((i) => i.code.startsWith('TTL_'))).toBe(false);
    });
  });

  describe('PNR completeness', () => {
    it('flags missing APIS for international', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [makePnr({ apis_complete: false })],
        }),
      });
      expect(res.data.results[0]!.issues.some((i) => i.code === 'MISSING_APIS')).toBe(true);
    });

    it('flags missing contact', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [makePnr({ contact_present: false })],
        }),
      });
      expect(res.data.results[0]!.issues.some((i) => i.code === 'MISSING_CONTACT')).toBe(true);
    });

    it('flags missing FOP', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [makePnr({ fop_present: false })],
        }),
      });
      expect(res.data.results[0]!.issues.some((i) => i.code === 'MISSING_FOP')).toBe(true);
    });

    it('no flags when complete', async () => {
      const res = await agent.execute({ data: makeInput() });
      expect(
        res.data.results[0]!.issues.filter(
          (i) =>
            i.code === 'MISSING_APIS' || i.code === 'MISSING_CONTACT' || i.code === 'MISSING_FOP',
        ),
      ).toHaveLength(0);
    });
  });

  describe('Duplicate detection', () => {
    it('detects duplicate PNR', async () => {
      const pnr = makePnr();
      const dupe = makePnr({ recloc: 'DEF456' });
      const res = await agent.execute({
        data: makeInput({
          pnrs: [pnr],
          active_pnrs: [dupe],
        }),
      });
      expect(res.data.results[0]!.issues.some((i) => i.code === 'DUPLICATE_PNR')).toBe(true);
    });

    it('no duplicate for different passenger', async () => {
      const pnr = makePnr();
      const other = makePnr({ recloc: 'DEF456', passenger_name: 'JONES/MARY' });
      const res = await agent.execute({
        data: makeInput({
          pnrs: [pnr],
          active_pnrs: [other],
        }),
      });
      expect(res.data.results[0]!.issues.some((i) => i.code === 'DUPLICATE_PNR')).toBe(false);
    });
  });

  describe('Passive segments', () => {
    it('flags HX segment', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [makePnr({ segments: [makeSeg({ status: 'HX' })] })],
        }),
      });
      expect(res.data.results[0]!.issues.some((i) => i.code === 'PASSIVE_SEGMENT')).toBe(true);
    });

    it('flags UN segment', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [makePnr({ segments: [makeSeg({ status: 'UN' })] })],
        }),
      });
      expect(res.data.results[0]!.issues.some((i) => i.code === 'PASSIVE_SEGMENT')).toBe(true);
    });

    it('no flag for HK segment', async () => {
      const res = await agent.execute({ data: makeInput() });
      expect(res.data.results[0]!.issues.some((i) => i.code === 'PASSIVE_SEGMENT')).toBe(false);
    });
  });

  describe('Policy compliance', () => {
    it('flags domestic business with corporate_id', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [
            makePnr({
              corporate_id: 'CORP001',
              segments: [
                makeSeg({ origin_country: 'US', destination_country: 'US', cabin: 'business' }),
              ],
            }),
          ],
        }),
      });
      expect(res.data.results[0]!.issues.some((i) => i.code === 'POLICY_VIOLATION')).toBe(true);
    });
  });

  describe('Married segments', () => {
    it('flags incomplete married group', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [makePnr({ segments: [makeSeg({ married_group: 'M1' })] })],
        }),
      });
      expect(res.data.results[0]!.issues.some((i) => i.code === 'MARRIED_SEGMENT_INCOMPLETE')).toBe(
        true,
      );
    });

    it('no flag when married group has 2+ segments', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [
            makePnr({
              segments: [
                makeSeg({ married_group: 'M1' }),
                makeSeg({
                  flight_number: '116',
                  origin: 'JFK',
                  destination: 'LAX',
                  married_group: 'M1',
                }),
              ],
            }),
          ],
        }),
      });
      expect(res.data.results[0]!.issues.some((i) => i.code === 'MARRIED_SEGMENT_INCOMPLETE')).toBe(
        false,
      );
    });
  });

  describe('Summary', () => {
    it('action_required when urgent issue exists', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [makePnr({ ticket_deadline: '2026-04-01T12:30:00Z' })],
          current_datetime: '2026-04-01T12:00:00Z',
        }),
      });
      expect(res.data.results[0]!.action_required).toBe(true);
    });

    it('action_required when high issue exists', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [makePnr({ apis_complete: false })],
        }),
      });
      expect(res.data.results[0]!.action_required).toBe(true);
    });

    it('no action_required for clean PNR', async () => {
      const res = await agent.execute({ data: makeInput() });
      expect(res.data.results[0]!.action_required).toBe(false);
    });

    it('counts urgent and action PNRs', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [
            makePnr({ recloc: 'A1', ticket_deadline: '2026-04-01T12:30:00Z' }),
            makePnr({ recloc: 'A2' }),
          ],
          current_datetime: '2026-04-01T12:00:00Z',
        }),
      });
      expect(res.data.urgent_count).toBe(1);
      expect(res.data.action_required_count).toBe(1);
    });

    it('processes multiple PNRs', async () => {
      const res = await agent.execute({
        data: makeInput({
          pnrs: [makePnr({ recloc: 'A1' }), makePnr({ recloc: 'A2' }), makePnr({ recloc: 'A3' })],
        }),
      });
      expect(res.data.total_pnrs).toBe(3);
      expect(res.data.results).toHaveLength(3);
    });
  });

  describe('agent compliance', () => {
    it('has correct id/name', () => {
      expect(agent.id).toBe('8.3');
      expect(agent.name).toBe('Mid-Office Automation');
    });
    it('reports healthy', async () => {
      expect((await agent.health()).status).toBe('healthy');
    });
    it('throws when not initialized', async () => {
      const u = new MidOfficeAgent();
      await expect(u.execute({ data: makeInput() })).rejects.toThrow('not been initialized');
    });
  });
});
