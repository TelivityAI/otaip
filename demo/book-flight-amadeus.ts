/**
 * OTAIP Amadeus Booking Demo
 *
 * Claude acts as an intelligent booking agent using the Amadeus Self-Service
 * adapter from Telivity Connect. It searches flights via Flight Offers Search v2,
 * evaluates options, prices the best one via Flight Offers Price v1, and creates
 * a booking via Flight Orders v1.
 *
 * Flow: Claude (tool_use) -> OTAIP AmadeusAdapter -> Amadeus Self-Service APIs
 *
 * Requires .env at repo root:
 *   AMADEUS_CLIENT_ID=your_client_id
 *   AMADEUS_CLIENT_SECRET=your_secret
 *   ANTHROPIC_API_KEY=sk-ant-...
 *
 * Run: pnpm --filter @otaip/demo book:amadeus
 */

import Anthropic from '@anthropic-ai/sdk';
import { createAdapter } from '../packages/connect/src/suppliers/index.ts';
import type {
  CabinClass,
  ConnectAdapter,
  FlightOffer,
  PassengerDetail,
} from '../packages/connect/src/types.ts';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

const adapter: ConnectAdapter = createAdapter(
  'amadeus',
  {
    environment: (process.env['AMADEUS_ENVIRONMENT'] ?? 'test') as 'test' | 'production',
    clientId: process.env['AMADEUS_CLIENT_ID'] ?? '',
    clientSecret: process.env['AMADEUS_CLIENT_SECRET'] ?? '',
    defaultCurrency: process.env['AMADEUS_CURRENCY'] ?? 'USD',
  },
  { liveMode: false },
);

// Cache search results so the agent can reference offers by ID
let lastSearchResults: FlightOffer[] = [];

