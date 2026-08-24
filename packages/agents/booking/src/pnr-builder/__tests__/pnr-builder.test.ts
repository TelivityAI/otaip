/**
 * PNR Builder — Unit Tests
 *
 * Agent 3.2: GDS PNR command generation for Amadeus, Sabre, Travelport.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PnrBuilder } from '../index.js';
import type { PnrBuilderInput } from '../types.js';

let agent: PnrBuilder;

beforeAll(async () => {
  agent = new PnrBuilder();
  await agent.initialize();
});

afterAll(() => {
  agent.destroy();
});

function makeBaseInput(gds: 'AMADEUS' | 'SABRE' | 'TRAVELPORT'): PnrBuilderInput {
  return {
    gds,
    passengers: [{ last_name: 'Smith', first_name: 'John', title: 'MR', passenger_type: 'ADT' }],
    segments: [
      {
        carrier: 'BA',
        flight_number: '115',
        booking_class: 'Y',
        departure_date: '2026-06-15',
        origin: 'LHR',
        destination: 'JFK',
        quantity: 1,
        status: 'SS',
      },
    ],
    contacts: [{ phone: '+44-20-7946-0958', type: 'AGENCY' }],
    ticketing: { time_limit: '2026-06-10', type: 'TL' },
    received_from: 'AGENT JONES',
  };
}

describe('PNR Builder', () => {
  describe('Amadeus commands', () => {
    it('generates correct name command', async () => {
      const result = await agent.execute({ data: makeBaseInput('AMADEUS') });
      const nameCmd = result.data.commands.find((c) => c.element_type === 'NAME');
      expect(nameCmd).toBeDefined();
      expect(nameCmd!.command).toBe('NM1SMITH/JOHN MR');
    });

    it('generates correct segment command', async () => {
      const result = await agent.execute({ data: makeBaseInput('AMADEUS') });
      const segCmd = result.data.commands.find((c) => c.element_type === 'SEGMENT');
      expect(segCmd).toBeDefined();
      expect(segCmd!.command).toContain('BA115');
      expect(segCmd!.command).toContain('LHRJFK');
    });

    it('generates correct contact command', async () => {
      const result = await agent.execute({ data: makeBaseInput('AMADEUS') });
      const contactCmd = result.data.commands.find((c) => c.element_type === 'CONTACT');
      expect(contactCmd).toBeDefined();
      expect(contactCmd!.command).toMatch(/^AP /);
    });

    it('generates correct ticketing command', async () => {
      const result = await agent.execute({ data: makeBaseInput('AMADEUS') });
      const tktCmd = result.data.commands.find((c) => c.element_type === 'TICKETING');
      expect(tktCmd).toBeDefined();
      expect(tktCmd!.command).toMatch(/^TKTL/);
    });

    it('generates correct received-from command', async () => {
      const result = await agent.execute({ data: makeBaseInput('AMADEUS') });
      const rfCmd = result.data.commands.find((c) => c.element_type === 'RECEIVED_FROM');
      expect(rfCmd).toBeDefined();
      expect(rfCmd!.command).toBe('RF AGENT JONES');
    });

    it('generates end transaction command', async () => {
      const result = await agent.execute({ data: makeBaseInput('AMADEUS') });
      const etCmd = result.data.commands.find((c) => c.element_type === 'END_TRANSACT');
      expect(etCmd).toBeDefined();
      expect(etCmd!.command).toBe('ET');
    });
  });

  describe('Sabre commands', () => {
    it('generates correct name command', async () => {
      const result = await agent.execute({ data: makeBaseInput('SABRE') });
      const nameCmd = result.data.commands.find((c) => c.element_type === 'NAME');
      expect(nameCmd).toBeDefined();
      expect(nameCmd!.command).toBe('-SMITH/JOHN MR');
    });

    it('generates correct segment command', async () => {
      const result = await agent.execute({ data: makeBaseInput('SABRE') });
      const segCmd = result.data.commands.find((c) => c.element_type === 'SEGMENT');
      expect(segCmd).toBeDefined();
      expect(segCmd!.command).toMatch(/^0BA115Y/);
    });

    it('generates correct contact command', async () => {
      const result = await agent.execute({ data: makeBaseInput('SABRE') });
      const contactCmd = result.data.commands.find((c) => c.element_type === 'CONTACT');
      expect(contactCmd).toBeDefined();
      expect(contactCmd!.command).toMatch(/^9/);
      expect(contactCmd!.command).toMatch(/-A$/);
    });

    it('generates correct received-from with Sabre prefix', async () => {
      const result = await agent.execute({ data: makeBaseInput('SABRE') });
      const rfCmd = result.data.commands.find((c) => c.element_type === 'RECEIVED_FROM');
      expect(rfCmd!.command).toBe('6AGENT JONES');
    });

    it('generates end transaction command', async () => {
      const result = await agent.execute({ data: makeBaseInput('SABRE') });
      const etCmd = result.data.commands.find((c) => c.element_type === 'END_TRANSACT');
      expect(etCmd!.command).toBe('E');
    });
  });

  describe('Travelport commands', () => {
    it('generates correct name command', async () => {
      const result = await agent.execute({ data: makeBaseInput('TRAVELPORT') });
      const nameCmd = result.data.commands.find((c) => c.element_type === 'NAME');
      expect(nameCmd).toBeDefined();
      expect(nameCmd!.command).toBe('N:1SMITH/JOHN MR');
    });

    it('generates correct segment command', async () => {
      const result = await agent.execute({ data: makeBaseInput('TRAVELPORT') });
      const segCmd = result.data.commands.find((c) => c.element_type === 'SEGMENT');
      expect(segCmd).toBeDefined();
      expect(segCmd!.command).toMatch(/^0BA115Y/);
      expect(segCmd!.command).toContain('-LHRJFK/');
    });

    it('generates correct received-from with Travelport prefix', async () => {
      const result = await agent.execute({ data: makeBaseInput('TRAVELPORT') });
      const rfCmd = result.data.commands.find((c) => c.element_type === 'RECEIVED_FROM');
      expect(rfCmd!.command).toBe('R:AGENT JONES');
    });

    it('generates end transaction command', async () => {
      const result = await agent.execute({ data: makeBaseInput('TRAVELPORT') });
      const etCmd = result.data.commands.find((c) => c.element_type === 'END_TRANSACT');
      expect(etCmd!.command).toBe('ER');
    });
  });

  describe('Five mandatory PNR elements', () => {
    it('contains all 5 mandatory elements', async () => {
      const result = await agent.execute({ data: makeBaseInput('AMADEUS') });
      const types = new Set(result.data.commands.map((c) => c.element_type));
      expect(types.has('NAME')).toBe(true);
      expect(types.has('SEGMENT')).toBe(true);
      expect(types.has('CONTACT')).toBe(true);
      expect(types.has('TICKETING')).toBe(true);
      expect(types.has('RECEIVED_FROM')).toBe(true);
    });
  });

  describe('SSR codes', () => {
    it('generates WCHR wheelchair SSR', async () => {
      const input = makeBaseInput('AMADEUS');
      input.ssrs = [{ code: 'WCHR', carrier: 'BA', text: 'WHEELCHAIR NEEDED', passenger_index: 1 }];

      const result = await agent.execute({ data: input });
      const ssrCmd = result.data.commands.find(
        (c) => c.element_type === 'SSR' && c.description.includes('WCHR'),
      );
      expect(ssrCmd).toBeDefined();
      expect(ssrCmd!.command).toContain('WCHR');
    });

    it('generates VGML vegetarian meal SSR', async () => {
      const input = makeBaseInput('SABRE');
      input.ssrs = [
        {
          code: 'VGML',
          carrier: 'BA',
          text: 'VEGETARIAN MEAL',
          passenger_index: 1,
          segment_index: 1,
        },
      ];

      const result = await agent.execute({ data: input });
      const ssrCmd = result.data.commands.find(
        (c) => c.element_type === 'SSR' && c.description.includes('VGML'),
      );
      expect(ssrCmd).toBeDefined();
    });

    it('generates CTCE email SSR', async () => {
      const input = makeBaseInput('AMADEUS');
      input.contacts = [{ phone: '+1-212-555-0100', email: 'john@example.com', type: 'PASSENGER' }];

      const result = await agent.execute({ data: input });
      const emailCmd = result.data.commands.find((c) => c.description.includes('Email'));
      expect(emailCmd).toBeDefined();
      expect(emailCmd!.command).toContain('CTCE');
    });
  });

  describe('OSI elements', () => {
    it('generates OSI element for Amadeus', async () => {
      const input = makeBaseInput('AMADEUS');
      input.osis = [{ carrier: 'BA', text: 'VIP PAX' }];

      const result = await agent.execute({ data: input });
      const osiCmd = result.data.commands.find((c) => c.element_type === 'OSI');
      expect(osiCmd).toBeDefined();
      expect(osiCmd!.command).toBe('OS BA VIP PAX');
    });

    it('generates OSI element for Sabre', async () => {
      const input = makeBaseInput('SABRE');
      input.osis = [{ carrier: 'AA', text: 'CORPORATE ACCOUNT' }];

      const result = await agent.execute({ data: input });
      const osiCmd = result.data.commands.find((c) => c.element_type === 'OSI');
      expect(osiCmd!.command).toBe('3OSIAA/CORPORATE ACCOUNT');
    });
  });

  describe('Infant handling', () => {
    it('attaches Amadeus infant to adult name with DOB (Service Hub form)', async () => {
      const input = makeBaseInput('AMADEUS');
      input.passengers.push({
        last_name: 'Smith',
        first_name: 'Baby',
        passenger_type: 'INF',
        infant_accompanying_adult: 0,
        date_of_birth: '2025-01-14',
      });

      const result = await agent.execute({ data: input });
      const nameCmds = result.data.commands.filter((c) => c.element_type === 'NAME');
      expect(nameCmds.length).toBe(1);
      expect(nameCmds[0]!.command).toBe('NM1SMITH/JOHN MR(INF/BABY/14JAN25)');
      expect(result.data.infant_count).toBe(1);
    });

    it('generates Sabre -I/ infant name and 3INFT when DOB present', async () => {
      const input = makeBaseInput('SABRE');
      input.passengers.push({
        last_name: 'Smith',
        first_name: 'Baby',
        passenger_type: 'INF',
        infant_accompanying_adult: 0,
        date_of_birth: '2025-01-14',
      });

      const result = await agent.execute({ data: input });
      const infCmd = result.data.commands.find((c) => c.description.includes('Infant:'));
      expect(infCmd).toBeDefined();
      expect(infCmd!.command).toBe('-I/SMITH/BABY');
      const inftSsr = result.data.commands.find(
        (c) => c.element_type === 'SSR' && c.command.startsWith('3INFT/'),
      );
      expect(inftSsr!.command).toBe('3INFT/SMITH/BABY/14JAN25-1.1');
    });

    it('generates Travelport Apollo infant name with DOB and P-INF01', async () => {
      const input = makeBaseInput('TRAVELPORT');
      input.passengers.push({
        last_name: 'Smith',
        first_name: 'Baby',
        passenger_type: 'INF',
        infant_accompanying_adult: 0,
        date_of_birth: '2025-01-14',
      });

      const result = await agent.execute({ data: input });
      const infCmd = result.data.commands.find((c) => c.description.includes('Infant:'));
      expect(infCmd!.command).toBe('N:I/SMITH/BABY*14JAN25/P-INF01');
    });

    it('warns about infant passengers', async () => {
      const input = makeBaseInput('AMADEUS');
      input.passengers.push({
        last_name: 'Smith',
        first_name: 'Baby',
        passenger_type: 'INF',
        infant_accompanying_adult: 0,
        date_of_birth: '2025-01-14',
      });

      const result = await agent.execute({ data: input });
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.includes('infant'))).toBe(true);
    });
  });

  describe('Child and infant golden strings (KB-verified)', () => {
    it('Amadeus child with DOB', async () => {
      const input = makeBaseInput('AMADEUS');
      input.passengers = [
        {
          last_name: 'Lee',
          first_name: 'Tom',
          passenger_type: 'CHD',
          date_of_birth: '2015-06-12',
        },
      ];

      const result = await agent.execute({ data: input });
      const nameCmd = result.data.commands.find((c) => c.element_type === 'NAME');
      expect(nameCmd!.command).toBe('NM1LEE/TOM(CHD/12JUN15)');
    });

    it('Amadeus adult+infant different surname', async () => {
      const input = makeBaseInput('AMADEUS');
      input.passengers = [
        { last_name: 'Lee', first_name: 'Ann', title: 'MS', passenger_type: 'ADT' },
        {
          last_name: 'Smith',
          first_name: 'Baby',
          passenger_type: 'INF',
          infant_accompanying_adult: 0,
          date_of_birth: '2022-07-17',
        },
      ];

      const result = await agent.execute({ data: input });
      const nameCmd = result.data.commands.find((c) => c.element_type === 'NAME');
      expect(nameCmd!.command).toBe('NM1LEE/ANN MS(INFSMITH/BABY/17JUL22)');
    });

    it('Sabre adult + lap infant golden path', async () => {
      const input = makeBaseInput('SABRE');
      input.passengers = [
        { last_name: 'Lee', first_name: 'Ann', title: 'MS', passenger_type: 'ADT' },
        {
          last_name: 'Lee',
          first_name: 'Baby',
          passenger_type: 'INF',
          infant_accompanying_adult: 0,
          date_of_birth: '2022-07-17',
        },
      ];

      const result = await agent.execute({ data: input });
      const names = result.data.commands.filter((c) => c.element_type === 'NAME').map((c) => c.command);
      expect(names).toEqual(['-LEE/ANN MS', '-I/LEE/BABY']);
      expect(
        result.data.commands.some((c) => c.command === '3INFT/LEE/BABY/17JUL22-1.1'),
      ).toBe(true);
    });

    it('Sabre child uses adult-style name only (DQ-N1 — no invented *Cxx)', async () => {
      const input = makeBaseInput('SABRE');
      input.passengers = [
        {
          last_name: 'Lee',
          first_name: 'Tom',
          title: 'MSTR',
          passenger_type: 'CHD',
          date_of_birth: '2015-06-12',
        },
      ];

      const result = await agent.execute({ data: input });
      const nameCmd = result.data.commands.find((c) => c.element_type === 'NAME');
      expect(nameCmd!.command).toBe('-LEE/TOM MSTR');
      expect(nameCmd!.command).not.toMatch(/\*C/);
    });

    it('Travelport Apollo child with *P-Cxx from DOB vs first segment', async () => {
      const input = makeBaseInput('TRAVELPORT');
      // departure 2026-06-15, DOB 2015-06-12 → age 11
      input.passengers = [
        {
          last_name: 'Lee',
          first_name: 'Tom',
          passenger_type: 'CHD',
          date_of_birth: '2015-06-12',
        },
      ];

      const result = await agent.execute({ data: input });
      const nameCmd = result.data.commands.find((c) => c.element_type === 'NAME');
      expect(nameCmd!.command).toBe('N:1LEE/TOM*P-C11');
    });

    it('Travelport Apollo adult + infant golden path', async () => {
      const input = makeBaseInput('TRAVELPORT');
      input.passengers = [
        { last_name: 'Lee', first_name: 'Ann', title: 'MS', passenger_type: 'ADT' },
        {
          last_name: 'Lee',
          first_name: 'Baby',
          passenger_type: 'INF',
          infant_accompanying_adult: 0,
          date_of_birth: '2022-07-17',
        },
      ];

      const result = await agent.execute({ data: input });
      const names = result.data.commands.filter((c) => c.element_type === 'NAME').map((c) => c.command);
      expect(names).toEqual(['N:1LEE/ANN MS', 'N:I/LEE/BABY*17JUL22/P-INF01']);
    });

    it('Sabre INFT links to second adult name number when infant_accompanying_adult=1', async () => {
      const input = makeBaseInput('SABRE');
      input.passengers = [
        { last_name: 'Lee', first_name: 'Ann', title: 'MS', passenger_type: 'ADT' },
        { last_name: 'Lee', first_name: 'Bob', title: 'MR', passenger_type: 'ADT' },
        {
          last_name: 'Lee',
          first_name: 'Baby',
          passenger_type: 'INF',
          infant_accompanying_adult: 1,
          date_of_birth: '2022-07-17',
        },
      ];
      input.segments[0] = { ...input.segments[0]!, quantity: 2 };

      const result = await agent.execute({ data: input });
      expect(
        result.data.commands.some((c) => c.command === '3INFT/LEE/BABY/17JUL22-2.1'),
      ).toBe(true);
    });
  });

  describe('Group PNR', () => {
    it('generates group header for Amadeus', async () => {
      const input = makeBaseInput('AMADEUS');
      input.is_group = true;
      input.group_name = 'ACME CORP TRIP';
      // Add more passengers for group
      for (let i = 0; i < 11; i++) {
        input.passengers.push({
          last_name: 'Groupmember',
          first_name: 'Person',
          passenger_type: 'ADT',
        });
      }

      const result = await agent.execute({ data: input });
      const groupCmd = result.data.commands.find((c) => c.element_type === 'GROUP');
      expect(groupCmd).toBeDefined();
      expect(groupCmd!.command).toContain('ACME CORP TRIP');
      expect(result.data.is_group).toBe(true);
    });

    it('generates group header for Sabre', async () => {
      const input = makeBaseInput('SABRE');
      input.is_group = true;
      input.group_name = 'TEAM TRAVEL';
      for (let i = 0; i < 10; i++) {
        input.passengers.push({ last_name: 'Member', first_name: 'Team', passenger_type: 'ADT' });
      }

      const result = await agent.execute({ data: input });
      const groupCmd = result.data.commands.find((c) => c.element_type === 'GROUP');
      expect(groupCmd).toBeDefined();
      expect(groupCmd!.command).toContain('TEAM TRAVEL');
    });
  });

  describe('DOCS/APIS commands', () => {
    it('generates DOCS SSR for passenger with passport', async () => {
      const input = makeBaseInput('AMADEUS');
      input.passengers[0] = {
        ...input.passengers[0]!,
        date_of_birth: '1985-01-12',
        gender: 'M',
        nationality: 'GB',
        passport_number: 'P12345678',
        passport_expiry: '2030-01-15',
        passport_country: 'GB',
      };

      const result = await agent.execute({ data: input });
      const docsCmd = result.data.commands.find((c) => c.description.includes('DOCS'));
      expect(docsCmd).toBeDefined();
      expect(docsCmd!.command).toContain('P12345678');
      expect(docsCmd!.command).toContain('SMITH');
    });

    it('warns about missing APIS data', async () => {
      const result = await agent.execute({ data: makeBaseInput('AMADEUS') });
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some((w) => w.includes('APIS'))).toBe(true);
    });
  });

  describe('Input validation', () => {
    it('rejects invalid GDS', async () => {
      const input = makeBaseInput('AMADEUS');
      (input as Record<string, unknown>).gds = 'INVALID';
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects empty passengers', async () => {
      const input = makeBaseInput('AMADEUS');
      input.passengers = [];
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects empty segments', async () => {
      const input = makeBaseInput('AMADEUS');
      input.segments = [];
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects infant without accompanying adult', async () => {
      const input = makeBaseInput('AMADEUS');
      input.passengers.push({ last_name: 'Baby', first_name: 'Test', passenger_type: 'INF' });
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects missing received_from', async () => {
      const input = makeBaseInput('AMADEUS');
      input.received_from = '';
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });

    it('rejects group PNR without group name', async () => {
      const input = makeBaseInput('AMADEUS');
      input.is_group = true;
      input.group_name = '';
      await expect(agent.execute({ data: input })).rejects.toThrow('Invalid input');
    });
  });

  describe('Agent interface compliance', () => {
    it('has correct metadata', () => {
      expect(agent.id).toBe('3.2');
      expect(agent.name).toBe('PNR Builder');
      expect(agent.version).toBe('0.1.0');
    });

    it('reports healthy', async () => {
      const health = await agent.health();
      expect(health.status).toBe('healthy');
    });

    it('returns metadata in output', async () => {
      const result = await agent.execute({ data: makeBaseInput('AMADEUS') });
      expect(result.metadata!['agent_id']).toBe('3.2');
      expect(result.metadata!['gds']).toBe('AMADEUS');
    });

    it('throws when not initialized', async () => {
      const uninit = new PnrBuilder();
      await expect(uninit.execute({ data: makeBaseInput('AMADEUS') })).rejects.toThrow(
        'not been initialized',
      );
    });
  });
});
