/**
 * Class of Service Mapper — Unit Tests
 *
 * Test cases derived from the agent spec (agents/specs/0-4-class-of-service-mapper.yaml).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ClassOfServiceMapper } from '../index.js';

// --- Test setup ---

let mapper: ClassOfServiceMapper;

beforeAll(async () => {
  mapper = new ClassOfServiceMapper();
  await mapper.initialize();
});

afterAll(() => {
  mapper.destroy();
});

// --- Tests per spec ---

describe('Class of Service Mapper', () => {
  describe('Spec test: UA J class -> Business (Polaris)', () => {
    it('maps UA J to business with Polaris brand name', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'J', carrier: 'UA' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('business');
      expect(result.data.mapping!.cabin_brand_name).toBe('Polaris');
      expect(result.data.match_confidence).toBe(1.0);
    });
  });

  describe('Spec test: AA Y class -> Economy (Main Cabin)', () => {
    it('maps AA Y to economy Main Cabin Flexible', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'Y', carrier: 'AA' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('economy');
      expect(result.data.mapping!.fare_family).toBe('Main Cabin Flexible');
      expect(result.data.match_confidence).toBe(1.0);
    });
  });

  describe('Spec test: BA F class -> First', () => {
    it('maps BA F to first class', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'F', carrier: 'BA' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('first');
      expect(result.data.mapping!.cabin_brand_name).toBe('First');
      expect(result.data.match_confidence).toBe(1.0);
    });
  });

  describe('Spec test: Unknown carrier falls back to IATA default', () => {
    it('maps unknown carrier Y to economy with 0.7 confidence', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'Y', carrier: 'ZZ' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('economy');
      expect(result.data.match_confidence).toBe(0.7);
    });

    it('maps unknown carrier J to business with 0.7 confidence', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'J', carrier: 'ZZ' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('business');
      expect(result.data.match_confidence).toBe(0.7);
    });

    it('maps unknown carrier F to first with 0.7 confidence', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'F', carrier: 'ZZ' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('first');
      expect(result.data.match_confidence).toBe(0.7);
    });
  });

  describe('Spec test: Loyalty earning with include_loyalty=true', () => {
    it('returns loyalty data for UA J', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'J', carrier: 'UA', include_loyalty: true },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.loyalty_earning).not.toBeNull();
      expect(result.data.mapping!.loyalty_earning!.program_name).toBe('MileagePlus');
      expect(result.data.mapping!.loyalty_earning!.rdm_percent).toBe(150);
      expect(result.data.mapping!.loyalty_earning!.status_earning).toBe(true);
    });

    it('returns loyalty data for AA Y', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'Y', carrier: 'AA', include_loyalty: true },
      });

      expect(result.data.mapping!.loyalty_earning).not.toBeNull();
      expect(result.data.mapping!.loyalty_earning!.program_name).toBe('AAdvantage');
      expect(result.data.mapping!.loyalty_earning!.rdm_percent).toBe(100);
    });

    it('returns loyalty data for DL J (fare-based PQP)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'J', carrier: 'DL', include_loyalty: true },
      });

      expect(result.data.mapping!.loyalty_earning).not.toBeNull();
      expect(result.data.mapping!.loyalty_earning!.program_name).toBe('SkyMiles');
      expect(result.data.mapping!.loyalty_earning!.pqp_earning).toBe('fare_based');
      expect(result.data.mapping!.loyalty_earning!.pqm_percent).toBeNull();
    });

    it('returns null loyalty when include_loyalty is false (default)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'J', carrier: 'UA' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.loyalty_earning).toBeNull();
    });

    it('returns null loyalty for carrier without loyalty data', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'J', carrier: 'BA', include_loyalty: true },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.loyalty_earning).toBeNull();
    });
  });

  describe('Spec test: Invalid booking class', () => {
    it('rejects numeric booking class with validation error', async () => {
      await expect(
        mapper.execute({
          data: { booking_class: '9', carrier: 'UA' },
        }),
      ).rejects.toThrow('Invalid input');
    });

    it('rejects multi-character booking class', async () => {
      await expect(
        mapper.execute({
          data: { booking_class: 'JC', carrier: 'UA' },
        }),
      ).rejects.toThrow('Invalid input');
    });
  });

  describe('Invalid carrier format', () => {
    it('rejects single-character carrier code', async () => {
      await expect(
        mapper.execute({
          data: { booking_class: 'J', carrier: 'U' },
        }),
      ).rejects.toThrow('Invalid input');
    });

    it('rejects three-character carrier code', async () => {
      await expect(
        mapper.execute({
          data: { booking_class: 'J', carrier: 'UAL' },
        }),
      ).rejects.toThrow('Invalid input');
    });
  });

  describe('Empty / missing fields', () => {
    it('rejects empty booking class', async () => {
      await expect(
        mapper.execute({
          data: { booking_class: '', carrier: 'UA' },
        }),
      ).rejects.toThrow('Invalid input');
    });

    it('rejects empty carrier', async () => {
      await expect(
        mapper.execute({
          data: { booking_class: 'J', carrier: '' },
        }),
      ).rejects.toThrow('Invalid input');
    });
  });

  describe('Carrier-specific mappings', () => {
    it('maps UA N to Basic Economy (not upgrade eligible)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'N', carrier: 'UA' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('economy');
      expect(result.data.mapping!.fare_family).toBe('Basic Economy');
      expect(result.data.mapping!.upgrade_eligible).toBe(false);
      expect(result.data.mapping!.same_day_change).toBe(false);
      expect(result.data.mapping!.changes_allowed).toBe(false);
    });

    it('maps DL E to Basic Economy', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'E', carrier: 'DL' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.fare_family).toBe('Basic Economy');
      expect(result.data.mapping!.upgrade_eligible).toBe(false);
    });

    it('maps UA W to Premium Plus (premium_economy)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'W', carrier: 'UA' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('premium_economy');
      expect(result.data.mapping!.cabin_brand_name).toBe('Premium Plus');
    });

    it('maps DL W to Delta Premium Select', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'W', carrier: 'DL' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('premium_economy');
      expect(result.data.mapping!.cabin_brand_name).toBe('Delta Premium Select');
    });
  });

  describe('Case insensitivity', () => {
    it('handles lowercase booking class', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'j', carrier: 'UA' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('business');
    });

    it('handles lowercase carrier', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'J', carrier: 'ua' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_brand_name).toBe('Polaris');
    });
  });

  describe('Agent interface compliance', () => {
    it('has correct agent metadata', () => {
      expect(mapper.id).toBe('0.4');
      expect(mapper.name).toBe('Class of Service Mapper');
      expect(mapper.version).toBe('0.1.0');
    });

    it('reports healthy status after initialization', async () => {
      const health = await mapper.health();
      expect(health.status).toBe('healthy');
    });

    it('reports unhealthy status before initialization', async () => {
      const uninitMapper = new ClassOfServiceMapper();
      const health = await uninitMapper.health();
      expect(health.status).toBe('unhealthy');
      expect(health.details).toContain('Not initialized');
    });

    it('returns metadata in output', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'J', carrier: 'UA' },
      });

      expect(result.metadata).toBeDefined();
      expect(result.metadata!['agent_id']).toBe('0.4');
      expect(result.metadata!['agent_version']).toBe('0.1.0');
    });

    it('returns confidence in output', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'J', carrier: 'UA' },
      });

      expect(result.confidence).toBe(1.0);
    });

    it('throws AgentNotInitializedError when not initialized', async () => {
      const uninitMapper = new ClassOfServiceMapper();
      await expect(
        uninitMapper.execute({
          data: { booking_class: 'J', carrier: 'UA' },
        }),
      ).rejects.toThrow('not been initialized');
    });
  });

  describe('IATA default fallback coverage', () => {
    it('maps W to premium_economy for unknown carrier', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'W', carrier: 'ZZ' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('premium_economy');
      expect(result.data.match_confidence).toBe(0.7);
    });

    it('maps P to first for unknown carrier (IATA default)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'P', carrier: 'ZZ' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('first');
      expect(result.data.match_confidence).toBe(0.7);
    });
  });

  describe('Basic Economy zero earning', () => {
    it('UA N earns 0% RDM (Basic Economy)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'N', carrier: 'UA', include_loyalty: true },
      });

      expect(result.data.mapping!.loyalty_earning).not.toBeNull();
      expect(result.data.mapping!.loyalty_earning!.rdm_percent).toBe(0);
      expect(result.data.mapping!.loyalty_earning!.status_earning).toBe(false);
    });

    it('AA B earns 0% RDM (Basic Economy)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'B', carrier: 'AA', include_loyalty: true },
      });

      expect(result.data.mapping!.fare_family).toBe('Basic Economy');
      expect(result.data.mapping!.loyalty_earning).not.toBeNull();
      expect(result.data.mapping!.loyalty_earning!.rdm_percent).toBe(0);
      expect(result.data.mapping!.loyalty_earning!.status_earning).toBe(false);
    });
  });

  describe('Issue #148 verified RBD→cabin corrections', () => {
    it('maps AA B to Basic Economy (not Main Cabin Flexible)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'B', carrier: 'AA' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('economy');
      expect(result.data.mapping!.fare_family).toBe('Basic Economy');
      expect(result.data.mapping!.upgrade_eligible).toBe(false);
      expect(result.data.match_confidence).toBe(1.0);
    });

    it('maps AA O to Main Cabin (not Basic Economy)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'O', carrier: 'AA' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('economy');
      expect(result.data.mapping!.fare_family).toBe('Main Cabin');
    });

    it('maps SQ W to Economy Standard (not Premium Economy)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'W', carrier: 'SQ' },
      });

      expect(result.data.mapping).not.toBeNull();
      expect(result.data.mapping!.cabin_class).toBe('economy');
      expect(result.data.mapping!.fare_family).toBe('Economy Standard');
    });

    it('maps SQ S/T/R/L/P to Premium Economy', async () => {
      for (const booking_class of ['S', 'T', 'R', 'L', 'P'] as const) {
        const result = await mapper.execute({
          data: { booking_class, carrier: 'SQ' },
        });
        expect(result.data.mapping!.cabin_class).toBe('premium_economy');
      }
    });

    it('maps SQ U to Business Standard', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'U', carrier: 'SQ' },
      });

      expect(result.data.mapping!.cabin_class).toBe('business');
      expect(result.data.mapping!.fare_family).toBe('Business Standard');
    });

    it('maps SQ E to Economy Flexi (not restricted)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'E', carrier: 'SQ' },
      });

      expect(result.data.mapping!.cabin_class).toBe('economy');
      expect(result.data.mapping!.fare_family).toBe('Economy Flexi');
    });

    it('maps QF T to Premium Economy Sale (not Economy)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'T', carrier: 'QF' },
      });

      expect(result.data.mapping!.cabin_class).toBe('premium_economy');
      expect(result.data.mapping!.fare_family).toBe('Premium Economy Sale');
    });

    it('maps QF Z via IATA fallback only (removed from QF Business; Classic PE reward unmapped)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'Z', carrier: 'QF' },
      });

      // Known carrier, class not in QF revenue map → IATA default (0.7), not carrier-specific (1.0)
      expect(result.data.match_confidence).toBe(0.7);
      expect(result.data.mapping!.cabin_brand_name).toBeNull();
    });

    it('maps QF M to Economy Saver (not Flex)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'M', carrier: 'QF' },
      });

      expect(result.data.mapping!.cabin_class).toBe('economy');
      expect(result.data.mapping!.fare_family).toBe('Economy Saver');
      expect(result.data.match_confidence).toBe(1.0);
    });

    it('maps NH G/E/N to Premium Economy (not Economy / not W,R)', async () => {
      for (const booking_class of ['G', 'E', 'N'] as const) {
        const result = await mapper.execute({
          data: { booking_class, carrier: 'NH' },
        });
        expect(result.data.mapping!.cabin_class).toBe('premium_economy');
        expect(result.data.match_confidence).toBe(1.0);
      }
    });

    it('maps NH W to Economy Restricted (was wrongly PE)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'W', carrier: 'NH' },
      });

      expect(result.data.mapping!.cabin_class).toBe('economy');
      expect(result.data.mapping!.fare_family).toBe('Economy (Restricted)');
      expect(result.data.match_confidence).toBe(1.0);
    });

    it('maps NH P to Business (deep discount)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'P', carrier: 'NH' },
      });

      expect(result.data.mapping!.cabin_class).toBe('business');
      expect(result.data.mapping!.fare_family).toBe('Business (Deep Discount)');
      expect(result.data.match_confidence).toBe(1.0);
    });

    it('maps NH R via IATA fallback only (not eligible on ANA accrual; left unmapped)', async () => {
      const result = await mapper.execute({
        data: { booking_class: 'R', carrier: 'NH' },
      });

      expect(result.data.match_confidence).toBe(0.7);
      expect(result.data.mapping!.cabin_brand_name).toBeNull();
    });
  });
});
