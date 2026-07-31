/**
 * Thin SOAP wrapper for TripPro PNR/ticketing endpoints.
 * Uses raw XML templates — no SOAP client library.
 *
 * Unsafe money-path SOAP actions (OrderTicket, CancelPNR) use fetchOnce.
 * Safe reads (ReadPNR, ReadETicket) keep fetchWithRetry.
 */

import { fetchOnce, fetchWithRetry } from '@otaip/core';

const UNSAFE_SOAP_ACTIONS = new Set(['OrderTicket', 'CancelPNR']);

export async function soapRequest(
  wsdlUrl: string,
  action: string,
  body: string,
  token: string,
  options?: { unsafe?: boolean },
): Promise<string> {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <AccessToken>${escapeXml(token)}</AccessToken>
  </soap:Header>
  <soap:Body>
    ${body}
  </soap:Body>
</soap:Envelope>`;

  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: action,
    },
    body: envelope,
  };

  const unsafe = options?.unsafe ?? UNSAFE_SOAP_ACTIONS.has(action);
  const response = unsafe
    ? await fetchOnce(wsdlUrl, init)
    : await fetchWithRetry(wsdlUrl, init);

  if (!response.ok) {
    throw new Error(`SOAP request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

// ============================================================
// XML BODY BUILDERS
// ============================================================

export function buildReadPnrBody(pnr: string): string {
  return `<ReadPNR xmlns="http://trippro.com/webservices">
  <PNR>${escapeXml(pnr)}</PNR>
</ReadPNR>`;
}

export function buildOrderTicketBody(pnr: string): string {
  return `<OrderTicket xmlns="http://trippro.com/webservices">
  <PNR>${escapeXml(pnr)}</PNR>
</OrderTicket>`;
}

export function buildCancelPnrBody(pnr: string): string {
  return `<CancelPNR xmlns="http://trippro.com/webservices">
  <PNR>${escapeXml(pnr)}</PNR>
</CancelPNR>`;
}

export function buildReadETicketBody(ticketNumber: string): string {
  return `<ReadETicket xmlns="http://trippro.com/webservices">
  <TicketNumber>${escapeXml(ticketNumber)}</TicketNumber>
</ReadETicket>`;
}

// ============================================================
// XML RESPONSE HELPERS
// ============================================================

/** Extract text content of a named XML element. */
export function extractXmlValue(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? (match[1] ?? null) : null;
}

/** Extract all text values of a named XML element. */
export function extractXmlValues(xml: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, 'gi');
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    values.push(match[1] ?? '');
  }
  return values;
}

/** Check if the SOAP response contains a fault. */
export function hasSoapFault(xml: string): boolean {
  return xml.includes('<soap:Fault>') || xml.includes('<Fault>');
}

/** Extract SOAP fault message. */
export function extractSoapFaultMessage(xml: string): string | null {
  return (
    extractXmlValue(xml, 'faultstring') ??
    extractXmlValue(xml, 'FaultString') ??
    extractXmlValue(xml, 'Message')
  );
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
