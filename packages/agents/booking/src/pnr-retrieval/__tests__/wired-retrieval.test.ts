import { describe, it, expect } from 'vitest';
import { PnrRetrieval } from '../index.js';

describe('PnrRetrieval wired ports', () => {
  it('maps getBookingStatus port into output', async () => {
    const agent = new PnrRetrieval({
      bookingStatusPort: {
        async getBookingStatus(id) {
          return {
            bookingId: id,
            supplier: 'sabre',
            status: 'ticketed',
            pnr: id,
            ticketNumbers: ['0012345678901'],
            segments: [
              [
                {
                  departure: { iataCode: 'JFK', at: '2026-09-01T10:00:00' },
                  arrival: { iataCode: 'LHR', at: '2026-09-01T22:00:00' },
                  carrierCode: 'BA',
                  flightNumber: '178',
                  cabin: 'Y',
                },
              ],
            ],
            passengers: [{ firstName: 'JOHN', lastName: 'DOE', type: 'ADT' }],
          };
        },
      },
    });
    await agent.initialize();
    const result = await agent.execute({
      data: { record_locator: 'ABC123' },
    });
    expect(result.data.booking_status).toBe('TICKETED');
    expect(result.data.passengers[0]?.ticket_numbers?.[0]).toBe('0012345678901');
    expect(result.data.segments).toHaveLength(1);
    expect(result.metadata?.['wired']).toBe(true);
  });

  it('maps getOrder port (Duffel-style documents)', async () => {
    const agent = new PnrRetrieval({
      orderPort: {
        async getOrder(id) {
          return {
            id,
            booking_reference: 'XYZ987',
            ticketNumbers: [{ number: '1259999999999' }],
            passengers: [{ given_name: 'JANE', family_name: 'DOE', type: 'ADT' }],
            slices: [
              {
                segments: [
                  {
                    origin: { iata_code: 'SFO' },
                    destination: { iata_code: 'LAX' },
                    marketing_carrier: { iata_code: 'UA' },
                    marketing_carrier_flight_number: '123',
                    departing_at: '2026-10-01T08:00:00',
                    cabin_class: 'Y',
                  },
                ],
              },
            ],
          };
        },
      },
    });
    await agent.initialize();
    const result = await agent.execute({ data: { record_locator: 'ORD123' } });
    expect(result.data.record_locator).toBe('XYZ987');
    expect(result.data.source).toBe('NDC');
    expect(result.data.ticketing.status).toBe('TICKETED');
  });
});
