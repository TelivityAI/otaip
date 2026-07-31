/**
 * Generates MCP tool definitions from a ConnectAdapter.
 * Each tool maps to an adapter method with a JSON Schema input schema.
 */

import type { ConnectAdapter, WhiteLabelConfig } from '../../types.js';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const passengerCountSchema = {
  type: 'object',
  properties: {
    adults: { type: 'number', description: 'Number of adult passengers (required)' },
    children: { type: 'number', description: 'Number of child passengers' },
    childAges: {
      type: 'array',
      items: { type: 'number' },
      description: 'Ages of child passengers',
    },
    infants: { type: 'number', description: 'Number of infant passengers' },
  },
  required: ['adults'],
} as const;

const contactInfoSchema = {
  type: 'object',
  properties: {
    email: { type: 'string', description: 'Contact email address' },
    phone: { type: 'string', description: 'Contact phone number' },
    alternatePhone: { type: 'string', description: 'Alternate phone number' },
  },
  required: ['email', 'phone'],
} as const;

const passengerDetailSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['adult', 'child', 'infant'], description: 'Passenger type' },
    gender: { type: 'string', enum: ['M', 'F'], description: 'Passenger gender' },
    title: { type: 'string', description: 'Title (Mr, Mrs, Ms, etc.)' },
    firstName: { type: 'string', description: 'First name' },
    middleName: { type: 'string', description: 'Middle name' },
    lastName: { type: 'string', description: 'Last name' },
    dateOfBirth: { type: 'string', description: 'Date of birth (YYYY-MM-DD)' },
    passportNumber: { type: 'string', description: 'Passport number' },
    passportExpiry: { type: 'string', description: 'Passport expiry date (YYYY-MM-DD)' },
    passportCountry: {
      type: 'string',
      description: 'Passport issuing country (ISO 3166-1 alpha-2)',
    },
    nationality: { type: 'string', description: 'Nationality (ISO 3166-1 alpha-2)' },
  },
  required: ['type', 'gender', 'firstName', 'lastName', 'dateOfBirth'],
} as const;

export interface GenerateMcpToolsOptions {
  /** When true, mutation tools require approvalToken in the schema. */
  readonly liveMode?: boolean;
}

export function generateMcpTools(
  adapter: ConnectAdapter,
  whiteLabel?: WhiteLabelConfig,
  options?: GenerateMcpToolsOptions,
): McpToolDefinition[] {
  const brand = whiteLabel?.brandName;
  const brandPrefix = brand ? `${brand}: ` : '';
  const liveMode = options?.liveMode ?? false;

  const tools: McpToolDefinition[] = [
    {
      name: 'search_flights',
      description: `${brandPrefix}Search for available flights by origin, destination, date, and passengers.`,
      inputSchema: {
        type: 'object',
        properties: {
          origin: { type: 'string', description: 'Departure airport IATA code (e.g. JFK)' },
          destination: { type: 'string', description: 'Arrival airport IATA code (e.g. LHR)' },
          departureDate: { type: 'string', description: 'Departure date (YYYY-MM-DD)' },
          returnDate: { type: 'string', description: 'Return date for round-trip (YYYY-MM-DD)' },
          passengers: { ...passengerCountSchema, description: 'Passenger counts by type' },
          cabinClass: {
            type: 'string',
            enum: ['economy', 'premium_economy', 'business', 'first'],
            description: 'Preferred cabin class',
          },
          directOnly: { type: 'boolean', description: 'Only return direct/non-stop flights' },
          preferredAirlines: {
            type: 'array',
            items: { type: 'string' },
            description: 'Preferred airline IATA codes',
          },
          currency: { type: 'string', description: 'Preferred currency (ISO 4217, e.g. USD)' },
        },
        required: ['origin', 'destination', 'departureDate', 'passengers'],
      },
    },
    {
      name: 'price_itinerary',
      description: `${brandPrefix}Get a confirmed price for a selected flight offer.`,
      inputSchema: {
        type: 'object',
        properties: {
          offerId: { type: 'string', description: 'The flight offer ID from search results' },
          passengers: { ...passengerCountSchema, description: 'Passenger counts for pricing' },
        },
        required: ['offerId', 'passengers'],
      },
    },
    {
      name: 'create_booking',
      description: `${brandPrefix}Create a flight booking with passenger details and contact information. Payment is held, not charged immediately.${liveMode ? ' Requires bound approvalToken in live mode.' : ''}`,
      inputSchema: {
        type: 'object',
        properties: {
          offerId: { type: 'string', description: 'The flight offer ID to book' },
          passengers: {
            type: 'array',
            items: passengerDetailSchema,
            description: 'Passenger details for all travelers',
          },
          contact: { ...contactInfoSchema, description: 'Primary contact information' },
          ...(liveMode
            ? {
                approvalToken: {
                  type: 'string',
                  description: 'Bound single-use approval token (issueBoundApprovalToken)',
                },
                idempotencyKey: {
                  type: 'string',
                  description: 'Idempotency key for money-path book',
                },
              }
            : {}),
        },
        required: liveMode
          ? ['offerId', 'passengers', 'contact', 'approvalToken', 'idempotencyKey']
          : ['offerId', 'passengers', 'contact'],
      },
    },
    {
      name: 'get_booking',
      description: `${brandPrefix}Retrieve the current status and details of an existing booking.`,
      inputSchema: {
        type: 'object',
        properties: {
          bookingId: { type: 'string', description: 'The booking reference ID' },
        },
        required: ['bookingId'],
      },
    },
    {
      name: 'health_check',
      description: `${brandPrefix}Check the health and availability of the flight booking service.`,
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];

  if (adapter.requestTicketing) {
    tools.splice(4, 0, {
      name: 'request_ticketing',
      description: `${brandPrefix}Request ticket issuance for a confirmed booking.${liveMode ? ' Requires bound approvalToken in live mode.' : ''}`,
      inputSchema: {
        type: 'object',
        properties: {
          bookingId: { type: 'string', description: 'The booking reference ID to ticket' },
          ...(liveMode
            ? {
                approvalToken: {
                  type: 'string',
                  description: 'Bound single-use approval token (issueBoundApprovalToken)',
                },
              }
            : {}),
        },
        required: liveMode ? ['bookingId', 'approvalToken'] : ['bookingId'],
      },
    });
  }

  if (adapter.cancelBooking) {
    tools.splice(adapter.requestTicketing ? 5 : 4, 0, {
      name: 'cancel_booking',
      description: `${brandPrefix}Cancel an existing booking.${liveMode ? ' Requires bound approvalToken in live mode.' : ''}`,
      inputSchema: {
        type: 'object',
        properties: {
          bookingId: { type: 'string', description: 'The booking reference ID to cancel' },
          ...(liveMode
            ? {
                approvalToken: {
                  type: 'string',
                  description: 'Bound single-use approval token (issueBoundApprovalToken)',
                },
              }
            : {}),
        },
        required: liveMode ? ['bookingId', 'approvalToken'] : ['bookingId'],
      },
    });
  }

  return tools;
}
