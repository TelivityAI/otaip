/**
 * BSP Reconciliation — Unit Tests
 *
 * Agent 7.1: HOT file parsing + reconciliation matching.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BSPReconciliation } from '../index.js';
import { HOTFileParser } from '../hot-file-parser.js';
import type { BSPReconciliationInput, AgencyRecord, HOTFileRecord } from '../types.js';

let agent: BSPReconciliation;

beforeAll(async () => {
  agent = new BSPReconciliation();
  await agent.initialize();
});

afterAll(() => {
  agent.destroy();
});

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8');
}

function makeAgency(overrides: Partial<AgencyRecord> = {}): AgencyRecord {
  return {
    ticket_number: '1251234567890',
    passenger_name: 'SMITH/JOHN',
    origin: 'LHR',
    destination: 'JFK',
    airline_code: 'BA',
    issue_date: '2026-03-15',
    ticket_amount: '550.00',
    commission_amount: '38.50',
    tax_amount: '120.00',
    transaction_type: 'SALE',
    currency: 'USD',
    ...overrides,
  };
}

function makeHot(overrides: Partial<HOTFileRecord> = {}): HOTFileRecord {
  return {
    ticket_number: '1251234567890',
    passenger_name: 'SMITH/JOHN',
    origin: 'LHR',
    destination: 'JFK',
    airline_code: 'BA',
    issue_date: '2026-03-15',
    ticket_amount: '550.00',
    commission_amount: '38.50',
    tax_amount: '120.00',
    transaction_type: 'SALE',
    currency: 'USD',
    billing_period: '2026-P03',
    ...overrides,
  };
}

function makeInput(overrides: Partial<BSPReconciliationInput> = {}): BSPReconciliationInput {
  return {
    agency_records: [makeAgency()],
    hot_records: [makeHot()],
    billing_period: '2026-P03',
    current_datetime: '2026-04-01T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// HOT File Parser
// ---------------------------------------------------------------------------
describe('HOT File Parser', () => {
  it('auto-detects EDI X12 format', () => {
    const content = loadFixture('hot-edi-x12.txt');
    expect(HOTFileParser.detectFormat(content)).toBe('EDI_X12');
  });

  it('auto-detects fixed-width format', () => {
    const content = loadFixture('hot-fixed-width.txt');
    expect(HOTFileParser.detectFormat(content)).toBe('FIXED_WIDTH');
  });

  it('parses EDI X12 records', () => {
    const content = loadFixture('hot-edi-x12.txt');
    const parser = new HOTFileParser();
    const records = parser.parse(content);
    expect(records.length).toBe(6);
    expect(records[0]!.ticket_number).toBe('1251234567890');
    expect(records[0]!.passenger_name).toBe('SMITH/JOHN');
    expect(records[0]!.ticket_amount).toBe('550.00');
    expect(records[0]!.transaction_type).toBe('SALE');
  });

  it('parses fixed-width records', () => {
    const content = loadFixture('hot-fixed-width.txt');
    const parser = new HOTFileParser('FIXED_WIDTH');
    const records = parser.parse(content);
    expect(records.length).toBe(3);
    expect(records[0]!.ticket_number).toBe('1251234567890');
    expect(records[0]!.airline_code).toBe('BA');
  });

  it('parses refund records in EDI', () => {
    const content = loadFixture('hot-edi-x12.txt');
    const parser = new HOTFileParser();
    const records = parser.parse(content);
    const refund = records.find((r) => r.transaction_type === 'REFUND');
    expect(refund).toBeDefined();
    expect(refund!.refund_amount).toBe('450.00');
  });

  it('parses ADM records in EDI', () => {
    const content = loadFixture('hot-edi-x12.txt');
    const parser = new HOTFileParser();
    const records = parser.parse(content);
    const adm = records.find((r) => r.transaction_type === 'ADM');
    expect(adm).toBeDefined();
    expect(adm!.airline_code).toBe('NH');
  });

  it('returns empty for empty content', () => {
    const parser = new HOTFileParser();
    expect(parser.parse('')).toEqual([]);
  });

  it('skips header/trailer in fixed-width', () => {
    const parser = new HOTFileParser('FIXED_WIDTH');
    const records = parser.parse('HDR TEST HEADER\nTRL FOOTER');
    expect(records).toEqual([]);
  });

  it('handles forced format override', () => {
    const parser = new HOTFileParser('EDI_X12');
    const records = parser.parse(
      'TKT*1234567890123*PAX*LHR*JFK*BA*2026-01-01*100.00*7.00*20.00**SALE*001*CC*USD*P01~',
    );
    expect(records.length).toBe(1);
  });

  it('auto-detects synthetic DISH Rev 23 format', () => {
    const content = loadFixture('hot-dish-rev23-synthetic.txt');
    expect(HOTFileParser.detectFormat(content)).toBe('DISH_REV23');
  });

  it('parses multi-currency CUTP from synthetic DISH HOT (never assumes single currency)', () => {
    const content = loadFixture('hot-dish-rev23-synthetic.txt');
    const parser = new HOTFileParser();
    const records = parser.parse(content);
    const currencies = [...new Set(records.map((r) => r.currency))].sort();
    expect(currencies).toEqual(['EUR', 'GBP', 'HKD', 'USD']);
    expect(records.every((r) => r.reporting_currency === 'GBP')).toBe(true);
  });

  it('parses exchange-linked ticket via FPTP=EX and ORIT', () => {
    const content = loadFixture('hot-dish-rev23-synthetic.txt');
    const parser = new HOTFileParser();
    const records = parser.parse(content);
    const exch = records.find((r) => r.ticket_number === '1259999000001');
    expect(exch).toBeDefined();
    expect(exch!.transaction_type).toBe('EXCHANGE');
    expect(exch!.original_ticket_number).toBe('1259999000000');
    expect(exch!.payment_type).toBe('EX');
  });

  it('parses conjunction set sharing TRNN', () => {
    const content = loadFixture('hot-dish-rev23-synthetic.txt');
    const parser = new HOTFileParser();
    const records = parser.parse(content);
    const primary = records.find((r) => r.ticket_number === '1258888000000');
    const cnj = records.find((r) => r.ticket_number === '1258888000001');
    expect(primary).toBeDefined();
    expect(cnj).toBeDefined();
    expect(primary!.transaction_number).toBe(cnj!.transaction_number);
    expect(primary!.conjunction_ticket_numbers).toContain('1258888000001');
    expect(cnj!.is_conjunction).toBe(true);
    expect(cnj!.conjunction_primary).toBe('1258888000000');
  });

  it('parses ADM as separate TRNC with RTDN related document', () => {
    const content = loadFixture('hot-dish-rev23-synthetic.txt');
    const parser = new HOTFileParser();
    const records = parser.parse(content);
    const adm = records.find((r) => r.transaction_type === 'ADM');
    expect(adm).toBeDefined();
    expect(adm!.transaction_code).toBe('ADMA');
    expect(adm!.related_documents?.[0]?.ticket_number).toBe('1251234567895');
  });

  it('parses EMD as separate category from TKTT/ADM', () => {
    const content = loadFixture('hot-dish-rev23-synthetic.txt');
    const parser = new HOTFileParser();
    const records = parser.parse(content);
    const emd = records.find((r) => r.transaction_type === 'EMD');
    expect(emd).toBeDefined();
    expect(emd!.transaction_code).toBe('EMDS');
  });
});

// ---------------------------------------------------------------------------
// Reconciliation matching
// ---------------------------------------------------------------------------
describe('BSP Reconciliation', () => {
  describe('Matching', () => {
    it('matches identical records with no discrepancies', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.discrepancies).toHaveLength(0);
      expect(result.data.passed).toBe(true);
      expect(result.data.summary.matched_count).toBe(1);
    });

    it('detects missing in HOT', async () => {
      const input = makeInput({ hot_records: [] });
      const result = await agent.execute({ data: input });
      const missing = result.data.discrepancies.find((d) => d.type === 'MISSING_IN_HOT');
      expect(missing).toBeDefined();
      expect(missing!.severity).toBe('critical');
    });

    it('detects missing in agency', async () => {
      const input = makeInput({
        agency_records: [],
        hot_records: [makeHot()],
      });
      const result = await agent.execute({ data: input });
      const missing = result.data.discrepancies.find((d) => d.type === 'MISSING_IN_AGENCY');
      expect(missing).toBeDefined();
    });
  });

  describe('Amount discrepancies', () => {
    it('detects amount mismatch above threshold', async () => {
      const input = makeInput({
        hot_records: [makeHot({ ticket_amount: '600.00' })],
      });
      const result = await agent.execute({ data: input });
      const mismatch = result.data.discrepancies.find((d) => d.type === 'AMOUNT_MISMATCH');
      expect(mismatch).toBeDefined();
      expect(mismatch!.difference).toBe('50.00');
    });

    it('ignores amount difference below threshold', async () => {
      const input = makeInput({
        hot_records: [makeHot({ ticket_amount: '555.00' })],
        min_threshold: '10.00',
      });
      const result = await agent.execute({ data: input });
      const mismatch = result.data.discrepancies.find((d) => d.type === 'AMOUNT_MISMATCH');
      expect(mismatch).toBeUndefined();
    });

    it('respects custom threshold', async () => {
      const input = makeInput({
        hot_records: [makeHot({ ticket_amount: '555.00' })],
        min_threshold: '3.00',
      });
      const result = await agent.execute({ data: input });
      expect(result.data.discrepancies.some((d) => d.type === 'AMOUNT_MISMATCH')).toBe(true);
    });
  });

  describe('Commission discrepancies', () => {
    it('detects commission mismatch', async () => {
      const input = makeInput({
        hot_records: [makeHot({ commission_amount: '55.00' })],
      });
      const result = await agent.execute({ data: input });
      const comm = result.data.discrepancies.find((d) => d.type === 'COMMISSION_MISMATCH');
      expect(comm).toBeDefined();
      expect(comm!.difference).toBe('16.50');
    });
  });

  describe('Currency discrepancies', () => {
    it('detects currency mismatch', async () => {
      const input = makeInput({
        hot_records: [makeHot({ currency: 'EUR' })],
      });
      const result = await agent.execute({ data: input });
      const curr = result.data.discrepancies.find((d) => d.type === 'CURRENCY_MISMATCH');
      expect(curr).toBeDefined();
    });
  });

  describe('ADM/ACM handling', () => {
    it('detects unmatched ADM', async () => {
      const input = makeInput({
        agency_records: [],
        hot_records: [makeHot({ transaction_type: 'ADM' })],
      });
      const result = await agent.execute({ data: input });
      const adm = result.data.discrepancies.find((d) => d.type === 'UNMATCHED_ADM');
      expect(adm).toBeDefined();
      expect(adm!.severity).toBe('high');
    });

    it('detects unmatched ACM', async () => {
      const input = makeInput({
        agency_records: [],
        hot_records: [makeHot({ transaction_type: 'ACM' })],
      });
      const result = await agent.execute({ data: input });
      const acm = result.data.discrepancies.find((d) => d.type === 'UNMATCHED_ACM');
      expect(acm).toBeDefined();
    });
  });

  describe('Duplicate detection', () => {
    it('detects duplicate SALE in HOT', async () => {
      const input = makeInput({
        agency_records: [makeAgency()],
        hot_records: [makeHot(), makeHot()],
      });
      const result = await agent.execute({ data: input });
      const dup = result.data.discrepancies.find((d) => d.type === 'DUPLICATE_TRANSACTION');
      expect(dup).toBeDefined();
    });
  });

  describe('Pattern detection', () => {
    it('detects recurring commission mismatch pattern with 10+ discrepancies', async () => {
      // Build 12 records with commission mismatches for same airline
      const agencies: AgencyRecord[] = [];
      const hots: HOTFileRecord[] = [];
      for (let i = 0; i < 12; i++) {
        const ticketNum = `125123456${String(7890 + i).padStart(4, '0')}`;
        agencies.push(makeAgency({ ticket_number: ticketNum, commission_amount: '38.50' }));
        hots.push(makeHot({ ticket_number: ticketNum, commission_amount: '55.00' }));
      }
      const input = makeInput({ agency_records: agencies, hot_records: hots });
      const result = await agent.execute({ data: input });
      expect(result.data.summary.patterns.length).toBeGreaterThan(0);
      expect(result.data.summary.patterns[0]!.pattern).toBe('RECURRING_COMMISSION_MISMATCH');
    });

    it('no pattern detection with fewer than 10 discrepancies', async () => {
      const agencies: AgencyRecord[] = [];
      const hots: HOTFileRecord[] = [];
      for (let i = 0; i < 5; i++) {
        const ticketNum = `125123456${String(7890 + i).padStart(4, '0')}`;
        agencies.push(makeAgency({ ticket_number: ticketNum, commission_amount: '38.50' }));
        hots.push(makeHot({ ticket_number: ticketNum, commission_amount: '55.00' }));
      }
      const input = makeInput({ agency_records: agencies, hot_records: hots });
      const result = await agent.execute({ data: input });
      expect(result.data.summary.patterns).toHaveLength(0);
    });
  });

  describe('Summary', () => {
    it('generates correct summary counts', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.summary.total_agency_records).toBe(1);
      expect(result.data.summary.total_hot_records).toBe(1);
      expect(result.data.summary.matched_count).toBe(1);
    });

    it('reports critical count', async () => {
      const input = makeInput({ hot_records: [] });
      const result = await agent.execute({ data: input });
      expect(result.data.summary.critical_count).toBeGreaterThan(0);
      expect(result.data.passed).toBe(false);
    });
  });

  describe('Remittance deadline warning', () => {
    it('warns when deadline is within 48 hours', async () => {
      const input = makeInput({
        remittance_deadline: '2026-04-02T12:00:00Z',
        current_datetime: '2026-04-01T12:00:00Z',
        hot_records: [], // cause a discrepancy
      });
      const result = await agent.execute({ data: input });
      expect(result.warnings!.some((w) => w.includes('Remittance deadline'))).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('rejects invalid agency ticket number', async () => {
      const input = makeInput({
        agency_records: [makeAgency({ ticket_number: 'BAD' })],
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects invalid airline code', async () => {
      const input = makeInput({
        agency_records: [makeAgency({ airline_code: 'X' })],
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects invalid HOT ticket number', async () => {
      const input = makeInput({
        hot_records: [makeHot({ ticket_number: 'BAD' })],
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects empty billing period', async () => {
      await expect(agent.execute({ data: makeInput({ billing_period: '' }) })).rejects.toThrow(
        'Invalid input',
      );
    });
  });

  describe('Agent interface compliance', () => {
    it('has correct metadata', () => {
      expect(agent.id).toBe('7.1');
      expect(agent.name).toBe('BSP Reconciliation');
      expect(agent.version).toBe('0.2.0');
    });

    it('reports healthy', async () => {
      expect((await agent.health()).status).toBe('healthy');
    });

    it('returns metadata in output', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.metadata!['agent_id']).toBe('7.1');
      expect(result.metadata!['billing_period']).toBe('2026-P03');
    });

    it('throws when not initialized', async () => {
      const uninit = new BSPReconciliation();
      await expect(uninit.execute({ data: makeInput() })).rejects.toThrow('not been initialized');
    });

    it('reports unhealthy when not initialized', async () => {
      const uninit = new BSPReconciliation();
      expect((await uninit.health()).status).toBe('unhealthy');
    });
  });

  describe('Multi-currency + cross-refs (DISH Rev 23 / #143)', () => {
    it('lists currencies_present and warns on multi-currency HOT', async () => {
      const input = makeInput({
        agency_records: [
          makeAgency({ ticket_number: '1251234567890', currency: 'GBP', ticket_amount: '550.00' }),
          makeAgency({
            ticket_number: '1251234567891',
            currency: 'EUR',
            ticket_amount: '780.00',
            commission_amount: '54.60',
            tax_amount: '95.00',
            airline_code: 'AF',
          }),
        ],
        hot_records: [
          makeHot({
            ticket_number: '1251234567890',
            currency: 'GBP',
            reporting_currency: 'GBP',
            ticket_amount: '550.00',
          }),
          makeHot({
            ticket_number: '1251234567891',
            currency: 'EUR',
            reporting_currency: 'GBP',
            ticket_amount: '780.00',
            commission_amount: '54.60',
            tax_amount: '95.00',
            airline_code: 'AF',
          }),
        ],
        threshold_currency: 'GBP',
      });
      const result = await agent.execute({ data: input });
      expect(result.data.summary.currencies_present).toEqual(['EUR', 'GBP']);
      expect(result.warnings!.some((w) => w.includes('Multi-currency HOT'))).toBe(true);
      expect(result.warnings!.some((w) => w.includes('IROE'))).toBe(true);
      expect(result.data.passed).toBe(true);
    });

    it('flags currency mismatch without converting via IROE/ICER', async () => {
      const input = makeInput({
        agency_records: [makeAgency({ currency: 'GBP' })],
        hot_records: [makeHot({ currency: 'EUR', reporting_currency: 'GBP' })],
      });
      const result = await agent.execute({ data: input });
      const curr = result.data.discrepancies.find((d) => d.type === 'CURRENCY_MISMATCH');
      expect(curr).toBeDefined();
      expect(curr!.description).toMatch(/IROE/);
      expect(result.data.discrepancies.some((d) => d.type === 'AMOUNT_MISMATCH')).toBe(false);
    });

    it('matches exchange-linked tickets via ORIT cross-ref', async () => {
      const input = makeInput({
        agency_records: [
          makeAgency({
            ticket_number: '1259999000001',
            transaction_type: 'EXCHANGE',
            original_ticket_number: '1259999000000',
            ticket_amount: '100.00',
            commission_amount: '7.00',
            tax_amount: '20.00',
            currency: 'GBP',
          }),
        ],
        hot_records: [
          makeHot({
            ticket_number: '1259999000001',
            transaction_type: 'EXCHANGE',
            transaction_code: 'TKTT',
            original_ticket_number: '1259999000000',
            payment_type: 'EX',
            ticket_amount: '100.00',
            commission_amount: '7.00',
            tax_amount: '20.00',
            currency: 'GBP',
            reporting_currency: 'GBP',
          }),
        ],
        threshold_currency: 'GBP',
      });
      const result = await agent.execute({ data: input });
      expect(result.data.discrepancies).toHaveLength(0);
      expect(result.data.summary.matched_count).toBe(1);
    });

    it('flags unmatched exchange when ORIT linkage is missing on HOT', async () => {
      const input = makeInput({
        agency_records: [
          makeAgency({
            ticket_number: '1259999000001',
            transaction_type: 'EXCHANGE',
            original_ticket_number: '1259999000000',
            ticket_amount: '100.00',
            currency: 'GBP',
          }),
        ],
        hot_records: [],
        threshold_currency: 'GBP',
      });
      const result = await agent.execute({ data: input });
      const unmatched = result.data.discrepancies.find((d) => d.type === 'UNMATCHED_EXCHANGE');
      expect(unmatched).toBeDefined();
      expect(unmatched!.related_ticket_number).toBe('1259999000000');
    });

    it('detects conjunction set mismatch', async () => {
      const input = makeInput({
        agency_records: [
          makeAgency({
            ticket_number: '1258888000000',
            conjunction_ticket_numbers: ['1258888000001'],
            ticket_amount: '900.00',
            commission_amount: '63.00',
            currency: 'HKD',
            airline_code: 'CX',
          }),
        ],
        hot_records: [
          makeHot({
            ticket_number: '1258888000000',
            ticket_amount: '900.00',
            commission_amount: '63.00',
            currency: 'HKD',
            airline_code: 'CX',
            // HOT missing conjunction companion
          }),
        ],
        threshold_currency: 'HKD',
      });
      const result = await agent.execute({ data: input });
      const cnj = result.data.discrepancies.find((d) => d.type === 'CONJUNCTION_SET_MISMATCH');
      expect(cnj).toBeDefined();
      expect(cnj!.severity).toBe('critical');
    });

    it('matches ADM via RTDN related ticket', async () => {
      const input = makeInput({
        agency_records: [
          makeAgency({
            ticket_number: '1256666000001',
            transaction_type: 'ADM',
            related_ticket_number: '1251234567895',
            ticket_amount: '890.00',
            commission_amount: '0.00',
            tax_amount: '0.00',
            airline_code: 'NH',
            currency: 'USD',
          }),
        ],
        hot_records: [
          makeHot({
            ticket_number: '1256666000001',
            transaction_type: 'ADM',
            transaction_code: 'ADMA',
            ticket_amount: '890.00',
            commission_amount: '0.00',
            tax_amount: '0.00',
            airline_code: 'NH',
            currency: 'USD',
            related_documents: [{ ticket_number: '1251234567895', coupons: '1230' }],
          }),
        ],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.discrepancies).toHaveLength(0);
      expect(result.data.passed).toBe(true);
    });

    it('end-to-end: parse synthetic DISH fixture and reconcile exchange + multi-currency', async () => {
      const content = loadFixture('hot-dish-rev23-synthetic.txt');
      const hot_records = new HOTFileParser().parse(content);
      const input = makeInput({
        agency_records: [
          makeAgency({
            ticket_number: '1251234567890',
            currency: 'GBP',
            ticket_amount: '550.00',
            commission_amount: '38.50',
          }),
          makeAgency({
            ticket_number: '1259999000001',
            transaction_type: 'EXCHANGE',
            original_ticket_number: '1259999000000',
            ticket_amount: '100.00',
            commission_amount: '7.00',
            tax_amount: '20.00',
            currency: 'GBP',
          }),
          makeAgency({
            ticket_number: '1258888000000',
            conjunction_ticket_numbers: ['1258888000001'],
            ticket_amount: '900.00',
            commission_amount: '63.00',
            tax_amount: '110.00',
            currency: 'HKD',
            airline_code: 'CX',
          }),
          makeAgency({
            ticket_number: '1258888000001',
            conjunction_ticket_numbers: ['1258888000000'],
            ticket_amount: '0.00',
            commission_amount: '0.00',
            tax_amount: '0.00',
            currency: 'HKD',
            airline_code: 'CX',
          }),
        ],
        hot_records,
        threshold_currency: 'GBP',
        min_threshold: '10.00',
      });

      const result = await agent.execute({ data: input });
      expect(result.data.summary.currencies_present.length).toBeGreaterThan(1);
      expect(
        result.data.discrepancies.some(
          (d) =>
            d.ticket_number === '1259999000001' &&
            (d.type === 'MISSING_IN_HOT' || d.type === 'UNMATCHED_EXCHANGE'),
        ),
      ).toBe(false);
      expect(result.warnings!.some((w) => w.includes('Multi-currency'))).toBe(true);
    });
  });
});
