/**
 * Refund Processing — Unit Tests
 *
 * Agent 6.1: ATPCO Cat 33 refund with penalty, commission recall, BSP/ARC.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { RefundProcessing } from '../index.js';
import type {
  RefundProcessingInput,
  RefundProcessingResult,
  TaxItem,
  CouponRefundItem,
  Cat33Rules,
} from '../types.js';
import type { AgentOutput } from '@otaip/core';
import { isDomainInputRequired } from '@otaip/core';

function assertRefund(result: AgentOutput<RefundProcessingResult>) {
  if (isDomainInputRequired(result.data)) {
    throw new Error(`unexpected DOMAIN_INPUT_REQUIRED: ${result.data.description}`);
  }
  return result.data;
}

const require = createRequire(import.meta.url);
const TEST_CAT33_RULES = require('./fixtures/test-cat33-rules.json') as Cat33Rules;

let agent: RefundProcessing;

beforeAll(async () => {
  agent = new RefundProcessing();
  await agent.initialize();
});

afterAll(() => {
  agent.destroy();
});

const BASE_TAXES: TaxItem[] = [
  { code: 'GB', amount: '85.00', currency: 'USD' },
  { code: 'US', amount: '20.00', currency: 'USD' },
  { code: 'YQ', amount: '15.00', currency: 'USD' },
];

function makeInput(overrides: Partial<RefundProcessingInput> = {}): RefundProcessingInput {
  return {
    ticket_number: '1251234567890',
    issuing_carrier: 'BA',
    passenger_name: 'SMITH/JOHN',
    record_locator: 'ABC123',
    base_fare: '450.00',
    base_fare_currency: 'USD',
    taxes: BASE_TAXES,
    commission: { amount: '31.50', type: 'PERCENTAGE', rate: 7 },
    refund_type: 'FULL',
    total_coupons: 4,
    fare_basis: 'HOWUS',
    is_refundable: true,
    settlement_system: 'BSP',
    current_date: '2026-04-01',
    cat33_rules: TEST_CAT33_RULES,
    ...overrides,
  };
}

describe('Refund Processing', () => {
  describe('Full refund', () => {
    it('applies penalty for restricted fare', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(Number(assertRefund(result).refund.penalty_applied)).toBeGreaterThan(0);
    });

    it('calculates base fare refund after penalty', async () => {
      const result = await agent.execute({ data: makeInput() });
      const base = Number(assertRefund(result).refund.base_fare_refund);
      expect(base).toBeLessThan(450);
      expect(base).toBeGreaterThan(0);
    });

    it('refunds all taxes', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(assertRefund(result).refund.tax_refund).toBe('120.00');
    });

    it('calculates total refund', async () => {
      const result = await agent.execute({ data: makeInput() });
      const total = Number(assertRefund(result).refund.total_refund);
      expect(total).toBeGreaterThan(0);
    });

    it('no penalty for Y class (full fare)', async () => {
      const result = await agent.execute({ data: makeInput({ fare_basis: 'YOWUS' }) });
      expect(assertRefund(result).refund.penalty_applied).toBe('0.00');
      expect(assertRefund(result).refund.base_fare_refund).toBe('450.00');
    });

    it('no penalty for business class', async () => {
      const result = await agent.execute({ data: makeInput({ fare_basis: 'COWUS' }) });
      expect(assertRefund(result).refund.penalty_applied).toBe('0.00');
    });

    it('higher penalty for deep discount (E/G)', async () => {
      const result = await agent.execute({ data: makeInput({ fare_basis: 'EOWUS' }) });
      expect(Number(assertRefund(result).refund.penalty_applied)).toBe(300);
    });

    it('lists all coupons as refunded', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(assertRefund(result).refund.audit.coupons_refunded).toEqual([1, 2, 3, 4]);
    });
  });

  describe('ATPCO default — no Cat33 conditions/charges matched', () => {
    it('voluntary refund with no Cat33 data: free refund (not fail-closed)', async () => {
      const result = await agent.execute({
        data: makeInput({ cat33_rules: undefined }),
      });
      expect(assertRefund(result).refund.penalty_applied).toBe('0.00');
      expect(assertRefund(result).refund.base_fare_refund).toBe('450.00');
    });

    it('rules present but no provision match: free refund (not fail-closed)', async () => {
      const result = await agent.execute({
        data: makeInput({
          fare_basis: 'ZZZNORULE',
          cat33_rules: { rules: TEST_CAT33_RULES.rules },
        }),
      });
      // ZZZNORULE matches none of the fixture patterns → free
      expect(assertRefund(result).refund.penalty_applied).toBe('0.00');
      expect(assertRefund(result).refund.base_fare_refund).toBe('450.00');
    });

    it('involuntary refund with no rules: penalty = 0, full refund regardless of fare basis', async () => {
      const result = await agent.execute({
        data: makeInput({
          cat33_rules: undefined,
          is_involuntary: true,
          fare_basis: 'HOWBASIC',
          is_refundable: false,
        }),
      });
      expect(assertRefund(result).refund.penalty_applied).toBe('0.00');
      expect(assertRefund(result).refund.base_fare_refund).toBe('450.00');
    });

    it('involuntary refund with rules: penalty still waived to 0', async () => {
      const result = await agent.execute({
        data: makeInput({ is_involuntary: true, fare_basis: 'EOWUS' }),
      });
      expect(assertRefund(result).refund.penalty_applied).toBe('0.00');
      expect(assertRefund(result).refund.base_fare_refund).toBe('450.00');
    });
  });

  describe('Non-refundable fares', () => {
    it('forfeits base fare for BASIC economy', async () => {
      const result = await agent.execute({
        data: makeInput({ fare_basis: 'HOWBASIC', is_refundable: false }),
      });
      expect(assertRefund(result).refund.base_fare_refund).toBe('0.00');
      expect(assertRefund(result).refund.tax_refund).toBe('120.00');
    });

    it('forfeits base fare for NR fares', async () => {
      const result = await agent.execute({
        data: makeInput({ fare_basis: 'HOWNR', is_refundable: false }),
      });
      expect(assertRefund(result).refund.base_fare_refund).toBe('0.00');
    });

    it('taxes still refundable on non-refundable fare', async () => {
      const result = await agent.execute({
        data: makeInput({ fare_basis: 'HOWBASIC', is_refundable: false }),
      });
      expect(Number(assertRefund(result).refund.tax_refund)).toBeGreaterThan(0);
    });
  });

  describe('Tax-only refund', () => {
    it('refunds only taxes', async () => {
      const result = await agent.execute({ data: makeInput({ refund_type: 'TAX_ONLY' }) });
      expect(assertRefund(result).refund.base_fare_refund).toBe('0.00');
      expect(assertRefund(result).refund.tax_refund).toBe('120.00');
    });

    it('no penalty on tax-only refund', async () => {
      const result = await agent.execute({ data: makeInput({ refund_type: 'TAX_ONLY' }) });
      expect(assertRefund(result).refund.penalty_applied).toBe('0.00');
    });
  });

  describe('Partial refund', () => {
    it('fail-closed without partial_valuation method', async () => {
      const coupons: CouponRefundItem[] = [
        { coupon_number: 1, status: 'O', refundable: true },
        { coupon_number: 2, status: 'O', refundable: true },
      ];
      const result = await agent.execute({
        data: makeInput({ refund_type: 'PARTIAL', coupons_to_refund: coupons }),
      });
      expect(result.data).toMatchObject({ status: 'DOMAIN_INPUT_REQUIRED' });
      if (!('missing' in result.data)) throw new Error('expected domain sentinel');
      expect(result.data.missing).toContain('partial_valuation');
      expect(result.data.description).toMatch(/THB|IATA Ticketing Handbook/i);
      expect(result.data.description).toMatch(/MPA-P/);
      expect(result.confidence).toBe(0);
    });

    it('applies Cat 33 penalty to PUBLISHED_FARE unused base (not coupon-ratio)', async () => {
      // Made-up: ticketed 800, published flown 480 → unused 320; fixture HOWUS penalty 200
      const coupons: CouponRefundItem[] = [
        { coupon_number: 2, status: 'O', refundable: true },
      ];
      const result = await agent.execute({
        data: makeInput({
          base_fare: '800.00',
          refund_type: 'PARTIAL',
          coupons_to_refund: coupons,
          total_coupons: 2,
          fare_basis: 'HOWUS',
          partial_valuation: {
            method: 'PUBLISHED_FARE',
            unused_base_fare: '320.00',
            flown_base_fare: '480.00',
            unused_taxes: [{ code: 'GB', amount: '55.00', currency: 'USD' }],
          },
        }),
      });
      if ('status' in result.data) throw new Error('unexpected domain sentinel');
      expect(assertRefund(result).refund.audit.residual_method).toBe('PUBLISHED_FARE');
      expect(assertRefund(result).refund.audit.flown_base_fare).toBe('480.00');
      expect(assertRefund(result).refund.tax_refund).toBe('55.00');
      expect(assertRefund(result).refund.penalty_applied).toBe('200.00');
      expect(assertRefund(result).refund.base_fare_refund).toBe('120.00');
    });

    it('no Cat 33 data + PUBLISHED_FARE: free penalty on unused base (not fail-closed)', async () => {
      const coupons: CouponRefundItem[] = [
        { coupon_number: 2, status: 'O', refundable: true },
      ];
      const result = await agent.execute({
        data: makeInput({
          base_fare: '800.00',
          refund_type: 'PARTIAL',
          coupons_to_refund: coupons,
          total_coupons: 2,
          cat33_rules: undefined,
          partial_valuation: {
            method: 'PUBLISHED_FARE',
            unused_base_fare: '320.00',
            flown_base_fare: '480.00',
            unused_taxes: [{ code: 'GB', amount: '55.00', currency: 'USD' }],
          },
        }),
      });
      if ('status' in result.data) throw new Error('unexpected domain sentinel');
      expect(assertRefund(result).refund.penalty_applied).toBe('0.00');
      expect(assertRefund(result).refund.base_fare_refund).toBe('320.00');
    });

    it('does not invent coupon-ratio tax when unused taxes are supplied', async () => {
      const coupons: CouponRefundItem[] = [{ coupon_number: 3, status: 'O', refundable: true }];
      const result = await agent.execute({
        data: makeInput({
          refund_type: 'PARTIAL',
          coupons_to_refund: coupons,
          cat33_rules: undefined,
          partial_valuation: {
            method: 'PUBLISHED_FARE',
            unused_base_fare: '112.50',
            unused_taxes: [
              { code: 'GB', amount: '20.00', currency: 'USD' },
              { code: 'US', amount: '5.00', currency: 'USD' },
            ],
          },
        }),
      });
      if ('status' in result.data) throw new Error('unexpected domain sentinel');
      expect(assertRefund(result).refund.tax_refund).toBe('25.00');
      expect(assertRefund(result).refund.base_fare_refund).toBe('112.50');
    });

    it('only refunds coupons marked as refundable', async () => {
      const coupons: CouponRefundItem[] = [
        { coupon_number: 1, status: 'O', refundable: true },
        { coupon_number: 2, status: 'L', refundable: false },
      ];
      const result = await agent.execute({
        data: makeInput({
          refund_type: 'PARTIAL',
          coupons_to_refund: coupons,
          cat33_rules: undefined,
          partial_valuation: {
            method: 'CARRIER_SPECIFIC',
            unused_base_fare: '200.00',
            unused_taxes: [{ code: 'GB', amount: '10.00', currency: 'USD' }],
          },
        }),
      });
      if ('status' in result.data) throw new Error('unexpected domain sentinel');
      expect(assertRefund(result).refund.audit.coupons_refunded).toEqual([1]);
      expect(assertRefund(result).refund.audit.residual_method).toBe('CARRIER_SPECIFIC');
    });
  });

  describe('Waiver code', () => {
    it('bare waiver_code fails closed (≠ free; same split as #153)', async () => {
      const result = await agent.execute({ data: makeInput({ waiver_code: 'WAIVER123' }) });
      expect(result.data).toMatchObject({ status: 'DOMAIN_INPUT_REQUIRED' });
      if (!('missing' in result.data)) throw new Error('expected domain sentinel');
      expect(result.data.missing).toContain('waiver_effect');
      expect(result.data.description).toMatch(/waiver_effect|Bare waiver/i);
    });

    it('bare waiver on PARTIAL fails closed even when valuation supplied', async () => {
      const result = await agent.execute({
        data: makeInput({
          refund_type: 'PARTIAL',
          coupons_to_refund: [{ coupon_number: 1, status: 'O', refundable: true }],
          waiver_code: 'W',
          partial_valuation: {
            method: 'PUBLISHED_FARE',
            unused_base_fare: '100.00',
            unused_taxes: [{ code: 'GB', amount: '10.00', currency: 'USD' }],
          },
        }),
      });
      expect(result.data).toMatchObject({ status: 'DOMAIN_INPUT_REQUIRED' });
      if (!('missing' in result.data)) throw new Error('expected domain sentinel');
      expect(result.data.missing).toContain('waiver_effect');
    });
  });

  describe('Commission recall', () => {
    it('recalls proportional commission on full refund', async () => {
      const result = await agent.execute({
        data: makeInput({ cat33_rules: undefined }), // free — full base refund
      });
      expect(assertRefund(result).commission_recalled).toBe('31.50'); // full commission
    });

    it('recalls proportional commission on partial refund', async () => {
      const coupons: CouponRefundItem[] = [{ coupon_number: 1, status: 'O', refundable: true }];
      const result = await agent.execute({
        data: makeInput({
          refund_type: 'PARTIAL',
          coupons_to_refund: coupons,
          cat33_rules: undefined,
          partial_valuation: {
            method: 'PUBLISHED_FARE',
            unused_base_fare: '112.50',
            unused_taxes: [{ code: 'GB', amount: '10.00', currency: 'USD' }],
          },
        }),
      });
      if ('status' in result.data) throw new Error('unexpected domain sentinel');
      // unused base 112.50 → commission recall = 31.50 * 112.50/450 = 7.875 → 7.88
      expect(Number(assertRefund(result).commission_recalled)).toBeGreaterThan(0);
      expect(Number(assertRefund(result).commission_recalled)).toBeLessThan(31.5);
    });

    it('no commission recall when no commission data', async () => {
      const result = await agent.execute({ data: makeInput({ commission: undefined }) });
      expect(assertRefund(result).commission_recalled).toBe('0.00');
    });

    it('no commission recall on tax-only refund', async () => {
      const result = await agent.execute({ data: makeInput({ refund_type: 'TAX_ONLY' }) });
      expect(assertRefund(result).commission_recalled).toBe('0.00');
    });
  });

  describe('BSP/ARC reporting', () => {
    it('generates BSP fields for BSP settlement', async () => {
      const result = await agent.execute({ data: makeInput({ settlement_system: 'BSP' }) });
      expect(assertRefund(result).refund.bsp_fields).toBeDefined();
      expect(assertRefund(result).refund.bsp_fields!.refund_indicator).toBe('R');
      expect(assertRefund(result).refund.bsp_fields!.original_ticket_number).toBe('1251234567890');
    });

    it('generates ARC fields for ARC settlement', async () => {
      const result = await agent.execute({ data: makeInput({ settlement_system: 'ARC' }) });
      expect(assertRefund(result).refund.arc_fields).toBeDefined();
      expect(assertRefund(result).refund.arc_fields!.refund_type_indicator).toBe('R');
    });

    it('no ARC fields on BSP ticket', async () => {
      const result = await agent.execute({ data: makeInput({ settlement_system: 'BSP' }) });
      expect(assertRefund(result).refund.arc_fields).toBeUndefined();
    });
  });

  describe('Conjunction tickets', () => {
    it('records conjunction tickets in audit', async () => {
      const input = makeInput({ conjunction_tickets: ['1251234567891', '1251234567892'] });
      const result = await agent.execute({ data: input });
      expect(assertRefund(result).refund.audit.conjunction_tickets).toHaveLength(2);
    });

    it('rejects partial refund for conjunction set', async () => {
      const input = makeInput({
        conjunction_tickets: ['1251234567891'],
        refund_type: 'PARTIAL',
        coupons_to_refund: [{ coupon_number: 1, status: 'O', refundable: true }],
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('warns about conjunction refund', async () => {
      const input = makeInput({ conjunction_tickets: ['1251234567891'] });
      const result = await agent.execute({ data: input });
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.includes('Conjunction'))).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('rejects invalid ticket number', async () => {
      await expect(agent.execute({ data: makeInput({ ticket_number: 'BAD' }) })).rejects.toThrow(
        'Invalid input',
      );
    });

    it('rejects invalid carrier', async () => {
      await expect(agent.execute({ data: makeInput({ issuing_carrier: 'X' }) })).rejects.toThrow(
        'Invalid input',
      );
    });

    it('rejects invalid passenger name', async () => {
      await expect(agent.execute({ data: makeInput({ passenger_name: 'bad' }) })).rejects.toThrow(
        'Invalid input',
      );
    });

    it('rejects invalid refund type', async () => {
      await expect(
        agent.execute({ data: makeInput({ refund_type: 'INVALID' as 'FULL' }) }),
      ).rejects.toThrow('Invalid input');
    });

    it('rejects partial without coupons', async () => {
      await expect(
        agent.execute({ data: makeInput({ refund_type: 'PARTIAL', coupons_to_refund: [] }) }),
      ).rejects.toThrow('Invalid input');
    });

    it('rejects invalid settlement system', async () => {
      await expect(
        agent.execute({ data: makeInput({ settlement_system: 'INVALID' as 'BSP' }) }),
      ).rejects.toThrow('Invalid input');
    });
  });

  describe('Agent interface compliance', () => {
    it('has correct metadata', () => {
      expect(agent.id).toBe('6.1');
      expect(agent.name).toBe('Refund Processing');
      expect(agent.version).toBe('0.1.0');
    });

    it('reports healthy', async () => {
      expect((await agent.health()).status).toBe('healthy');
    });

    it('returns metadata in output', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.metadata!['agent_id']).toBe('6.1');
      expect(result.metadata!['refund_type']).toBe('FULL');
    });

    it('throws when not initialized', async () => {
      const uninit = new RefundProcessing();
      await expect(uninit.execute({ data: makeInput() })).rejects.toThrow('not been initialized');
    });

    it('reports unhealthy when not initialized', async () => {
      const uninit = new RefundProcessing();
      expect((await uninit.health()).status).toBe('unhealthy');
    });
  });
});
