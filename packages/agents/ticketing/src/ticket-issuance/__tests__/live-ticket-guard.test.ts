import { describe, it, expect } from 'vitest';
import { LiveSafetyError } from '@otaip/core';
import { issueTickets } from '../issuance-engine.js';
import type { TicketIssuanceInput } from '../types.js';

function baseInput(overrides: Partial<TicketIssuanceInput> = {}): TicketIssuanceInput {
  return {
    record_locator: 'ABC123',
    issuing_carrier: 'BA',
    passenger_name: 'DOE/JOHN',
    segments: [
      {
        carrier: 'BA',
        flight_number: '178',
        origin: 'LHR',
        destination: 'JFK',
        departure_date: '2026-08-01',
        booking_class: 'Y',
        fare_basis: 'YOW',
      },
    ],
    base_fare: '100.00',
    base_fare_currency: 'USD',
    taxes: [{ code: 'US', amount: '10.00', currency: 'USD' }],
    fare_calculation: 'LHR BA JFK 100.00USD',
    form_of_payment: { type: 'CASH', amount: '110.00', currency: 'USD' },
    ...overrides,
  };
}

describe('live ticket guard (DoD 5)', () => {
  it('allows synthetic serials outside live mode', () => {
    const out = issueTickets(baseInput(), { liveMode: false });
    expect(out.tickets[0]?.ticket_number).toMatch(/^\d+/);
  });

  it('refuses synthetic serials in live mode without supplier numbers', () => {
    expect(() => issueTickets(baseInput(), { liveMode: true })).toThrow(LiveSafetyError);
  });

  it('accepts supplier ticket numbers in live mode', () => {
    const out = issueTickets(
      baseInput({ supplier_ticket_numbers: ['1251234567890'] }),
      { liveMode: true },
    );
    expect(out.tickets[0]?.ticket_number).toBe('1251234567890');
  });
});
