/**
 * Involuntary Rebook — Unit Tests
 *
 * Agent 5.3: Schedule change handling, reprotection candidates, regulatory entitlements.
 *
 * Threshold and EU261 inputs are PASSED EXPLICITLY (no invented defaults / no 60-min hardcode).
 * Art.7 distance is great-circle only (never TPM). Art.8 choice required when EU261 applies.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { InvoluntaryRebook } from '../index.js';
import type {
  InvoluntaryRebookInput,
  OriginalPnrSummary,
  ScheduleChangeNotification,
} from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): {
  id: string;
  expect: {
    is_involuntary: boolean;
    trigger: string;
    eu261_applies: boolean;
    us_dot_applies: boolean;
    art8_passenger_choice_required: boolean;
    protection_path?: string;
    measurement_point?: string;
  };
  input: InvoluntaryRebookInput;
} {
  const raw = readFileSync(join(__dirname, 'fixtures', name), 'utf8');
  return JSON.parse(raw) as ReturnType<typeof loadFixture>;
}

let agent: InvoluntaryRebook;

beforeAll(async () => {
  agent = new InvoluntaryRebook();
  await agent.initialize();
});

afterAll(() => {
  agent.destroy();
});

function makePnr(overrides: Partial<OriginalPnrSummary> = {}): OriginalPnrSummary {
  return {
    record_locator: 'ABC123',
    passenger_name: 'SMITH/JOHN',
    affected_segment: {
      carrier: 'BA',
      flight_number: '115',
      origin: 'LHR',
      destination: 'JFK',
      departure_date: '2026-06-15',
      departure_time: '09:00',
      booking_class: 'Y',
      fare_basis: 'YOWUS',
      operating_carrier: 'BA',
    },
    issuing_carrier: 'BA',
    departure_country: 'GB',
    arrival_country: 'US',
    is_checked_in: false,
    is_eu_carrier: true,
    ...overrides,
  };
}

function makeChange(
  overrides: Partial<ScheduleChangeNotification> = {},
): ScheduleChangeNotification {
  return {
    change_type: 'TIME_CHANGE',
    original_departure_time: '09:00',
    new_departure_time: '11:30',
    time_change_minutes: 150,
    ...overrides,
  };
}

function makeInput(overrides: Partial<InvoluntaryRebookInput> = {}): InvoluntaryRebookInput {
  return {
    original_pnr: makePnr(),
    schedule_change: makeChange(),
    // Explicit carrier threshold — NOT a hardcoded industry 60.
    thresholds: { time_change_minutes: 90, measurement_point: 'DEPARTURE' },
    available_flights: [
      {
        carrier: 'BA',
        flight_number: '117',
        departure_date: '2026-06-15',
        departure_time: '14:00',
        booking_class: 'Y',
        is_same_operating_carrier: true,
        is_alliance_partner: false,
        is_interline: false,
        endorsement_allows: true,
      },
      {
        carrier: 'AA',
        flight_number: '100',
        departure_date: '2026-06-15',
        departure_time: '15:00',
        booking_class: 'Y',
        is_same_operating_carrier: false,
        is_marketing_carrier: false,
        is_alliance_partner: true,
        is_interline: false,
        endorsement_allows: true,
      },
      {
        carrier: 'UA',
        flight_number: '900',
        departure_date: '2026-06-15',
        departure_time: '18:00',
        booking_class: 'Y',
        is_same_operating_carrier: false,
        is_alliance_partner: false,
        is_interline: true,
        endorsement_allows: true,
      },
    ],
    ...overrides,
  };
}

describe('Involuntary Rebook', () => {
  describe('Trigger assessment — fail closed', () => {
    it('marks time change > supplied carrier threshold as involuntary', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.result.is_involuntary).toBe(true);
      expect(result.data.result.trigger).toBe('TIME_CHANGE');
      expect(result.data.result.measurement_point).toBe('DEPARTURE');
    });

    it('marks time change <= supplied threshold as not involuntary', async () => {
      const input = makeInput({
        schedule_change: makeChange({ time_change_minutes: 30 }),
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.is_involuntary).toBe(false);
    });

    it('respects custom carrier time threshold (not a hardcoded 60)', async () => {
      const input = makeInput({
        schedule_change: makeChange({ time_change_minutes: 75 }),
        thresholds: { time_change_minutes: 90, measurement_point: 'ARRIVAL' },
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.is_involuntary).toBe(false);
      expect(result.data.result.measurement_point).toBe('ARRIVAL');
    });

    it('fail-closes when time threshold missing — DOMAIN_INPUT_REQUIRED', async () => {
      const input = makeInput({ thresholds: undefined });
      const result = await agent.execute({ data: input });
      expect(result.data.result.is_involuntary).toBe(false);
      expect(result.warnings).toBeDefined();
      expect(
        result.warnings!.some(
          (w) => w.includes('DOMAIN_INPUT_REQUIRED') && w.includes('time_change_minutes'),
        ),
      ).toBe(true);
    });

    it('fail-closes when measurement_point missing for TIME_CHANGE', async () => {
      const input = makeInput({
        thresholds: { time_change_minutes: 90 },
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.is_involuntary).toBe(false);
      expect(
        result.warnings!.some(
          (w) => w.includes('DOMAIN_INPUT_REQUIRED') && w.includes('measurement_point'),
        ),
      ).toBe(true);
    });

    it('fail-closes MISCONNECT without carrier misconnect threshold', async () => {
      const input = makeInput({
        schedule_change: {
          change_type: 'MISCONNECT',
          misconnect_shortfall_minutes: 40,
        },
        thresholds: undefined,
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.is_involuntary).toBe(false);
      expect(result.data.result.trigger).toBe('MISCONNECT');
      expect(
        result.warnings!.some(
          (w) => w.includes('DOMAIN_INPUT_REQUIRED') && w.includes('misconnect_minutes'),
        ),
      ).toBe(true);
    });

    it('marks MISCONNECT involuntary when shortfall meets carrier threshold', async () => {
      const input = makeInput({
        schedule_change: {
          change_type: 'MISCONNECT',
          misconnect_shortfall_minutes: 40,
        },
        thresholds: { misconnect_minutes: 1, measurement_point: 'ARRIVAL' },
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.is_involuntary).toBe(true);
      expect(result.data.result.trigger).toBe('MISCONNECT');
    });

    it('flight cancellation is always involuntary', async () => {
      const input = makeInput({
        schedule_change: { change_type: 'FLIGHT_CANCELLATION' },
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.is_involuntary).toBe(true);
      expect(result.data.result.trigger).toBe('FLIGHT_CANCELLATION');
    });

    it('routing change is involuntary', async () => {
      const input = makeInput({
        schedule_change: {
          change_type: 'ROUTING_CHANGE',
          original_routing: ['LHR', 'JFK'],
          new_routing: ['LHR', 'BOS', 'JFK'],
        },
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.is_involuntary).toBe(true);
      expect(result.data.result.trigger).toBe('ROUTING_CHANGE');
    });

    it('equipment downgrade is flagged but not auto-involuntary', async () => {
      const input = makeInput({
        schedule_change: {
          change_type: 'EQUIPMENT_DOWNGRADE',
          original_equipment: '777',
          new_equipment: '737',
          original_is_widebody: true,
          new_is_widebody: false,
        },
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.is_involuntary).toBe(false);
      expect(result.data.result.trigger).toBe('EQUIPMENT_DOWNGRADE');
    });
  });

  describe('No-show detection', () => {
    it('flags passenger no-show', async () => {
      const input = makeInput({ is_passenger_no_show: true });
      const result = await agent.execute({ data: input });
      expect(result.data.result.is_no_show).toBe(true);
      expect(result.data.result.is_involuntary).toBe(false);
    });

    it('no original routing credit for no-show', async () => {
      const input = makeInput({ is_passenger_no_show: true });
      const result = await agent.execute({ data: input });
      expect(result.data.result.original_routing_credit).toBe(false);
    });

    it('warns about no-show', async () => {
      const input = makeInput({ is_passenger_no_show: true });
      const result = await agent.execute({ data: input });
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.includes('no-show'))).toBe(true);
    });
  });

  describe('Reprotection candidates — hierarchy + endorsement', () => {
    it('ranks same operating first (candidate only — not silent execution)', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.result.protection_path).toBe('SAME_OPERATING');
      expect(result.data.result.protection_options[0]!.carrier).toBe('BA');
      // Art.8: EU depart → choice required; do not treat ranking as executed rebook.
      expect(result.data.result.art8_passenger_choice_required).toBe(true);
      expect(result.data.result.art8_choices).toEqual([
        'REIMBURSEMENT',
        'REROUTING_EARLIEST',
        'REROUTING_LATER',
      ]);
    });

    it('ranks marketing carrier before alliance', async () => {
      const input = makeInput({
        available_flights: [
          {
            carrier: 'IB',
            flight_number: '3165',
            departure_date: '2026-06-15',
            departure_time: '16:00',
            booking_class: 'Y',
            is_same_operating_carrier: false,
            is_marketing_carrier: true,
            is_alliance_partner: true,
            is_interline: false,
            endorsement_allows: true,
          },
          {
            carrier: 'AA',
            flight_number: '100',
            departure_date: '2026-06-15',
            departure_time: '15:00',
            booking_class: 'Y',
            is_same_operating_carrier: false,
            is_alliance_partner: true,
            is_interline: false,
            endorsement_allows: true,
          },
        ],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.protection_path).toBe('MARKETING_CARRIER');
      expect(result.data.result.protection_options.map((o) => o.path)).toEqual([
        'MARKETING_CARRIER',
        'ALLIANCE_PARTNER',
      ]);
    });

    it('falls back to alliance partner when endorsement allows', async () => {
      const input = makeInput({
        available_flights: [
          {
            carrier: 'AA',
            flight_number: '100',
            departure_date: '2026-06-15',
            departure_time: '15:00',
            booking_class: 'Y',
            is_same_operating_carrier: false,
            is_alliance_partner: true,
            is_interline: false,
            endorsement_allows: true,
          },
        ],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.protection_path).toBe('ALLIANCE_PARTNER');
    });

    it('excludes alliance candidate when endorsement_allows is false', async () => {
      const input = makeInput({
        available_flights: [
          {
            carrier: 'AA',
            flight_number: '100',
            departure_date: '2026-06-15',
            departure_time: '15:00',
            booking_class: 'Y',
            is_same_operating_carrier: false,
            is_alliance_partner: true,
            is_interline: false,
            endorsement_allows: false,
          },
        ],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.protection_path).toBe('NONE_AVAILABLE');
      expect(result.warnings!.some((w) => w.includes('Endorsement constraint'))).toBe(true);
    });

    it('fail-closes non–same-operating when endorsement_allows omitted', async () => {
      const input = makeInput({
        available_flights: [
          {
            carrier: 'AA',
            flight_number: '100',
            departure_date: '2026-06-15',
            departure_time: '15:00',
            booking_class: 'Y',
            is_same_operating_carrier: false,
            is_alliance_partner: true,
            is_interline: false,
          },
        ],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.protection_options).toHaveLength(0);
      expect(
        result.warnings!.some(
          (w) => w.includes('DOMAIN_INPUT_REQUIRED') && w.includes('endorsement_allows'),
        ),
      ).toBe(true);
    });

    it('falls back to interline as later-ranked candidate', async () => {
      const input = makeInput({
        available_flights: [
          {
            carrier: 'UA',
            flight_number: '900',
            departure_date: '2026-06-15',
            departure_time: '18:00',
            booking_class: 'Y',
            is_same_operating_carrier: false,
            is_alliance_partner: false,
            is_interline: true,
            endorsement_allows: true,
          },
        ],
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.protection_path).toBe('INTERLINE');
    });

    it('reports NONE_AVAILABLE when no flights', async () => {
      const input = makeInput({ available_flights: [] });
      const result = await agent.execute({ data: input });
      expect(result.data.result.protection_path).toBe('NONE_AVAILABLE');
    });

    it('lists candidates in hierarchy order', async () => {
      const result = await agent.execute({ data: makeInput() });
      const paths = result.data.result.protection_options.map((o) => o.path);
      expect(paths[0]).toBe('SAME_OPERATING');
      expect(paths[1]).toBe('ALLIANCE_PARTNER');
      expect(paths[2]).toBe('INTERLINE');
    });

    it('no protection candidates for non-involuntary change', async () => {
      const input = makeInput({
        schedule_change: makeChange({ time_change_minutes: 15 }),
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.protection_options).toHaveLength(0);
      expect(result.data.result.art8_passenger_choice_required).toBe(false);
    });
  });

  describe('Regulatory entitlements — EU261 Art.3/7/8', () => {
    it('flags EU261 for EU departure (any carrier)', async () => {
      const result = await agent.execute({ data: makeInput() });
      const eu261 = result.data.result.regulatory_flags.find((f) => f.framework === 'EU261');
      expect(eu261).toBeDefined();
      expect(eu261!.applies).toBe(true);
      expect(eu261!.reason).toMatch(/Art\.3\(1\)\(a\)/);
    });

    it('requires Art.8 passenger choice when EU261 applies', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.result.art8_passenger_choice_required).toBe(true);
      expect(result.warnings!.some((w) => w.includes('Art.8'))).toBe(true);
    });

    it('reports DOMAIN_INPUT_REQUIRED when EU261 inputs are missing', async () => {
      const result = await agent.execute({ data: makeInput() });
      const eu261 = result.data.result.regulatory_flags.find((f) => f.framework === 'EU261')!;
      expect(eu261.compensation_eur).toBeNull();
      expect(eu261.missing_inputs).toBeDefined();
      expect(eu261.missing_inputs).toContain('eu261_inputs.distance_km');
    });

    it('computes €600 for >3500km flight delayed 5h (Art.7 great-circle band)', async () => {
      const input = makeInput({
        eu261_inputs: {
          distance_km: 6000,
          arrival_delay_hours: 5,
          extraordinary_circumstances: false,
        },
      });
      const result = await agent.execute({ data: input });
      const eu261 = result.data.result.regulatory_flags.find((f) => f.framework === 'EU261')!;
      expect(eu261.compensation_eur).toBe('600.00');
      expect(eu261.reduction_percent).toBe(0);
    });

    it('applies Article 7(2) 50% rerouting reduction when alternative arrival within band', async () => {
      const input = makeInput({
        eu261_inputs: {
          distance_km: 6000,
          arrival_delay_hours: 5,
          extraordinary_circumstances: false,
          rerouting_offered: true,
          rerouting_arrival_lateness_hours: 4,
        },
      });
      const result = await agent.execute({ data: input });
      const eu261 = result.data.result.regulatory_flags.find((f) => f.framework === 'EU261')!;
      expect(eu261.compensation_eur).toBe('300.00');
      expect(eu261.reduction_percent).toBe(50);
    });

    it('returns €0 under extraordinary circumstances', async () => {
      const input = makeInput({
        eu261_inputs: {
          distance_km: 6000,
          arrival_delay_hours: 5,
          extraordinary_circumstances: true,
        },
      });
      const result = await agent.execute({ data: input });
      const eu261 = result.data.result.regulatory_flags.find((f) => f.framework === 'EU261')!;
      expect(eu261.compensation_eur).toBe('0.00');
    });

    it('flags EU261 for EU arrival on Community carrier (Art.3(1)(b))', async () => {
      const input = makeInput({
        original_pnr: makePnr({
          departure_country: 'US',
          arrival_country: 'GB',
          is_eu_carrier: true,
          affected_segment: {
            carrier: 'BA',
            flight_number: '116',
            origin: 'JFK',
            destination: 'LHR',
            departure_date: '2026-06-15',
            departure_time: '21:00',
            booking_class: 'Y',
            fare_basis: 'YOWUS',
            operating_carrier: 'BA',
          },
        }),
        schedule_change: { change_type: 'FLIGHT_CANCELLATION' },
      });
      const result = await agent.execute({ data: input });
      const eu261 = result.data.result.regulatory_flags.find((f) => f.framework === 'EU261');
      expect(eu261!.applies).toBe(true);
      expect(eu261!.reason).toMatch(/Art\.3\(1\)\(b\)/);
    });

    it('does NOT flag EU261 for EU carrier on third-country→third-country route', async () => {
      // Art.3 does not say "EU carrier anywhere" — US→JP on BA is out of scope.
      const input = makeInput({
        original_pnr: makePnr({
          departure_country: 'US',
          arrival_country: 'JP',
          is_eu_carrier: true,
          affected_segment: {
            carrier: 'BA',
            flight_number: '5',
            origin: 'JFK',
            destination: 'NRT',
            departure_date: '2026-06-15',
            departure_time: '11:00',
            booking_class: 'Y',
            fare_basis: 'YOWJP',
            operating_carrier: 'BA',
          },
        }),
        schedule_change: { change_type: 'FLIGHT_CANCELLATION' },
      });
      const result = await agent.execute({ data: input });
      const eu261 = result.data.result.regulatory_flags.find((f) => f.framework === 'EU261');
      expect(eu261!.applies).toBe(false);
      expect(result.data.result.art8_passenger_choice_required).toBe(false);
    });

    it('does not flag EU261 for non-EU carrier from non-EU country to non-EU', async () => {
      const input = makeInput({
        original_pnr: makePnr({
          departure_country: 'US',
          arrival_country: 'JP',
          is_eu_carrier: false,
          affected_segment: {
            carrier: 'NH',
            flight_number: '10',
            origin: 'JFK',
            destination: 'NRT',
            departure_date: '2026-06-15',
            departure_time: '11:00',
            booking_class: 'Y',
            fare_basis: 'YOWJP',
          },
        }),
      });
      const result = await agent.execute({ data: input });
      const eu261 = result.data.result.regulatory_flags.find((f) => f.framework === 'EU261');
      expect(eu261!.applies).toBe(false);
    });
  });

  describe('Regulatory entitlements — US DOT IDB', () => {
    it('reports US DOT IDB as not applicable on delay/cancel rebook path', async () => {
      const result = await agent.execute({ data: makeInput() });
      const usDot = result.data.result.regulatory_flags.find((f) => f.framework === 'US_DOT');
      expect(usDot).toBeDefined();
      expect(usDot!.applies).toBe(false);
      expect(usDot!.reason).toMatch(/14 CFR §250/);
    });

    it('flags US_DOT applies only when is_oversale_denied_boarding is true', async () => {
      const input = makeInput({
        schedule_change: { change_type: 'FLIGHT_CANCELLATION' },
        is_oversale_denied_boarding: true,
        original_pnr: makePnr({
          departure_country: 'US',
          arrival_country: 'US',
          is_eu_carrier: false,
          affected_segment: {
            carrier: 'DL',
            flight_number: '1',
            origin: 'ATL',
            destination: 'JFK',
            departure_date: '2026-06-15',
            departure_time: '09:00',
            booking_class: 'Y',
            fare_basis: 'YOWUS',
          },
        }),
      });
      const result = await agent.execute({ data: input });
      const usDot = result.data.result.regulatory_flags.find((f) => f.framework === 'US_DOT')!;
      expect(usDot.applies).toBe(true);
      expect(usDot.reason).toMatch(/oversales/);
    });
  });

  describe('Scenario fixtures (#146)', () => {
    it('eu-depart-any-carrier: Art.3(1)(a) + Art.8 choice', async () => {
      const fixture = loadFixture('eu-depart-any-carrier.json');
      const result = await agent.execute({ data: fixture.input });
      expect(result.data.result.is_involuntary).toBe(fixture.expect.is_involuntary);
      expect(result.data.result.trigger).toBe(fixture.expect.trigger);
      const eu261 = result.data.result.regulatory_flags.find((f) => f.framework === 'EU261')!;
      expect(eu261.applies).toBe(fixture.expect.eu261_applies);
      const usDot = result.data.result.regulatory_flags.find((f) => f.framework === 'US_DOT')!;
      expect(usDot.applies).toBe(fixture.expect.us_dot_applies);
      expect(result.data.result.art8_passenger_choice_required).toBe(
        fixture.expect.art8_passenger_choice_required,
      );
      expect(result.data.result.protection_path).toBe(fixture.expect.protection_path);
    });

    it('eu-arrive-non-eu-carrier: Art.3(1)(b) negative — no EU261', async () => {
      const fixture = loadFixture('eu-arrive-non-eu-carrier.json');
      const result = await agent.execute({ data: fixture.input });
      expect(result.data.result.is_involuntary).toBe(fixture.expect.is_involuntary);
      const eu261 = result.data.result.regulatory_flags.find((f) => f.framework === 'EU261')!;
      expect(eu261.applies).toBe(false);
      expect(eu261.reason).toMatch(/non-Community/);
      expect(result.data.result.art8_passenger_choice_required).toBe(false);
    });

    it('us-idb-non-oversale: delay is not IDB — US_DOT false', async () => {
      const fixture = loadFixture('us-idb-non-oversale.json');
      const result = await agent.execute({ data: fixture.input });
      expect(result.data.result.is_involuntary).toBe(true);
      expect(result.data.result.trigger).toBe('TIME_CHANGE');
      expect(result.data.result.measurement_point).toBe('DEPARTURE');
      const eu261 = result.data.result.regulatory_flags.find((f) => f.framework === 'EU261')!;
      expect(eu261.applies).toBe(false);
      const usDot = result.data.result.regulatory_flags.find((f) => f.framework === 'US_DOT')!;
      expect(usDot.applies).toBe(false);
      expect(usDot.reason).toMatch(/oversales/);
      expect(result.data.result.art8_passenger_choice_required).toBe(false);
    });
  });

  describe('Original routing credit', () => {
    it('grants original routing credit for involuntary rebook', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.result.original_routing_credit).toBe(true);
    });

    it('no routing credit for voluntary (non-involuntary)', async () => {
      const input = makeInput({
        schedule_change: makeChange({ time_change_minutes: 15 }),
      });
      const result = await agent.execute({ data: input });
      expect(result.data.result.original_routing_credit).toBe(false);
    });
  });

  describe('Summary', () => {
    it('generates human-readable summary mentioning Art.8 when applicable', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.data.result.summary).toBeTruthy();
      expect(result.data.result.summary.toLowerCase()).toContain('art.8');
      expect(result.data.result.summary.toLowerCase()).toContain('same operating');
    });
  });

  describe('Input validation', () => {
    it('rejects invalid record locator', async () => {
      const input = makeInput({ original_pnr: makePnr({ record_locator: 'bad' }) });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects invalid passenger name', async () => {
      const input = makeInput({ original_pnr: makePnr({ passenger_name: 'bad' }) });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects invalid carrier', async () => {
      const input = makeInput({
        original_pnr: makePnr({
          affected_segment: { ...makePnr().affected_segment, carrier: 'X' },
        }),
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects invalid change type', async () => {
      const input = makeInput({
        schedule_change: { change_type: 'INVALID' as 'TIME_CHANGE' },
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects invalid country code', async () => {
      const input = makeInput({
        original_pnr: makePnr({ departure_country: 'United Kingdom' }),
      });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });
  });

  describe('Agent interface compliance', () => {
    it('has correct metadata', () => {
      expect(agent.id).toBe('5.3');
      expect(agent.name).toBe('Involuntary Rebook');
      expect(agent.version).toBe('0.1.0');
    });

    it('reports healthy', async () => {
      const health = await agent.health();
      expect(health.status).toBe('healthy');
    });

    it('returns metadata in output', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.metadata!['agent_id']).toBe('5.3');
      expect(result.metadata!['is_involuntary']).toBe(true);
      expect(result.metadata!['protection_path']).toBe('SAME_OPERATING');
    });

    it('warns on involuntary change', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.includes('Involuntary'))).toBe(true);
    });

    it('warns on regulatory entitlement', async () => {
      const result = await agent.execute({ data: makeInput() });
      expect(result.warnings!.some((w) => w.includes('EU261'))).toBe(true);
    });

    it('throws when not initialized', async () => {
      const uninit = new InvoluntaryRebook();
      await expect(uninit.execute({ data: makeInput() })).rejects.toThrow('not been initialized');
    });
  });
});
