/**
 * Exchange/Reissue — Unit Tests
 *
 * Agent 5.2: Ticket reissue with residual value, per-tax carryforward, GDS commands.
 * KB: docs/knowledge-base/tax-carryforward-reissue.md
 * Same O&D boolean alone must not keep all TFCs. No invented statutory rates.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ExchangeReissue } from '../index.js';
import type {
  ExchangeReissueInput,
  TaxCarryforwardContext,
  TaxCarryforwardRule,
} from '../types.js';
import {
  decideTaxCarryforward,
  decideAllTaxCarryforwards,
  TaxCarryforwardRuleMissingError,
} from '../tax-carryforward.js';

let agent: ExchangeReissue;

beforeAll(async () => {
  agent = new ExchangeReissue();
  await agent.initialize();
});

afterAll(() => {
  agent.destroy();
});

/** Illustrative amounts only — not statutory rates. */
const PLACEHOLDER = {
  gb: '85.00',
  gbNew: '90.00',
  us: '20.00',
  yq: '15.00',
  yr: '12.00',
  xa: '10.00',
} as const;

function defaultContext(overrides: Partial<TaxCarryforwardContext> = {}): TaxCarryforwardContext {
  return {
    geography_match: 'SAME_AIRPORT',
    within_validity_window: true,
    flown_status: 'UNFLOWN',
    point_of_sale_unchanged: true,
    ...overrides,
  };
}

function rulesForCodes(
  codes: string[],
  overrides: Partial<Record<string, Partial<TaxCarryforwardRule>>> = {},
): TaxCarryforwardRule[] {
  return codes.map((tax_code) => {
    const base: TaxCarryforwardRule =
      tax_code === 'YQ' || tax_code === 'YR'
        ? {
            tax_code,
            nature: 'TRANSPORT',
            min_geography: 'SAME_AIRPORT',
            carry_never: true,
            on_validity_expired: 'RECALCULATE',
          }
        : tax_code === 'US' || tax_code.startsWith('XT')
          ? {
              tax_code,
              nature: 'SALES',
              min_geography: 'SAME_CITY',
              recalculate_when_pos_changed: true,
              on_validity_expired: 'RECALCULATE',
            }
          : {
              tax_code,
              nature: 'TRANSPORT',
              min_geography: 'SAME_AIRPORT',
              recalculate_when_partially_flown: true,
              on_validity_expired: 'RECALCULATE',
            };
    return { ...base, ...overrides[tax_code], tax_code };
  });
}

