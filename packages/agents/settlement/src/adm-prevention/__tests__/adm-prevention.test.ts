/**
 * ADM Prevention — Unit Tests
 *
 * Agent 6.2: 10 pre-ticketing audit checks.
 * Domain: docs/knowledge-base/adm-prevention.md
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ADMPrevention, ADM_CHECK_COUNT, CORE_BLOCKING_STATUSES } from '../index.js';
import type { ADMPreventionInput, BookingRecord, BookingSegment, ADMCheckId } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

let agent: ADMPrevention;

beforeAll(async () => {
  agent = new ADMPrevention();
  await agent.initialize();
});

afterAll(() => {
  agent.destroy();
});

function makeSegment(overrides: Partial<BookingSegment> = {}): BookingSegment {
  return {
    carrier: 'BA',
    flight_number: '115',
    origin: 'LHR',
    destination: 'JFK',
    departure_date: '2026-06-15',
    status: 'HK',
    booking_class: 'H',
    ...overrides,
  };
}

function makeBooking(overrides: Partial<BookingRecord> = {}): BookingRecord {
  return {
    record_locator: 'ABC123',
    passenger_name: 'SMITH/JOHN',
    segments: [makeSegment()],
    base_fare: '450.00',
    base_fare_currency: 'USD',
    ...overrides,
  };
}

function makeInput(overrides: Partial<ADMPreventionInput> = {}): ADMPreventionInput {
  return {
    booking: makeBooking(),
    fare_basis: 'HOWUS',
    booked_class: 'H',
    current_datetime: '2026-04-01T12:00:00Z',
    ...overrides,
  };
}

describe('ADM Prevention', () => {
  describe('Check 1: Duplicate booking', () => {
    it('passes when no duplicates', async () => {
      const result = await agent.execute({ data: makeInput() });
      const check = result.data.result.checks.find((c) => c.check_id === 'DUPLICATE_BOOKING');
      expect(check!.passed).toBe(true);
    });

    it('fails when duplicate found', async () => {
      const input = makeInput({
        duplicate_check_pnrs: [
          {
            record_locator: 'DEF456',
            passenger_name: 'SMITH/JOHN',
            segments: [{ carrier: 'BA', flight_number: '115', departure_date: '2026-06-15' }],
          },
        ],
      });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'DUPLICATE_BOOKING');
      expect(check!.passed).toBe(false);
      expect(check!.severity).toBe('blocking');
    });

    it('ignores same PNR in duplicate list', async () => {
      const input = makeInput({
        duplicate_check_pnrs: [
          {
            record_locator: 'ABC123', // same as booking
            passenger_name: 'SMITH/JOHN',
            segments: [{ carrier: 'BA', flight_number: '115', departure_date: '2026-06-15' }],
          },
        ],
      });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'DUPLICATE_BOOKING');
      expect(check!.passed).toBe(true);
    });

    it('ignores different passenger', async () => {
      const input = makeInput({
        duplicate_check_pnrs: [
          {
            record_locator: 'DEF456',
            passenger_name: 'JONES/MARY',
            segments: [{ carrier: 'BA', flight_number: '115', departure_date: '2026-06-15' }],
          },
        ],
      });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'DUPLICATE_BOOKING');
      expect(check!.passed).toBe(true);
    });
  });

  describe('Check 2: Fare basis vs class mismatch', () => {
    it('passes when fare basis matches class', async () => {
      const result = await agent.execute({
        data: makeInput({ fare_basis: 'HOWUS', booked_class: 'H' }),
      });
      const check = result.data.result.checks.find((c) => c.check_id === 'FARE_CLASS_MISMATCH');
      expect(check!.passed).toBe(true);
    });

    it('fails when fare basis does not match class', async () => {
      const result = await agent.execute({
        data: makeInput({ fare_basis: 'YOWUS', booked_class: 'B' }),
      });
      const check = result.data.result.checks.find((c) => c.check_id === 'FARE_CLASS_MISMATCH');
      expect(check!.passed).toBe(false);
      expect(check!.severity).toBe('blocking');
    });

    it('allows business class cross-mapping (C/J/D)', async () => {
      const result = await agent.execute({
        data: makeInput({ fare_basis: 'COWUS', booked_class: 'J' }),
      });
      const check = result.data.result.checks.find((c) => c.check_id === 'FARE_CLASS_MISMATCH');
      expect(check!.passed).toBe(true);
    });
  });

  describe('Check 3: Passive / unable / risky status', () => {
    it('passes with active segments', async () => {
      const result = await agent.execute({ data: makeInput() });
      const check = result.data.result.checks.find((c) => c.check_id === 'PASSIVE_SEGMENT');
      expect(check!.passed).toBe(true);
    });

    it('fails with HX segment', async () => {
      const input = makeInput({
        booking: makeBooking({ segments: [makeSegment({ status: 'HX' })] }),
      });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'PASSIVE_SEGMENT');
      expect(check!.passed).toBe(false);
    });

    it('fails with UN segment', async () => {
      const input = makeInput({
        booking: makeBooking({ segments: [makeSegment({ status: 'UN' })] }),
      });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'PASSIVE_SEGMENT');
      expect(check!.passed).toBe(false);
    });

    it('fails with core set UC / NO / TK', async () => {
      expect([...CORE_BLOCKING_STATUSES].sort()).toEqual(['HX', 'NO', 'TK', 'UC', 'UN'].sort());
      for (const status of ['UC', 'NO', 'TK'] as const) {
        const input = makeInput({
          booking: makeBooking({ segments: [makeSegment({ status })] }),
        });
        const result = await agent.execute({ data: input });
        const check = result.data.result.checks.find((c) => c.check_id === 'PASSIVE_SEGMENT');
        expect(check!.passed).toBe(false);
        expect(check!.reason).toContain(status);
      }
    });

    it('fails with HN pending need', async () => {
      const input = makeInput({
        booking: makeBooking({ segments: [makeSegment({ status: 'HN' })] }),
      });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'PASSIVE_SEGMENT');
      expect(check!.passed).toBe(false);
    });

    it('fails with Amadeus passive PK', async () => {
      const input = makeInput({
        booking: makeBooking({ segments: [makeSegment({ status: 'PK' })] }),
      });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'PASSIVE_SEGMENT');
      expect(check!.passed).toBe(false);
    });

    it('notes Travelport needs no ticketing field', async () => {
      const input = makeInput({
        gds: 'TRAVELPORT',
        booking: makeBooking({ segments: [makeSegment({ status: 'UC' })] }),
      });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'PASSIVE_SEGMENT');
      expect(check!.passed).toBe(false);
      expect(check!.reason).toMatch(/no ticketing field/i);
    });
  });

  describe('Check 4: Churning (history-required)', () => {
    it('skips when no segment history (does not assume clear from HK alone)', async () => {
      const result = await agent.execute({ data: makeInput() });
      const check = result.data.result.checks.find((c) => c.check_id === 'CHURNING');
      expect(check!.passed).toBe(true);
      expect(check!.reason).toMatch(/skipped/i);
      expect(check!.reason).toMatch(/history/i);
    });

    it('fails when history shows cancel→rebook cycles on same flight', async () => {
      const input = makeInput({
        segment_history: [
          {
            timestamp: '2026-03-28T08:00:00Z',
            action: 'BOOKED',
            carrier: 'BA',
            flight_number: '115',
            departure_date: '2026-06-15',
          },
          {
            timestamp: '2026-03-28T10:00:00Z',
            action: 'CANCELLED',
            carrier: 'BA',
            flight_number: '115',
            departure_date: '2026-06-15',
          },
          {
            timestamp: '2026-03-28T10:05:00Z',
            action: 'REBOOKED',
            carrier: 'BA',
            flight_number: '115',
            departure_date: '2026-06-15',
          },
          {
            timestamp: '2026-03-29T09:00:00Z',
            action: 'CANCELLED',
            carrier: 'BA',
            flight_number: '115',
            departure_date: '2026-06-15',
          },
          {
            timestamp: '2026-03-29T09:10:00Z',
            action: 'REBOOKED',
            carrier: 'BA',
            flight_number: '115',
            departure_date: '2026-06-15',
          },
          {
            timestamp: '2026-03-30T11:00:00Z',
            action: 'CANCELLED',
            carrier: 'BA',
            flight_number: '115',
            departure_date: '2026-06-15',
          },
          {
            timestamp: '2026-03-30T11:15:00Z',
            action: 'REBOOKED',
            carrier: 'BA',
            flight_number: '115',
            departure_date: '2026-06-15',
          },
        ],
      });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'CHURNING');
      expect(check!.passed).toBe(false);
      expect(check!.severity).toBe('blocking');
    });

    it('passes when history has fewer than threshold cycles', async () => {
      const input = makeInput({
        segment_history: [
          {
            timestamp: '2026-03-28T08:00:00Z',
            action: 'BOOKED',
            carrier: 'BA',
            flight_number: '115',
            departure_date: '2026-06-15',
          },
          {
            timestamp: '2026-03-28T10:00:00Z',
            action: 'CANCELLED',
            carrier: 'BA',
            flight_number: '115',
            departure_date: '2026-06-15',
          },
          {
            timestamp: '2026-03-28T10:05:00Z',
            action: 'REBOOKED',
            carrier: 'BA',
            flight_number: '115',
            departure_date: '2026-06-15',
          },
        ],
      });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'CHURNING');
      expect(check!.passed).toBe(true);
    });
  });

  describe('Check 5: Married segment integrity', () => {
    it('passes when married segments have same status', async () => {
      const input = makeInput({
        booking: makeBooking({
          segments: [
            makeSegment({ married_group: 'M1', status: 'HK' }),
            makeSegment({ flight_number: '116', married_group: 'M1', status: 'HK' }),
          ],
        }),
      });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'MARRIED_SEGMENT');
      expect(check!.passed).toBe(true);
    });

    it('fails when married segments have different status', async () => {
      const input = makeInput({
        booking: makeBooking({
          segments: [
            makeSegment({ married_group: 'M1', status: 'HK' }),
            makeSegment({ flight_number: '116', married_group: 'M1', status: 'UN' }),
          ],
        }),
      });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'MARRIED_SEGMENT');
      expect(check!.passed).toBe(false);
    });

    it('fails Travelport DX as marriage break (no ticketing field)', async () => {
      const input = makeInput({
        gds: 'TRAVELPORT',
        booking: makeBooking({
          segments: [makeSegment({ status: 'DX', married_group: 'M1' })],
        }),
      });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'MARRIED_SEGMENT');
      expect(check!.passed).toBe(false);
      expect(check!.reason).toMatch(/Travelport DX/i);
    });
  });

  describe('Check 6: TTL expired', () => {
    it('passes when TTL is in the future', async () => {
      const input = makeInput({ ttl_deadline: '2026-04-02T12:00:00Z' });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'TTL_EXPIRED');
      expect(check!.passed).toBe(true);
    });

    it('fails when TTL is expired', async () => {
      const input = makeInput({ ttl_deadline: '2026-03-31T12:00:00Z' });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'TTL_EXPIRED');
      expect(check!.passed).toBe(false);
    });

    it('fails when TTL is within 30 minutes', async () => {
      const input = makeInput({ ttl_deadline: '2026-04-01T12:20:00Z' }); // 20 min from now
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'TTL_EXPIRED');
      expect(check!.passed).toBe(false);
    });

    it('skips when no TTL provided', async () => {
      const result = await agent.execute({ data: makeInput() });
      const check = result.data.result.checks.find((c) => c.check_id === 'TTL_EXPIRED');
      expect(check!.passed).toBe(true);
      expect(check!.reason).toContain('skipped');
    });

    it('fails on local deadline-day even when UTC has remaining hours', async () => {
      const input = makeInput({
        current_datetime: '2026-04-01T16:00:00Z',
        ttl_deadline: '2026-04-02T00:00:00Z',
        ttl_timezone: 'America/New_York',
        ttl_source: 'BOOKING',
      });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'TTL_EXPIRED');
      expect(check!.passed).toBe(false);
      expect(check!.reason).toMatch(/deadline-day/i);
    });
  });

  describe('Check 7: Commission rate', () => {
    it('passes when commission within contracted rate', async () => {
      const input = makeInput({ commission_rate: 5, carrier_contracted_rate: 7 });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'COMMISSION_RATE');
      expect(check!.passed).toBe(true);
    });

    it('fails when commission exceeds contracted rate', async () => {
      const input = makeInput({ commission_rate: 10, carrier_contracted_rate: 7 });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'COMMISSION_RATE');
      expect(check!.passed).toBe(false);
    });

    it('skips when no commission data and does not embed carrier tables', async () => {
      const result = await agent.execute({ data: makeInput() });
      const check = result.data.result.checks.find((c) => c.check_id === 'COMMISSION_RATE');
      expect(check!.passed).toBe(true);
      expect(check!.reason).toMatch(/skipped/i);
      expect(check!.reason).toMatch(/no embedded carrier commission tables/i);
    });
  });

  describe('Check 8: Endorsement box', () => {
    it('warns when restricted fare has no endorsement', async () => {
      const result = await agent.execute({ data: makeInput({ fare_basis: 'HOWUS' }) });
      const check = result.data.result.checks.find((c) => c.check_id === 'ENDORSEMENT_BOX');
      expect(check!.passed).toBe(false);
      expect(check!.severity).toBe('warning');
    });

    it('passes when restricted fare has endorsement', async () => {
      const input = makeInput({ fare_basis: 'HOWUS', endorsement: 'NON-ENDO/NON-REF' });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'ENDORSEMENT_BOX');
      expect(check!.passed).toBe(true);
    });

    it('passes for unrestricted Y class without endorsement', async () => {
      const result = await agent.execute({
        data: makeInput({ fare_basis: 'YOWUS', booked_class: 'Y' }),
      });
      const check = result.data.result.checks.find((c) => c.check_id === 'ENDORSEMENT_BOX');
      expect(check!.passed).toBe(true);
    });
  });

  describe('Check 9: Tour code format', () => {
    it('passes with valid tour code', async () => {
      const result = await agent.execute({ data: makeInput({ tour_code: 'BT123ABC' }) });
      const check = result.data.result.checks.find((c) => c.check_id === 'TOUR_CODE_FORMAT');
      expect(check!.passed).toBe(true);
    });

    it('warns with invalid tour code', async () => {
      const result = await agent.execute({ data: makeInput({ tour_code: 'invalid-code!' }) });
      const check = result.data.result.checks.find((c) => c.check_id === 'TOUR_CODE_FORMAT');
      expect(check!.passed).toBe(false);
      expect(check!.severity).toBe('warning');
    });

    it('warns when tour code exceeds 15 chars', async () => {
      const result = await agent.execute({ data: makeInput({ tour_code: 'ABCDEFGHIJ123456' }) });
      const check = result.data.result.checks.find((c) => c.check_id === 'TOUR_CODE_FORMAT');
      expect(check!.passed).toBe(false);
    });

    it('skips when no tour code', async () => {
      const result = await agent.execute({ data: makeInput() });
      const check = result.data.result.checks.find((c) => c.check_id === 'TOUR_CODE_FORMAT');
      expect(check!.passed).toBe(true);
    });
  });

  describe('Check 10: Net remit', () => {
    it('passes when base fare within net contracted', async () => {
      const input = makeInput({ is_net_remit: true, net_contracted_amount: '500.00' });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'NET_REMIT');
      expect(check!.passed).toBe(true);
    });

    it('fails when base fare exceeds net contracted', async () => {
      const input = makeInput({ is_net_remit: true, net_contracted_amount: '400.00' });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'NET_REMIT');
      expect(check!.passed).toBe(false);
      expect(check!.severity).toBe('blocking');
    });

    it('fails when net remit but no contracted amount', async () => {
      const input = makeInput({ is_net_remit: true });
      const result = await agent.execute({ data: input });
      const check = result.data.result.checks.find((c) => c.check_id === 'NET_REMIT');
      expect(check!.passed).toBe(false);
    });

    it('skips when not net remit', async () => {
      const result = await agent.execute({ data: makeInput() });
      const check = result.data.result.checks.find((c) => c.check_id === 'NET_REMIT');
      expect(check!.passed).toBe(true);
    });
  });

  describe('Scary false-negative fixtures', () => {
    const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'));

    it('loads all five scary fixtures', () => {
      expect(files.sort()).toEqual(
        [
          'churn-all-hk-now.json',
          'ttl-deadline-day-tz.json',
          'travelport-dx-marriage.json',
          'uc-hn-passive-pk.json',
          'uncleared-tk.json',
        ].sort(),
      );
    });

    for (const file of files) {
      it(`encodes fixture ${file}`, async () => {
        const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8')) as Record<
          string,
          unknown
        >;
        const expectMap = raw['expect'] as Record<string, boolean>;
        const { expect: _e, _comment: _c, ...inputFields } = raw;
        const result = await agent.execute({
          data: inputFields as unknown as ADMPreventionInput,
        });

        expect(result.data.result.overall_pass).toBe(expectMap['overall_pass']);

        for (const [checkId, passed] of Object.entries(expectMap)) {
          if (checkId === 'overall_pass') continue;
          const check = result.data.result.checks.find(
            (c) => c.check_id === (checkId as ADMCheckId),
          );
          expect(check, `missing check ${checkId}`).toBeDefined();
          expect(check!.passed).toBe(passed);
        }
      });
    }
  });

  describe('Overall result', () => {
    it('passes when all checks pass', async () => {
      const input = makeInput({
        endorsement: 'NON-ENDO/NON-REF',
        ttl_deadline: '2026-04-02T12:00:00Z',
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.overall_pass).toBe(true);
      expect(result.data.result.blocking_count).toBe(0);
    });

    it('fails when any blocking check fails', async () => {
      const input = makeInput({
        booking: makeBooking({ segments: [makeSegment({ status: 'HX' })] }),
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.overall_pass).toBe(false);
      expect(result.data.result.blocking_count).toBeGreaterThan(0);
    });

    it('passes with warnings only (no blocking)', async () => {
      // No endorsement = warning, but no blocking issues
      const input = makeInput({
        ttl_deadline: '2026-04-02T12:00:00Z',
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.overall_pass).toBe(true);
      expect(result.data.result.warning_count).toBeGreaterThan(0);
    });

    it(`runs all ${ADM_CHECK_COUNT} checks`, async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.result.checks).toHaveLength(ADM_CHECK_COUNT);
      expect(ADM_CHECK_COUNT).toBe(10);
    });
  });

  describe('Input validation', () => {
    it('rejects invalid record locator', async () => {
      const input = makeInput({ booking: makeBooking({ record_locator: 'bad' }) });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects invalid passenger name', async () => {
      const input = makeInput({ booking: makeBooking({ passenger_name: 'bad' }) });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects empty segments', async () => {
      const input = makeInput({ booking: makeBooking({ segments: [] }) });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects empty fare basis', async () => {
      await expect(agent.execute({ data: makeInput({ fare_basis: '' }) })).rejects.toThrow(
        'Invalid input',
      );
    });

    it('rejects invalid booked class', async () => {
      await expect(agent.execute({ data: makeInput({ booked_class: 'XX' }) })).rejects.toThrow(
        'Invalid input',
      );
    });
  });

  describe('Agent interface compliance', () => {
    it('has correct metadata', () => {
      expect(agent.id).toBe('6.2');
      expect(agent.name).toBe('ADM Prevention');
    });

    it('reports healthy', async () => {
      expect((await agent.health()).status).toBe('healthy');
    });

    it('returns metadata in output', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.metadata!['agent_id']).toBe('6.2');
      expect(result.metadata!['checks_run']).toBe(ADM_CHECK_COUNT);
    });

    it('warns on blocking issues', async () => {
      const input = makeInput({
        booking: makeBooking({ segments: [makeSegment({ status: 'HX' })] }),
      });
      const result = await agent.execute({ data: input });
      expect(result.warnings!.some((w) => w.includes('blocking'))).toBe(true);
    });

    it('throws when not initialized', async () => {
      const uninit = new ADMPrevention();
      await expect(uninit.execute({ data: makeInput() })).rejects.toThrow('not been initialized');
    });
  });
});
