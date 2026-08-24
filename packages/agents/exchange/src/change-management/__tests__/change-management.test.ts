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
  ChangeManagementResult,
  Cat31Rules,
  OriginalTicketSummary,
  RequestedItinerary,
} from '../types.js';
import type { AgentOutput } from '@otaip/core';
import { isDomainInputRequired } from '@otaip/core';

function assertAssessment(result: AgentOutput<ChangeManagementResult>) {
  if (isDomainInputRequired(result.data)) {
    throw new Error(`unexpected DOMAIN_INPUT_REQUIRED: ${result.data.description}`);
  }
  return result.data.assessment;
}

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
      if ('status' in result.data) throw new Error('unexpected domain sentinel');
      expect(assertAssessment(result).fare_difference).toBe('100.00');
    });

    it('calculates additional collection on upgrade', async () => {
      const result = await agent.execute({ data: makeInput() });
      if ('status' in result.data) throw new Error('unexpected domain sentinel');
      expect(assertAssessment(result).additional_collection).toBe('100.00');
    });

    it('includes change fee for restricted fare per filed rule', async () => {
      const result = await agent.execute({ data: makeInput() });
      if ('status' in result.data) throw new Error('unexpected domain sentinel');
      expect(Number(assertAssessment(result).change_fee)).toBeGreaterThan(0);
    });

    it('calculates total due (fee + additional + tax delta)', async () => {
      const result = await agent.execute({ data: makeInput() });
      if ('status' in result.data) throw new Error('unexpected domain sentinel');
      const totalDue = Number(assertAssessment(result).total_due);
      expect(totalDue).toBeGreaterThan(0);
    });

    it('calculates residual value as full ticketed base (not original − fee)', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data).not.toHaveProperty('status', 'DOMAIN_INPUT_REQUIRED');
      if ('status' in result.data) throw new Error('unexpected domain sentinel');
      // Fully unused: residual = original base; change fee is separate (issue #150)
      expect(assertAssessment(result).residual_value).toBe('450.00');
      expect(assertAssessment(result).residual_method).toBe('FULLY_UNUSED');
      expect(Number(assertAssessment(result).change_fee)).toBeGreaterThan(0);
    });

    it('fail-closed when partially used without residual valuation method', async () => {
      const result = await agent.execute({
        data: makeInput({ ticket_usage: 'PARTIALLY_USED' }),
      });
      expect(result.data).toMatchObject({
        status: 'DOMAIN_INPUT_REQUIRED',
      });
      if (!('missing' in result.data)) throw new Error('expected domain sentinel');
      expect(result.data.missing).toContain('residual_valuation');
      expect(result.confidence).toBe(0);
    });

    it('uses CAT33_THB unused base when residual_valuation supplied', async () => {
      const result = await agent.execute({
        data: makeInput({
          ticket_usage: 'PARTIALLY_USED',
          residual_valuation: {
            method: 'CAT33_THB',
            unused_base_fare: '320.00',
            flown_base_fare: '480.00',
            unused_taxes: [{ code: 'GB', amount: '40.00', currency: 'USD' }],
          },
        }),
      });
      if ('status' in result.data) throw new Error('unexpected domain sentinel');
      expect(assertAssessment(result).residual_value).toBe('320.00');
      expect(assertAssessment(result).residual_method).toBe('CAT33_THB');
    });

    it('sets action to REISSUE for fare change', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(assertAssessment(result).action).toBe('REISSUE');
    });

    it('calculates tax difference', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(assertAssessment(result).tax_difference).toBe('10.00');
    });
  });

  describe('ATPCO default — no Cat31 rules supplied', () => {
    it('voluntary change with no rules: penalty = 0 (ATPCO default)', async () => {
      const result = await agent.execute({
        data: makeInput({ cat31_rules: undefined }),
      });
      expect(assertAssessment(result).change_fee).toBe('0.00');
      expect(assertAssessment(result).fee_waived).toBe(false);
      expect(assertAssessment(result).summary).toContain('ATPCO default');
    });

    it('involuntary change with no rules: penalty = 0, fee_waived = true', async () => {
      const result = await agent.execute({
        data: makeInput({ cat31_rules: undefined, is_involuntary: true }),
      });
      expect(assertAssessment(result).change_fee).toBe('0.00');
      expect(assertAssessment(result).fee_waived).toBe(true);
      expect(assertAssessment(result).summary).toContain('Involuntary');
    });

    it('involuntary change with rules: filed penalty still waived to 0', async () => {
      const result = await agent.execute({
        data: makeInput({ is_involuntary: true }),
      });
      expect(assertAssessment(result).change_fee).toBe('0.00');
      expect(assertAssessment(result).fee_waived).toBe(true);
    });
  });

  describe('Fare difference scenarios', () => {
    it('zero fare difference when same fare', async () => {
      const input = makeInput({
        requested_itinerary: makeRequested({ new_fare: '450.00', new_tax: '120.00' }),
      });
      const result = await agent.execute({ data: input });
      expect(assertAssessment(result).fare_difference).toBe('0.00');
      expect(assertAssessment(result).additional_collection).toBe('0.00');
    });

    it('negative fare difference on downgrade', async () => {
      const input = makeInput({
        requested_itinerary: makeRequested({ new_fare: '350.00', new_tax: '110.00' }),
      });
      const result = await agent.execute({ data: input });
      expect(assertAssessment(result).fare_difference).toBe('-100.00');
    });

    it('forfeits difference on non-refundable downgrade per filed rule', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ is_refundable: false }),
        requested_itinerary: makeRequested({ new_fare: '350.00', new_tax: '110.00' }),
      });
      const result = await agent.execute({ data: input });
      expect(assertAssessment(result).forfeited_amount).toBe('100.00');
    });

    it('no forfeiture on refundable fare downgrade', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ is_refundable: true, fare_basis: 'YOWUS' }),
        requested_itinerary: makeRequested({ new_fare: '350.00', new_tax: '110.00' }),
      });
      const result = await agent.execute({ data: input });
      expect(assertAssessment(result).forfeited_amount).toBe('0.00');
    });
  });

  describe('Free change window (per filed rule)', () => {
    it('free change within 24h of booking', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ booking_date: '2026-03-15T10:00:00Z' }),
        current_datetime: '2026-03-15T20:00:00Z',
      });
      const result = await agent.execute({ data: input });
      expect(assertAssessment(result).is_free_change).toBe(true);
      expect(assertAssessment(result).change_fee).toBe('0.00');
      expect(assertAssessment(result).fee_waived).toBe(true);
    });

    it('not free after 24h window', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ booking_date: '2026-03-01T10:00:00Z' }),
        current_datetime: '2026-03-15T12:00:00Z',
      });
      const result = await agent.execute({ data: input });
      expect(assertAssessment(result).is_free_change).toBe(false);
    });

    it('full-fare Y class has no change fee per filed rule', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ fare_basis: 'YOWUS' }),
      });
      const result = await agent.execute({ data: input });
      expect(assertAssessment(result).change_fee).toBe('0.00');
    });

    it('business class has no change fee per filed rule', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ fare_basis: 'COWUS' }),
      });
      const result = await agent.execute({ data: input });
      expect(assertAssessment(result).change_fee).toBe('0.00');
    });
  });

  describe('Waiver codes', () => {
    it('waives penalty with waiver code', async () => {
      const input = makeInput({ waiver_code: 'WAIVER123' });
      const result = await agent.execute({ data: input });
      expect(assertAssessment(result).fee_waived).toBe(true);
      expect(assertAssessment(result).change_fee).toBe('0.00');
      expect(assertAssessment(result).waiver_code).toBe('WAIVER123');
    });

    it('stores waiver code on assessment', async () => {
      const input = makeInput({ waiver_code: 'ABCDEF' });
      const result = await agent.execute({ data: input });
      expect(assertAssessment(result).waiver_code).toBe('ABCDEF');
    });
  });

  describe('Reject fares (per filed reject_patterns)', () => {
    it('rejects change for BASIC economy', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ fare_basis: 'HOWBASIC' }),
      });
      const result = await agent.execute({ data: input });
      expect(assertAssessment(result).action).toBe('REJECT');
    });

    it('rejects change for NR (non-rebookable) fares', async () => {
      const input = makeInput({
        original_ticket: makeOriginal({ fare_basis: 'HOWNR' }),
      });
      const result = await agent.execute({ data: input });
      expect(assertAssessment(result).action).toBe('REJECT');
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
      expect(assertAssessment(result).action).not.toBe('REJECT');
    });
  });

  describe('Summary', () => {
    it('generates human-readable summary', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(assertAssessment(result).summary).toBeTruthy();
      expect(assertAssessment(result).summary.length).toBeGreaterThan(10);
    });

    it('summary mentions waiver when applied', async () => {
      const input = makeInput({ waiver_code: 'WAIVER123' });
      const result = await agent.execute({ data: input });
      expect(assertAssessment(result).summary).toContain('Waiver');
    });

    it('summary includes total due', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(assertAssessment(result).summary).toContain('Total due');
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