function makeInput(overrides: Partial<ExchangeReissueInput> = {}): ExchangeReissueInput {
  const original_taxes = overrides.original_taxes ?? [
    { code: 'GB', amount: PLACEHOLDER.gb, currency: 'USD' },
    { code: 'US', amount: PLACEHOLDER.us, currency: 'USD' },
    { code: 'YQ', amount: PLACEHOLDER.yq, currency: 'USD' },
  ];
  const new_taxes = overrides.new_taxes ?? [
    { code: 'GB', amount: PLACEHOLDER.gbNew, currency: 'USD' },
    { code: 'US', amount: PLACEHOLDER.us, currency: 'USD' },
    { code: 'YQ', amount: PLACEHOLDER.yq, currency: 'USD' },
  ];
  const codes = [
    ...new Set([...original_taxes.map((t) => t.code), ...new_taxes.map((t) => t.code)]),
  ];

  const { tax_carryforward_rules, tax_carryforward_context, ...rest } = overrides;

  return {
    original_ticket_number: '1251234567890',
    original_issue_date: '2026-03-01',
    issuing_carrier: 'BA',
    passenger_name: 'SMITH/JOHN',
    record_locator: 'ABC123',
    original_base_fare: '450.00',
    change_fee: '200.00',
    residual_value: '450.00',
    residual_method: 'FULLY_UNUSED',
    new_segments: [
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
    fare_calculation: 'LON BA NYC 550.00 NUC550.00 END ROE1.00',
    form_of_payment: {
      type: 'CREDIT_CARD',
      card_code: 'VI',
      card_last_four: '4242',
      amount: '505.00',
      currency: 'USD',
    },
    issue_date: '2026-04-01',
    ...rest,
    original_taxes,
    new_taxes,
    tax_carryforward_context: tax_carryforward_context ?? defaultContext(),
    tax_carryforward_rules: tax_carryforward_rules ?? rulesForCodes(codes),
  };
}

describe('Exchange/Reissue', () => {
  describe('Residual value application', () => {
    it('applies residual value to new fare', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.reissue.exchange_audit.residual_applied).toBe('450.00');
      expect(result.data.reissue.exchange_audit.residual_method).toBe('FULLY_UNUSED');
    });

    it('calculates additional collection (new fare - residual + change fee + new taxes)', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(Number(result.data.additional_collection)).toBeGreaterThan(0);
    });

    it('credit when residual exceeds new fare', async () => {
      const input = makeInput({
        new_fare: '200.00',
        residual_value: '250.00',
        change_fee: '0.00',
      });
      const result = await agent.execute({ data: input });
      expect(Number(result.data.credit_amount)).toBeGreaterThan(0);
    });

    it('no credit when new fare exceeds residual', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.credit_amount).toBe('0.00');
    });
  });

  describe('Tax carryforward — per-tax decisions (not boolean same O&D)', () => {
    it('emits per-tax decisions with CARRY | RECALCULATE | FORFEIT', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.tax_decisions.length).toBeGreaterThan(0);
      for (const d of result.data.tax_decisions) {
        expect(['CARRY', 'RECALCULATE', 'FORFEIT']).toContain(d.action);
        expect(d.reason.length).toBeGreaterThan(0);
      }
      expect(result.data.reissue.exchange_audit.tax_decisions).toEqual(result.data.tax_decisions);
    });

    it('does not CARRY YQ when same airport — YQ not assumed', async () => {
      const result = await agent.execute({ data: makeInput() });
      const yq = result.data.tax_decisions.find((d) => d.tax_code === 'YQ');
      expect(yq).toBeDefined();
      expect(yq!.action).toBe('RECALCULATE');
      // Full new YQ collected — not carried from original via same-O&D
      const carried = result.data.reissue.exchange_audit.taxes_carried_forward.find(
        (t) => t.code === 'YQ',
      );
      expect(carried).toBeUndefined();
      const newYq = result.data.reissue.exchange_audit.taxes_new.find((t) => t.code === 'YQ');
      expect(newYq?.amount).toBe(PLACEHOLDER.yq);
    });

    it('does not CARRY YR without explicit_carry_authorized', async () => {
      const input = makeInput({
        original_taxes: [
          { code: 'GB', amount: PLACEHOLDER.gb, currency: 'USD' },
          { code: 'YR', amount: PLACEHOLDER.yr, currency: 'USD' },
        ],
        new_taxes: [
          { code: 'GB', amount: PLACEHOLDER.gbNew, currency: 'USD' },
          { code: 'YR', amount: PLACEHOLDER.yr, currency: 'USD' },
        ],
      });
      const result = await agent.execute({ data: input });
      const yr = result.data.tax_decisions.find((d) => d.tax_code === 'YR');
      expect(yr!.action).toBe('RECALCULATE');
    });

    it('CARRY transport tax only when airport-bound dimensions satisfied', async () => {
      const result = await agent.execute({ data: makeInput() });
      const gb = result.data.tax_decisions.find((d) => d.tax_code === 'GB');
      expect(gb!.action).toBe('CARRY');
      const gbDelta = result.data.reissue.exchange_audit.taxes_new.find((t) => t.code === 'GB');
      expect(gbDelta?.amount).toBe('5.00');
    });

    it('SAME_CITY does not CARRY airport-min geography tax', async () => {
      const input = makeInput({
        tax_carryforward_context: defaultContext({ geography_match: 'SAME_CITY' }),
      });
      const result = await agent.execute({ data: input });
      const gb = result.data.tax_decisions.find((d) => d.tax_code === 'GB');
      expect(gb!.action).toBe('RECALCULATE');
      // Boolean same-O&D city would have wrongly carried — we recalculate full new amount
      const gbNew = result.data.reissue.exchange_audit.taxes_new.find((t) => t.code === 'GB');
      expect(gbNew?.amount).toBe(PLACEHOLDER.gbNew);
    });

    it('sales tax RECALCULATE when POS changes even if geography matches', async () => {
      const input = makeInput({
        tax_carryforward_context: defaultContext({ point_of_sale_unchanged: false }),
      });
      const result = await agent.execute({ data: input });
      const us = result.data.tax_decisions.find((d) => d.tax_code === 'US');
      expect(us!.action).toBe('RECALCULATE');
      expect(us!.reason.toLowerCase()).toMatch(/sales|point of sale/);
    });

    it('validity expired uses FORFEIT when rule says so', async () => {
      const input = makeInput({
        tax_carryforward_context: defaultContext({ within_validity_window: false }),
        tax_carryforward_rules: rulesForCodes(['GB', 'US', 'YQ'], {
          GB: { on_validity_expired: 'FORFEIT' },
        }),
      });
      const result = await agent.execute({ data: input });
      const gb = result.data.tax_decisions.find((d) => d.tax_code === 'GB');
      expect(gb!.action).toBe('FORFEIT');
      expect(
        result.data.reissue.exchange_audit.taxes_carried_forward.find((t) => t.code === 'GB'),
      ).toBeUndefined();
    });

    it('partially flown forces RECALCULATE when rule requires it', async () => {
      const input = makeInput({
        tax_carryforward_context: defaultContext({ flown_status: 'PARTIALLY_FLOWN' }),
      });
      const result = await agent.execute({ data: input });
      const gb = result.data.tax_decisions.find((d) => d.tax_code === 'GB');
      expect(gb!.action).toBe('RECALCULATE');
    });

    it('fail closed when a tax code has no rule — rejects boolean-only path', async () => {
      const input = makeInput({
        tax_carryforward_rules: rulesForCodes(['GB', 'US']), // missing YQ
      });
      await expect(agent.execute({ data: input })).rejects.toThrow(/No tax carryforward rule/);
    });

    it('fail closed when tax_carryforward_context is missing', async () => {
      const input = makeInput();
      const invalid = input as ExchangeReissueInput & {
        tax_carryforward_context?: TaxCarryforwardContext;
      };
      delete invalid.tax_carryforward_context;
      await expect(agent.execute({ data: invalid })).rejects.toThrow(/tax_carryforward_context/);
    });

    it('same_origin_destination alone does not drive carry — deprecated warning only', async () => {
      const input = makeInput({
        same_origin_destination: true,
        tax_carryforward_context: defaultContext({ geography_match: 'DIFFERENT' }),
      });
      const result = await agent.execute({ data: input });
      expect(result.warnings?.some((w) => w.includes('same_origin_destination'))).toBe(true);
      // DIFFERENT geography → transport GB recalculates despite deprecated flag true
      const gb = result.data.tax_decisions.find((d) => d.tax_code === 'GB');
      expect(gb!.action).toBe('RECALCULATE');
      const yq = result.data.tax_decisions.find((d) => d.tax_code === 'YQ');
      expect(yq!.action).toBe('RECALCULATE');
    });

    it('collects new tax codes in full after RECALCULATE/new', async () => {
      const input = makeInput({
        new_taxes: [
          { code: 'GB', amount: PLACEHOLDER.gbNew, currency: 'USD' },
          { code: 'US', amount: PLACEHOLDER.us, currency: 'USD' },
          { code: 'YQ', amount: PLACEHOLDER.yq, currency: 'USD' },
          { code: 'XA', amount: PLACEHOLDER.xa, currency: 'USD' },
        ],
      });
      const result = await agent.execute({ data: input });
      const xa = result.data.reissue.exchange_audit.taxes_new.find((t) => t.code === 'XA');
      expect(xa?.amount).toBe(PLACEHOLDER.xa);
    });

    it('regression: boolean same O&D must not equal keep-all-taxes', async () => {
      // Fixture mirrors the old buggy behavior: same_origin_destination true
      // with YQ present. Correct engine must RECALCULATE YQ, not carry it.
      const input = makeInput({ same_origin_destination: true });
      const result = await agent.execute({ data: input });
      const actions = Object.fromEntries(
        result.data.tax_decisions.map((d) => [d.tax_code, d.action]),
      );
      expect(actions['YQ']).toBe('RECALCULATE');
      expect(actions['GB']).toBe('CARRY');
      expect(actions['US']).toBe('CARRY');
      // Must not have carried YQ just because same_origin_destination was true
      expect(
        result.data.reissue.exchange_audit.taxes_carried_forward.some((t) => t.code === 'YQ'),
      ).toBe(false);
    });
  });

  describe('decideTaxCarryforward pure helpers', () => {
    it('throws when rule missing', () => {
      expect(() => decideTaxCarryforward('ZZ', undefined, defaultContext())).toThrow(
        TaxCarryforwardRuleMissingError,
      );
    });

    it('YQ with explicit_carry_authorized may CARRY when dimensions ok', () => {
      const d = decideTaxCarryforward(
        'YQ',
        {
          tax_code: 'YQ',
          nature: 'TRANSPORT',
          min_geography: 'SAME_AIRPORT',
          explicit_carry_authorized: true,
          on_validity_expired: 'RECALCULATE',
        },
        defaultContext(),
      );
      expect(d.action).toBe('CARRY');
    });

    it('decideAllTaxCarryforwards covers union of codes', () => {
      const decisions = decideAllTaxCarryforwards(
        [{ code: 'GB', amount: '1.00', currency: 'USD' }],
        [{ code: 'YQ', amount: '1.00', currency: 'USD' }],
        rulesForCodes(['GB', 'YQ']),
        defaultContext(),
      );
      expect(decisions.map((d) => d.tax_code).sort()).toEqual(['GB', 'YQ']);
    });
  });

  describe('New ticket record', () => {
    it('generates 13-digit ticket number', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.reissue.ticket_number).toMatch(/^\d{13}$/);
    });

    it('uses BA prefix (125)', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.reissue.ticket_number.startsWith('125')).toBe(true);
    });

    it('sets all coupons to Open status', async () => {
      const result = await agent.execute({ data: makeInput() });
      for (const c of result.data.reissue.coupons) {
        expect(c.status).toBe('O');
      }
    });

    it('sets issue date', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.reissue.issue_date).toBe('2026-04-01');
    });

    it('preserves passenger name', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.reissue.passenger_name).toBe('SMITH/JOHN');
    });

    it('calculates total amount correctly', async () => {
      const result = await agent.execute({ data: makeInput() });
      const total = Number(result.data.reissue.total_amount);
      expect(total).toBeGreaterThan(0);
    });
  });

  describe('Exchange audit trail', () => {
    it('records original ticket number', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.reissue.exchange_audit.original_ticket_number).toBe('1251234567890');
    });

    it('sets exchange indicator to E', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.reissue.exchange_audit.exchange_indicator).toBe('E');
    });

    it('records change fee paid', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.reissue.exchange_audit.change_fee_paid).toBe('200.00');
    });

    it('records original issue date', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.reissue.exchange_audit.original_issue_date).toBe('2026-03-01');
    });

    it('records waiver code when present', async () => {
      const input = makeInput({ waiver_code: 'WAIVER456' });
      const result = await agent.execute({ data: input });
      expect(result.data.reissue.exchange_audit.waiver_code).toBe('WAIVER456');
    });
  });

  describe('GDS exchange commands', () => {
    it('generates Amadeus TKTXCH command', async () => {
      const input = makeInput({ gds: 'AMADEUS' });
      const result = await agent.execute({ data: input });
      expect(result.data.reissue.exchange_commands).toBeDefined();
      const tktxch = result.data.reissue.exchange_commands!.find(
        (c) => c.command_name === 'TKTXCH',
      );
      expect(tktxch).toBeDefined();
      expect(tktxch!.gds).toBe('AMADEUS');
    });

    it('generates Sabre EXCHANGE_PNR command', async () => {
      const input = makeInput({ gds: 'SABRE' });
      const result = await agent.execute({ data: input });
      const cmd = result.data.reissue.exchange_commands!.find(
        (c) => c.command_name === 'EXCHANGE_PNR',
      );
      expect(cmd).toBeDefined();
    });

    it('generates Travelport UNIVERSAL_RECORD_EXCHANGE command', async () => {
      const input = makeInput({ gds: 'TRAVELPORT' });
      const result = await agent.execute({ data: input });
      const cmd = result.data.reissue.exchange_commands!.find(
        (c) => c.command_name === 'UNIVERSAL_RECORD_EXCHANGE',
      );
      expect(cmd).toBeDefined();
    });

    it('omits commands when no GDS specified', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.reissue.exchange_commands).toBeUndefined();
    });
  });

  describe('Conjunction ticket handling', () => {
    it('references conjunction originals in exchange', async () => {
      const input = makeInput({
        conjunction_originals: ['1251234567891', '1251234567892'],
        gds: 'AMADEUS',
      });
      const result = await agent.execute({ data: input });
      expect(result.data.reissue.exchange_audit.conjunction_originals).toHaveLength(2);
      const conjRef = result.data.reissue.exchange_commands!.find(
        (c) => c.command_name === 'CONJUNCTION_REFERENCE',
      );
      expect(conjRef).toBeDefined();
    });

    it('warns about conjunction exchange', async () => {
      const input = makeInput({ conjunction_originals: ['1251234567891'] });
      const result = await agent.execute({ data: input });
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.includes('Conjunction'))).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('rejects invalid original ticket number', async () => {
      await expect(
        agent.execute({ data: makeInput({ original_ticket_number: 'BAD' }) }),
      ).rejects.toThrow('Invalid input');
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

    it('rejects empty segments', async () => {
      await expect(agent.execute({ data: makeInput({ new_segments: [] }) })).rejects.toThrow(
        'Invalid input',
      );
    });

    it('rejects invalid conjunction ticket number', async () => {
      await expect(
        agent.execute({ data: makeInput({ conjunction_originals: ['BAD'] }) }),
      ).rejects.toThrow('Invalid input');
    });

    it('rejects invalid GDS', async () => {
      await expect(
        agent.execute({ data: makeInput({ gds: 'INVALID' as 'AMADEUS' }) }),
      ).rejects.toThrow('Invalid input');
    });
  });

  describe('Agent interface compliance', () => {
    it('has correct metadata', () => {
      expect(agent.id).toBe('5.2');
      expect(agent.name).toBe('Exchange/Reissue');
    });

    it('reports healthy', async () => {
      const health = await agent.health();
      expect(health.status).toBe('healthy');
    });

    it('returns metadata in output', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.metadata!['agent_id']).toBe('5.2');
      expect(result.metadata!['original_ticket']).toBe('1251234567890');
    });

    it('throws when not initialized', async () => {
      const uninit = new ExchangeReissue();
      await expect(uninit.execute({ data: makeInput() })).rejects.toThrow('not been initialized');
    });
  });
});
