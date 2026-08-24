/**
 * Change Management — Unit Tests
 *
 * Agent 5.1: ATPCO Cat 31 voluntary change assessment.
 *
 * Tests pass Cat31 rules in via input.cat31_rules using the test fixture
 * to exercise the apply-as-filed branch. Tests of the no-rules branch
 * verify the ATPCO default (permitted at no charge / fee waived for
 * involuntary changes).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { ChangeManagement } from '../index.js';
import type {
  ChangeManagementInput,
  Cat31Rules,
  OriginalTicketSummary,
  RequestedItinerary,
} from '../types.js';

const require = createRequire(import.meta.url);
const TEST_CAT31_RULES = require('./fixtures/test-cat31-rules.json') as Cat31Rules;

let agent: ChangeManagement;

beforeAll(async () => {
  agent = new ChangeManagement();
  await agent.initialize();
});

afterAll(() => {
  agent.destroy();
});

function makeOriginal(overrides: Partial<OriginalTicketSummary> = {}): OriginalTicketSummary {
  return {
    ticket_number: '1251234567890',
    issuing_carrier: 'BA',
    passenger_name: 'SMITH/JOHN',
    record_locator: 'ABC123',
    issue_date: '2026-03-01',
    base_fare: '450.00',
    base_fare_currency: 'USD',
    total_tax: '120.00',
    total_amount: '570.00',
    fare_basis: 'HOWUS',
    is_refundable: false,
    booking_date: '2026-03-01T10:00:00Z',
    ...overrides,
  };
}

function makeRequested(overrides: Partial<RequestedItinerary> = {}): RequestedItinerary {
  return {
    segments: [
      {
        carrier: 'BA',
        flight_number: '117',
        origin: 'LHR',
        destination: 'JFK',
        departure_date: '2026-07-01',
        booking_class: 'H',
        fare_basis: 'HOWUS',
      },
    ],
    new_fare: '550.00',
    new_fare_currency: 'USD',
    new_tax: '130.00',
    ...overrides,
  };
}

function makeInput(overrides: Partial<ChangeManagementInput> = {}): ChangeManagementInput {
  return {
    original_ticket: makeOriginal(),
    requested_itinerary: makeRequested(),
    current_datetime: '2026-03-15T12:00:00Z',
    cat31_rules: TEST_CAT31_RULES,
    ...overrides,
  };
}

describe('Change Management', () => {
  describe('Basic change assessment (with filed Cat31 rules)', () => {
    it('calculates fare difference (upgrade)', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.assessment.fare_difference).toBe('100.00');
    });

    it('calculates additional collection on upgrade', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.assessment.additional_collection).toBe('100.00');
    });

    it('includes change fee for restricted fare per filed rule', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(Number(result.data.assessment.change_fee)).toBeGreaterThan(0);
    });

    it('calculates total due (fee + additional + tax delta)', async () => {
      const result = await agent.execute({ data: makeInput() });
      const totalDue = Number(result.data.assessment.total_due);
      expect(totalDue).toBeGreaterThan(0);
    });

    it('calculates residual value', async () => {
      const result = await agent.execute({ data: makeInput() });
      const residual = Number(result.data.assessment.residual_value);
      expect(residual).toBeGreaterThan(0);
      expect(residual).toBeLessThanOrEqual(450);
    });

    it('sets action to REISSUE for fare change', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.assessment.action).toBe('REISSUE');
    });

    it('calculates tax difference', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.assessment.tax_difference).toBe('10.00');
    });
  });

  describe('ATPCO default — no Cat31 rules supplied', () => {
    it('voluntary change with no rules: penalty = 0 (ATPCO default)', async () => {
      const result = await agent.execute({
        data: makeInput({ cat31_rules: undefined }),
      });
      expect(result.data.assessment.change_fee).toBe('0.00');
      expect(result.data.assessment.fee_waived).toBe(false);
      expect(result.data.assessment.summary).toContain('ATPCO default');
    });

    it('involuntary change with no rules: penalty = 0, fee_waived = true', async () => {
      const result = await agent.execute({
        data: makeInput({ cat31_rules: undefined, is_involuntary: true }),
      });
      expect(result.data.assessment.change_fee).toBe('0.00');
      expect(result.data.assessment.fee_waived).toBe(true);
      expect(result.data.assessment.summary).toContain('Involuntary');
    });

    it('involuntary change with rules: filed penalty still waived to 0', async () => {
      const result = await agent.execute({
        data: makeInput({ is_involuntary: true }),
      });
      expect(result.data.assessment.change_fee).toBe('0.00');
      expect(result.data.assessment.fee_waived).toBe(true);
    });
  });

  describe('Fare difference scenarios', () => {
    it('zero fare difference when same fare', async () => {
      const input = makeInput({
        requested_itinerary: makeRequested({ new_fare: '450.00', new_tax: '120.00' }),
      });
      const result = await agent.execute({ data: input });
      expect(result.data.assessment.fare_difference).toBe('0.00');
      expect(result.data.assessment.additional_collection).toBe('0.00');
    });

    it('negative fare difference on downgrade', async () => {
      const input = makeInput({
        requested_itinerary: makeRequested({ new_fare: '350.00', new_tax: '110.00' }),
      });
      const result = await agent.execute({ data: input });
      expect(result.data.assessment.fare_difference).toBe('-100.00');
    });

    it('forfeits difference on non-refundable downgrade per filed rule', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ is_refundable: false }),
        requested_itinerary: makeRequested({ new_fare: '350.00', new_tax: '110.00' }),
      });
      const result = await agent.execute({ data: input });
      expect(result.data.assessment.forfeited_amount).toBe('100.00');
    });

    it('no forfeiture on refundable fare downgrade', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ is_refundable: true, fare_basis: 'YOWUS' }),
        requested_itinerary: makeRequested({ new_fare: '350.00', new_tax: '110.00' }),
      });
      const result = await agent.execute({ data: input });
      expect(result.data.assessment.forfeited_amount).toBe('0.00');
    });
  });

  describe('Free change window (per filed rule)', () => {
    it('free change within 24h of booking', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ booking_date: '2026-03-15T10:00:00Z' }),
        current_datetime: '2026-03-15T20:00:00Z',
      });
      const result = await agent.execute({ data: input });
      expect(result.data.assessment.is_free_change).toBe(true);
      expect(result.data.assessment.change_fee).toBe('0.00');
      expect(result.data.assessment.fee_waived).toBe(true);
    });

    it('not free after 24h window', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ booking_date: '2026-03-01T10:00:00Z' }),
        current_datetime: '2026-03-15T12:00:00Z',
      });
      const result = await agent.execute({ data: input });
      expect(result.data.assessment.is_free_change).toBe(false);
    });

    it('full-fare Y class has no change fee per filed rule', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ fare_basis: 'YOWUS' }),
      });
      const result = await agent.execute({ data: input });
      expect(result.data.assessment.change_fee).toBe('0.00');
    });

    it('business class has no change fee per filed rule', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ fare_basis: 'COWUS' }),
      });
      const result = await agent.execute({ data: input });
      expect(result.data.assessment.change_fee).toBe('0.00');
    });
  });

  describe('Waiver typology', () => {
    it('fail closed: waiver_code without waiver_effect', async () => {
      await expect(
        agent.execute({ data: makeInput({ waiver_code: 'WAIVER123' }) }),
      ).rejects.toThrow('waiver_effect');
    });

    it('fail closed: unknown waiver_effect', async () => {
      await expect(
        agent.execute({
          data: makeInput({
            waiver_code: 'X',
            waiver_effect: 'SKIP_EVERYTHING' as 'ELIMINATE_PENALTY',
          }),
        }),
      ).rejects.toThrow('waiver_effect');
    });

    it('ELIMINATE_PENALTY zeros filed Cat 31 fee', async () => {
      const input = makeInput({
        waiver_code: 'WAIVER123',
        waiver_effect: 'ELIMINATE_PENALTY',
      });
      const result = await agent.execute({ data: input });
      expect(result.data.assessment.fee_waived).toBe(true);
      expect(result.data.assessment.change_fee).toBe('0.00');
      expect(result.data.assessment.waiver_code).toBe('WAIVER123');
      expect(result.data.assessment.waiver_effect).toBe('ELIMINATE_PENALTY');
    });

    it('REDUCE_PENALTY FIXED keeps remaining fee', async () => {
      const result = await agent.execute({
        data: makeInput({
          waiver_code: 'RD75',
          waiver_effect: 'REDUCE_PENALTY',
          waiver_penalty_reduction: { kind: 'FIXED', amount: '75.00', currency: 'USD' },
        }),
      });
      expect(result.data.assessment.change_fee).toBe('75.00');
      expect(result.data.assessment.fee_waived).toBe(false);
    });

    it('CHANGE_REBOOKING_CLASS keeps filed fee and records constraints', async () => {
      const result = await agent.execute({
        data: makeInput({
          waiver_code: 'CLASSY',
          waiver_effect: 'CHANGE_REBOOKING_CLASS',
          permitted_booking_classes: ['B', 'H'],
        }),
      });
      expect(Number(result.data.assessment.change_fee)).toBeGreaterThan(0);
      expect(result.data.assessment.fee_waived).toBe(false);
      expect(result.data.assessment.permitted_booking_classes).toEqual(['B', 'H']);
      expect(result.data.assessment.summary).toContain('CHANGE_REBOOKING_CLASS');
    });

    it('fail closed: CHANGE_REBOOKING_CLASS without permitted lists', async () => {
      await expect(
        agent.execute({
          data: makeInput({
            waiver_code: 'CLASSY',
            waiver_effect: 'CHANGE_REBOOKING_CLASS',
          }),
        }),
      ).rejects.toThrow('permitted_booking_classes');
    });

    it('IRROP_INVOLUNTARY zeros voluntary Cat 31 fee', async () => {
      const result = await agent.execute({
        data: makeInput({
          waiver_code: 'IRROP1',
          waiver_effect: 'IRROP_INVOLUNTARY',
        }),
      });
      expect(result.data.assessment.change_fee).toBe('0.00');
      expect(result.data.assessment.fee_waived).toBe(true);
    });

    it('stores waiver code when effect is typed', async () => {
      const input = makeInput({
        waiver_code: 'ABCDEF',
        waiver_effect: 'ELIMINATE_PENALTY',
      });
      const result = await agent.execute({ data: input });
      expect(result.data.assessment.waiver_code).toBe('ABCDEF');
    });

    it('never treats bare waiver_code as general skip-penalty rule', async () => {
      await expect(
        agent.execute({ data: makeInput({ waiver_code: 'ANYTHING' }) }),
      ).rejects.toThrow(/waiver_effect|skip penalty/i);
    });
  });

  describe('Reject fares (per filed reject_patterns)', () => {
    it('rejects change for BASIC economy', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ fare_basis: 'HOWBASIC' }),
      });
      const result = await agent.execute({ data: input });
      expect(result.data.assessment.action).toBe('REJECT');
    });

    it('rejects change for NR (non-rebookable) fares', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ fare_basis: 'HOWNR' }),
      });
      const result = await agent.execute({ data: input });
      expect(result.data.assessment.action).toBe('REJECT');
    });

    it('warns when change is rejected', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ fare_basis: 'HOWBASIC' }),
      });
      const result = await agent.execute({ data: input });
      expect(result.warnings).toBeDefined();
      expect(result.warnings![0]).toContain('not permitted');
    });

    it('does NOT reject BASIC fare when no Cat31 rules supplied', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ fare_basis: 'HOWBASIC' }),
        cat31_rules: undefined,
      });
      const result = await agent.execute({ data: input });
      expect(result.data.assessment.action).not.toBe('REJECT');
    });
  });

  describe('Summary', () => {
    it('generates human-readable summary', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.assessment.summary).toBeTruthy();
      expect(result.data.assessment.summary.length).toBeGreaterThan(10);
    });

    it('summary mentions waiver when eliminate effect applied', async () => {
      const input = makeInput({
        waiver_code: 'WAIVER123',
        waiver_effect: 'ELIMINATE_PENALTY',
      });
      const result = await agent.execute({ data: input });
      expect(result.data.assessment.summary).toContain('Waiver');
      expect(result.data.assessment.summary).toContain('ELIMINATE_PENALTY');
    });

    it('summary includes total due', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.assessment.summary).toContain('Total due');
    });
  });

  describe('Input validation', () => {
    it('rejects invalid ticket number', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ ticket_number: 'BAD' }),
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects invalid carrier', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ issuing_carrier: 'X' }),
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects invalid passenger name', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ passenger_name: 'bad' }),
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects empty segments', async () => {
      const input = makeInput({
        requested_itinerary: makeRequested({ segments: [] }),
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects invalid fare amount', async () => {
      const input = makeInput({
        requested_itinerary: makeRequested({ new_fare: 'abc' }),
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });
  });

  describe('Agent interface compliance', () => {
    it('has correct metadata', () => {
      expect(agent.id).toBe('5.1');
      expect(agent.name).toBe('Change Management');
      expect(agent.version).toBe('0.1.0');
    });

    it('reports healthy', async () => {
      const health = await agent.health();
      expect(health.status).toBe('healthy');
    });

    it('returns metadata in output', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.metadata!['agent_id']).toBe('5.1');
      expect(result.metadata!['action']).toBe('REISSUE');
    });

    it('throws when not initialized', async () => {
      const uninit = new ChangeManagement();
      await expect(uninit.execute({ data: makeInput() })).rejects.toThrow('not been initialized');
    });

    it('reports unhealthy when not initialized', async () => {
      const uninit = new ChangeManagement();
      const health = await uninit.health();
      expect(health.status).toBe('unhealthy');
    });
  });
});
