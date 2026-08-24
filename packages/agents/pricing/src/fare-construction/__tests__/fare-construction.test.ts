/**
 * Fare Construction — Unit Tests
 *
 * Agent 2.2: NUC × IROE, published TPM/MPM, 024d HX/NX, fail-closed hooks.
 * Fixtures are invented test numbers — not production IROE/TPM.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Decimal } from 'decimal.js';
import {
  FareConstruction,
  constructFare,
  apply024dRounding,
  assertPublishedTpmSource,
  HAVERSINE_AS_TPM_BANNED,
  HARDCODED_IROE_BANNED,
  BANKERS_ROUNDING_AS_IATA_BANNED,
} from '../index.js';
import type {
  FareConstructionDataSources,
  FareConstructionInput,
  Rounding024dRule,
} from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/test-fare-construction-data.json'), 'utf8'),
) as {
  iroe: Record<string, string>;
  rounding_024d: Record<string, Rounding024dRule>;
  mileage: FareConstructionDataSources['mileage'];
};

const TEST_SOURCES: FareConstructionDataSources = {
  iroe: FIXTURE.iroe,
  rounding_024d: FIXTURE.rounding_024d,
  mileage: FIXTURE.mileage,
};

function makeInput(overrides: Partial<FareConstructionInput> = {}): FareConstructionInput {
  return {
    journey_type: 'OW',
    components: [
      {
        origin: 'JFK',
        destination: 'LHR',
        carrier: 'UA',
        fare_basis: 'V14NR',
        nuc_amount: '450.00',
      },
    ],
    selling_currency: 'USD',
    data_sources: TEST_SOURCES,
    ...overrides,
  };
}

let agent: FareConstruction;

beforeAll(async () => {
  agent = new FareConstruction();
  await agent.initialize();
});

afterAll(() => {
  agent.destroy();
});

describe('Fare Construction', () => {
  describe('Fail-closed: missing licensed data', () => {
    it('returns DOMAIN_INPUT_REQUIRED when data_sources omitted (no hardcoded IROE)', async () => {
      const result = await agent.execute({
        data: makeInput({ data_sources: undefined }),
      });

      expect('status' in result.data && result.data.status).toBe('DOMAIN_INPUT_REQUIRED');
      if ('status' in result.data && result.data.status === 'DOMAIN_INPUT_REQUIRED') {
        expect(result.data.missing).toEqual(
          expect.arrayContaining([
            'data_sources.iroe',
            'data_sources.rounding_024d',
            'data_sources.mileage',
          ]),
        );
        expect(result.data.description).toContain('No hardcoded');
      }
      expect(result.confidence).toBe(0);
    });

    it('returns DOMAIN_INPUT_REQUIRED for missing IROE currency (no 1.0 fallback)', async () => {
      const result = await agent.execute({
        data: makeInput({ selling_currency: 'XYZ' }),
      });

      expect('status' in result.data && result.data.status).toBe('DOMAIN_INPUT_REQUIRED');
      if ('status' in result.data && result.data.status === 'DOMAIN_INPUT_REQUIRED') {
        expect(result.data.missing).toContain('iroe_table_entry:XYZ');
        expect(result.data.description).toContain('IROE');
      }
      expect(result.confidence).toBe(0);
    });

    it('returns DOMAIN_INPUT_REQUIRED when published TPM is missing (no haversine)', async () => {
      const result = await agent.execute({
        data: makeInput({
          components: [
            {
              origin: 'XXX',
              destination: 'YYY',
              carrier: 'UA',
              fare_basis: 'Y',
              nuc_amount: '100.00',
            },
          ],
        }),
      });

      expect('status' in result.data && result.data.status).toBe('DOMAIN_INPUT_REQUIRED');
      if ('status' in result.data && result.data.status === 'DOMAIN_INPUT_REQUIRED') {
        expect(result.data.missing).toContain('tpm:XXX-YYY');
        expect(result.data.description).toContain('haversine');
        expect(result.data.references.some((r) => r.includes('ticketed-point-mileage-tpm'))).toBe(
          true,
        );
      }
      expect(result.confidence).toBe(0);
    });

    it('returns DOMAIN_INPUT_REQUIRED when 024d rounding rule is missing', async () => {
      const sources: FareConstructionDataSources = {
        ...TEST_SOURCES,
        rounding_024d: { ...TEST_SOURCES.rounding_024d },
      };
      delete sources.rounding_024d['USD'];

      const result = await agent.execute({
        data: makeInput({ data_sources: sources }),
      });

      expect('status' in result.data && result.data.status).toBe('DOMAIN_INPUT_REQUIRED');
      if ('status' in result.data && result.data.status === 'DOMAIN_INPUT_REQUIRED') {
        expect(result.data.missing).toContain('rounding_024d:USD');
        expect(result.data.description).toMatch(/banker|024d/i);
      }
    });
  });

  describe('Explicit bans', () => {
    it('exports ban constants for haversine, hardcoded IROE, and banker rounding', () => {
      expect(HAVERSINE_AS_TPM_BANNED).toMatch(/haversine/i);
      expect(HARDCODED_IROE_BANNED).toMatch(/hardcoded IROE/i);
      expect(BANKERS_ROUNDING_AS_IATA_BANNED).toMatch(/banker/i);
    });

    it('assertPublishedTpmSource rejects haversine-labelled sources', () => {
      expect(() => assertPublishedTpmSource('haversine')).toThrow(/haversine/i);
      expect(() => assertPublishedTpmSource('great-circle-approx')).toThrow(/haversine/i);
      expect(() => assertPublishedTpmSource('iata_tpm_manual')).not.toThrow();
    });

    it('engine module does not import greatCircleDistanceKm / haversine helpers', async () => {
      const engineSrc = readFileSync(resolve(__dirname, '../fare-engine.ts'), 'utf8');
      expect(engineSrc).not.toMatch(/greatCircleDistanceKm/);
      expect(engineSrc).not.toMatch(/haversineDistance/);
      expect(engineSrc).not.toMatch(/from '@otaip\/core\/.*regulations/);
      // Must not bundle production IROE/TPM JSON
      expect(engineSrc).not.toMatch(/roe-rates\.json/);
      expect(engineSrc).not.toMatch(/mileage-data\.json/);
      expect(engineSrc).not.toMatch(/rounding-rules\.json/);
    });

    it('024d NX is not banker’s half-to-even', () => {
      // 1.25 to unit 1: banker → 2 (even) or 1 depending; half-up NX → 1? 
      // For amount 2.5 with unit 1: half-up → 3; banker half-to-even → 2.
      const nx: Rounding024dRule = { unit: '1', method: 'NX' };
      const rounded = apply024dRounding(new Decimal('2.5'), nx);
      expect(rounded.toString()).toBe('3'); // half away from zero, NOT banker → 2
    });
  });

  describe('NUC × IROE construction', () => {
    it('constructs JFK-LHR OW fare in USD', async () => {
      const result = await agent.execute({ data: makeInput() });
      if ('status' in result.data && result.data.status === 'DOMAIN_INPUT_REQUIRED') {
        throw new Error('Expected constructed fare');
      }
      expect(result.data.total_nuc).toBe('450.00');
      expect(result.data.iroe).toBe('1.000000');
      expect(result.data.roe).toBe('1.000000');
      expect(result.data.local_amount).toBe('450');
      expect(result.data.currency).toBe('USD');
      expect(result.data.rounding_method).toBe('NX');
    });

    it('constructs JFK-LHR OW fare in GBP with IROE', async () => {
      const result = await agent.execute({
        data: makeInput({
          components: [
            {
              origin: 'JFK',
              destination: 'LHR',
              carrier: 'BA',
              fare_basis: 'Y',
              nuc_amount: '1200.00',
            },
          ],
          selling_currency: 'GBP',
        }),
      });
      if ('status' in result.data && result.data.status === 'DOMAIN_INPUT_REQUIRED') {
        throw new Error('Expected constructed fare');
      }
      const expectedRaw = new Decimal('1200.00').mul('0.793650');
      expect(result.data.iroe).toBe('0.793650');
      expect(new Decimal(result.data.local_amount_raw).toFixed(2)).toBe(expectedRaw.toFixed(2));
    });

    it('applies HX rounding for JPY', async () => {
      const result = await agent.execute({
        data: makeInput({
          components: [
            {
              origin: 'SFO',
              destination: 'NRT',
              carrier: 'NH',
              fare_basis: 'V14NR',
              nuc_amount: '500.00',
            },
          ],
          selling_currency: 'JPY',
        }),
      });
      if ('status' in result.data && result.data.status === 'DOMAIN_INPUT_REQUIRED') {
        throw new Error('Expected constructed fare');
      }
      expect(result.data.rounding_unit).toBe('1');
      expect(result.data.rounding_method).toBe('HX');
      expect(result.data.local_amount).toMatch(/^\d+$/);
    });

    it('applies HX 0.05 rounding for CHF', async () => {
      const result = await agent.execute({
        data: makeInput({
          components: [
            {
              origin: 'JFK',
              destination: 'LHR',
              carrier: 'UA',
              fare_basis: 'Y',
              nuc_amount: '333.33',
            },
          ],
          selling_currency: 'CHF',
        }),
      });
      if ('status' in result.data && result.data.status === 'DOMAIN_INPUT_REQUIRED') {
        throw new Error('Expected constructed fare');
      }
      expect(result.data.rounding_unit).toBe('0.05');
      expect(result.data.rounding_method).toBe('HX');
      const amount = new Decimal(result.data.local_amount);
      expect(amount.mod('0.05').eq(0)).toBe(true);
    });
  });

  describe('024d apply024dRounding', () => {
    it('HX rounds up unless exact', () => {
      const hx: Rounding024dRule = { unit: '1', method: 'HX' };
      expect(apply024dRounding(new Decimal('10'), hx).toString()).toBe('10');
      expect(apply024dRounding(new Decimal('10.01'), hx).toString()).toBe('11');
    });

    it('NX rounds to nearest (half up, not banker)', () => {
      const nx: Rounding024dRule = { unit: '0.01', method: 'NX' };
      expect(apply024dRounding(new Decimal('10.004'), nx).toFixed(2)).toBe('10.00');
      expect(apply024dRounding(new Decimal('10.005'), nx).toFixed(2)).toBe('10.01');
    });
  });

  describe('Round-trip / CT with published mileage', () => {
    it('constructs RT and records TPM from published data', async () => {
      const result = await agent.execute({
        data: makeInput({
          journey_type: 'RT',
          components: [
            {
              origin: 'JFK',
              destination: 'LHR',
              carrier: 'BA',
              fare_basis: 'V14NR',
              nuc_amount: '450.00',
            },
            {
              origin: 'LHR',
              destination: 'JFK',
              carrier: 'BA',
              fare_basis: 'V14NR',
              nuc_amount: '450.00',
            },
          ],
        }),
      });
      if ('status' in result.data && result.data.status === 'DOMAIN_INPUT_REQUIRED') {
        throw new Error('Expected constructed fare');
      }
      expect(result.data.total_nuc).toBe('900.00');
      expect(result.data.mileage_checks.length).toBe(2);
      expect(result.data.mileage_checks[0]!.tpm).toBe(3459);
      expect(result.data.mileage_checks[0]!.mpm).toBe(3805);
      expect(result.data.total_mpm).toBe(result.data.total_mph);
    });

    it('CT reports CTM missing_inputs instead of inventing CTM=total_nuc', async () => {
      const result = await agent.execute({
        data: makeInput({
          journey_type: 'CT',
          components: [
            {
              origin: 'JFK',
              destination: 'LHR',
              carrier: 'BA',
              fare_basis: 'Y',
              nuc_amount: '500.00',
            },
            {
              origin: 'LHR',
              destination: 'CDG',
              carrier: 'AF',
              fare_basis: 'Y',
              nuc_amount: '100.00',
            },
            {
              origin: 'CDG',
              destination: 'JFK',
              carrier: 'AF',
              fare_basis: 'Y',
              nuc_amount: '480.00',
            },
          ],
        }),
      });
      if ('status' in result.data && result.data.status === 'DOMAIN_INPUT_REQUIRED') {
        throw new Error('Expected constructed fare');
      }
      expect(result.data.ctm_check.applies).toBe(false);
      expect(result.data.ctm_check.ctm_nuc).toBeNull();
      expect(result.data.ctm_check.missing_inputs).toBeDefined();
      expect(result.warnings!.some((w) => w.includes('DOMAIN_INPUT_REQUIRED (CTM)'))).toBe(true);
    });
  });

  describe('HIP / BHC sketches', () => {
    it('HIP undetected with missing_inputs for multi-component', async () => {
      const result = await agent.execute({
        data: makeInput({
          components: [
            {
              origin: 'JFK',
              destination: 'LHR',
              carrier: 'BA',
              fare_basis: 'Y',
              nuc_amount: '500.00',
            },
            {
              origin: 'LHR',
              destination: 'CDG',
              carrier: 'AF',
              fare_basis: 'Y',
              nuc_amount: '200.00',
            },
          ],
        }),
      });
      if ('status' in result.data && result.data.status === 'DOMAIN_INPUT_REQUIRED') {
        throw new Error('Expected constructed fare');
      }
      expect(result.data.hip_check.detected).toBe(false);
      expect(result.data.hip_check.missing_inputs!.length).toBeGreaterThan(0);
      expect(result.data.bhc_check.detected).toBe(false);
      expect(result.data.bhc_check.missing_inputs!.length).toBeGreaterThan(0);
    });
  });

  describe('Audit trail', () => {
    it('produces a full audit trail ending in Final Fare', async () => {
      const result = await agent.execute({ data: makeInput() });
      if ('status' in result.data && result.data.status === 'DOMAIN_INPUT_REQUIRED') {
        throw new Error('Expected constructed fare');
      }
      expect(result.data.audit_trail.length).toBeGreaterThanOrEqual(12);
      expect(result.data.audit_trail[0]!.step).toBe(1);
      expect(result.data.audit_trail.at(-1)!.name).toBe('Final Fare');
    });
  });

  describe('Input validation', () => {
    it('rejects invalid journey_type', async () => {
      await expect(
        agent.execute({ data: makeInput({ journey_type: 'XX' as 'OW' }) }),
      ).rejects.toThrow('Invalid input');
    });

    it('rejects empty components', async () => {
      await expect(
        agent.execute({ data: makeInput({ components: [] }) }),
      ).rejects.toThrow('Invalid input');
    });

    it('rejects invalid currency', async () => {
      await expect(
        agent.execute({ data: makeInput({ selling_currency: 'us' }) }),
      ).rejects.toThrow('Invalid input');
    });
  });

  describe('Agent interface', () => {
    it('has correct metadata', () => {
      expect(agent.id).toBe('2.2');
      expect(agent.name).toBe('Fare Construction');
      expect(agent.version).toBe('0.2.0');
    });

    it('constructFare is exported for direct unit use', () => {
      const result = constructFare(makeInput());
      expect('total_nuc' in result || ('status' in result && result.status === 'DOMAIN_INPUT_REQUIRED')).toBe(
        true,
      );
    });

    it('throws when not initialized', async () => {
      const uninit = new FareConstruction();
      await expect(uninit.execute({ data: makeInput() })).rejects.toThrow('not been initialized');
    });
  });
});
