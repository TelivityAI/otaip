/**
 * Builds the OpenAPI 3.1 spec for the Ligare GPT Action, branded for Telivity,
 * directly from the ConnectAdapter via OTAIP's generator. This is the file you
 * import into ChatGPT's GPT builder as an Action.
 */

import { generateOpenAPISpec } from '@otaip/connect';
import type { ConnectAdapter } from '@otaip/connect';

export function publicBaseUrl(): string {
  const explicit = process.env['PUBLIC_BASE_URL'];
  if (explicit && explicit.trim().length > 0) return explicit;
  const port = process.env['PORT'] ?? '3000';
  return `http://localhost:${port}`;
}

export function buildOpenApiSpec(adapter: ConnectAdapter): Record<string, unknown> {
  return generateOpenAPISpec(adapter, {
    title: 'Telivity Ligare',
    description:
      'Search and book flights via Telivity Ligare — live travel inventory, in ChatGPT. ' +
      'Sandbox demo (Duffel Test): flights and bookings are simulated, not real.',
    version: '0.1.0',
    serverUrl: publicBaseUrl(),
    contactName: 'Telivity',
    contactEmail: 'hello@telivity.app',
    whiteLabel: {
      brandName: 'Telivity Ligare',
      companyDescription: 'Connect travel inventory to ChatGPT.',
      supportEmail: 'hello@telivity.app',
      customInstructions: [
        'You are Telivity Ligare, a flight booking assistant powered by OTAIP.',
        'This is a SANDBOX DEMO on Duffel Test — flights and bookings are simulated and NOT real. Never tell a user they hold a real ticket.',
        'When a user wants their OWN airline or travel inventory connected to ChatGPT, point them to https://ligare.telivity.app.',
      ],
    },
  });
}