const tools: Anthropic.Tool[] = [
  {
    name: 'search_flights',
    description:
      'Search for available flights via Amadeus Flight Offers Search. Returns all offers with full itinerary and price details. Evaluate ALL options and select the best one based on the traveler context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        origin: { type: 'string', description: 'IATA airport code e.g. LHR' },
        destination: { type: 'string', description: 'IATA airport code e.g. JFK' },
        departure_date: { type: 'string', description: 'YYYY-MM-DD' },
        return_date: {
          type: 'string',
          description: 'YYYY-MM-DD for round-trip. Omit for one-way.',
        },
        cabin_class: {
          type: 'string',
          enum: ['economy', 'premium_economy', 'business', 'first'],
          description: 'Cabin class',
        },
        direct_only: {
          type: 'boolean',
          description: 'Set true to only return nonstop flights',
        },
      },
      required: ['origin', 'destination', 'departure_date', 'cabin_class'],
    },
  },
  {
    name: 'price_offer',
    description:
      'Confirm current price and availability for the selected offer via Amadeus Flight Offers Price. Always call this immediately before booking. If unavailable, pick the next best option.',
    input_schema: {
      type: 'object' as const,
      properties: {
        offer_id: { type: 'string', description: 'offerId from search_flights results' },
      },
      required: ['offer_id'],
    },
  },
  {
    name: 'book_flight',
    description:
      'Create a booking via Amadeus Flight Orders API. Returns a PNR/confirmation ID. Only call this after pricing confirms availability.',
    input_schema: {
      type: 'object' as const,
      properties: {
        offer_id: { type: 'string' },
        passenger_first_name: { type: 'string' },
        passenger_last_name: { type: 'string' },
        passenger_dob: { type: 'string', description: 'YYYY-MM-DD' },
        passenger_gender: { type: 'string', enum: ['M', 'F'] },
        passenger_email: { type: 'string' },
        passenger_phone: { type: 'string', description: 'E.164 e.g. +442080160509' },
        passenger_passport_number: {
          type: 'string',
          description: 'Passport number (optional)',
        },
        passenger_passport_country: {
          type: 'string',
          description: '2-letter country code (optional)',
        },
      },
      required: [
        'offer_id',
        'passenger_first_name',
        'passenger_last_name',
        'passenger_dob',
        'passenger_gender',
        'passenger_email',
        'passenger_phone',
      ],
    },
  },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  console.log(`\n[TOOL CALL] ${name}`);
  console.log(JSON.stringify(input, null, 2));

  try {
    if (name === 'search_flights') {
      const results = await adapter.searchFlights({
        origin: input['origin'] as string,
        destination: input['destination'] as string,
        departureDate: input['departure_date'] as string,
        returnDate: input['return_date'] as string | undefined,
        passengers: { adults: 1 },
        cabinClass: input['cabin_class'] as CabinClass | undefined,
        directOnly: input['direct_only'] as boolean | undefined,
      });

      lastSearchResults = results;

      const offers = results.map((o) => ({
        offer_id: o.offerId,
        validating_carrier: o.validatingCarrier,
        price: { total: o.totalPrice.amount, currency: o.totalPrice.currency },
        cabin: o.cabinClass,
        refundable: o.refundable,
        baggage: o.baggageAllowance ?? null,
        expires_at: o.expiresAt ?? null,
        segments: o.segments.map((leg) =>
          leg.map((s) => ({
            flight: `${s.marketingCarrier}${s.flightNumber}`,
            from: s.origin,
            to: s.destination,
            departs: s.departure,
            arrives: s.arrival,
            duration: s.duration ?? null,
            cabin: s.cabinClass,
            equipment: s.equipment ?? null,
            stops: s.stops,
          })),
        ),
        fares: o.fares.map((f) => ({
          pax_type: f.passengerType,
          base: `${f.baseFare.amount} ${f.baseFare.currency}`,
          taxes: `${f.taxes.amount} ${f.taxes.currency}`,
          total: `${f.total.amount} ${f.total.currency}`,
        })),
      }));

      console.log(`[RESULT] ${offers.length} offers returned`);
      return JSON.stringify({ offers, total_found: results.length });
    }

    if (name === 'price_offer') {
      const offerId = input['offer_id'] as string;
      const result = await adapter.priceItinerary(offerId, { adults: 1 });

      console.log(
        `[RESULT] available=${result.available}, total=${result.totalPrice.amount} ${result.totalPrice.currency}, priceChanged=${result.priceChanged}`,
      );
      return JSON.stringify({
        available: result.available,
        price: { total: result.totalPrice.amount, currency: result.totalPrice.currency },
        price_changed: result.priceChanged,
        refundable: result.fareRules.refundable,
        changeable: result.fareRules.changeable,
      });
    }

    if (name === 'book_flight') {
      const passengers: PassengerDetail[] = [
        {
          type: 'adult',
          gender: input['passenger_gender'] as 'M' | 'F',
          firstName: input['passenger_first_name'] as string,
          lastName: input['passenger_last_name'] as string,
          dateOfBirth: input['passenger_dob'] as string,
          passportNumber: input['passenger_passport_number'] as string | undefined,
          passportCountry: input['passenger_passport_country'] as string | undefined,
        },
      ];

      const result = await adapter.createBooking({
        offerId: input['offer_id'] as string,
        passengers,
        contact: {
          email: input['passenger_email'] as string,
          phone: input['passenger_phone'] as string,
        },
      });

      console.log(`\n${'='.repeat(60)}`);
      console.log(`BOOKING CREATED: ${result.pnr ?? result.bookingId}`);
      console.log(`Status: ${result.status}`);
      console.log(`Total: ${result.totalPrice.amount} ${result.totalPrice.currency}`);
      console.log('='.repeat(60));

      return JSON.stringify({
        booking_id: result.bookingId,
        pnr: result.pnr ?? null,
        status: result.status,
        total: `${result.totalPrice.amount} ${result.totalPrice.currency}`,
      });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ERROR] ${name}:`, msg);
    return JSON.stringify({ error: msg });
  }
}

async function run() {
  const twoWeeksOut = new Date();
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);
  const departureDate = twoWeeksOut.toISOString().split('T')[0]!;

  const userMessage =
    `Book a flight for me. Here's my situation: ` +
    `I need to fly from London Heathrow (LHR) to New York JFK on ${departureDate}. ` +
    `I'm attending a conference the next morning so I need to arrive with enough time to get to my hotel. ` +
    `Economy is fine - I want the best value option but timing matters. ` +
    `Prefer direct flights if available. ` +
    `Passenger: Jane Smith, born 1990-03-20, female, jane.smith@example.com, +442080160509, ` +
    `passport GB123456789 (GB). ` +
    `Create a booking and tell me what you chose and why.`;

  const systemPrompt =
    `You are an intelligent travel booking agent powered by OTAIP and Amadeus Self-Service APIs. ` +
    `Your job is to search for flights, evaluate ALL available options against the traveler's stated context and constraints, ` +
    `select the best option (not necessarily the cheapest - consider timing, connections, duration, and stated preferences), ` +
    `confirm pricing, complete the booking, and then explain your decision clearly. ` +
    `\n\nYour final response after booking must follow this format:` +
    `\n\nBooking created - PNR: [PNR]` +
    `\nStatus: [held/confirmed]` +
    `\n\nFlight: [carrier + flight number] | [origin] -> [destination] | Departs [time] -> Arrives [time]` +
    `\nPassenger: [name] | Economy | Total: [amount]` +
    `\n\nWhy I chose this: [2-3 sentences explaining your reasoning. Which other options were available, ` +
    `why they were worse, what made this the right call given the traveler's context.]`;

  console.log('='.repeat(60));
  console.log('OTAIP Amadeus Booking Demo - Intelligent Agent');
  console.log('='.repeat(60));
  console.log(`\nTraveler request: ${userMessage}\n`);

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  let iteration = 0;
  const MAX_ITERATIONS = 10;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`\n--- Agent step ${iteration} ---`);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    console.log(`stop_reason: ${response.stop_reason}`);

    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        console.log(`\n[AGENT]\n${block.text}`);
      }
    }

    if (response.stop_reason === 'end_turn') {
      console.log('\nDemo complete.');
      break;
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const result = await executeTool(block.name, block.input as Record<string, unknown>);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    console.error('Hit max iterations.');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
