/**
 * TripProAdapter — ConnectAdapter implementation for TripPro/Mondee.
 *
 * Two hosts: search = mas.trippro.com, booking = map.trippro.com
 * Two auth patterns: search = SearchAccessToken + M-IPAddress, booking = AccessToken
 * SOAP for: Read PNR, Order Ticket, Cancel PNR, Read E-Ticket
 */

import type {
  ConnectAdapter,
  SearchFlightsInput,
  FlightOffer,
  PassengerCount,
  PricedItinerary,
  CreateBookingInput,
  BookingResult,
  BookingStatusResult,
} from '../../types.js';
import { BaseAdapter, ConnectError } from '../../base-adapter.js';
import type { TripProConfig } from './config.js';
import { validateTripProConfig } from './config.js';
import type {
  TripProSearchResponse,
  TripProRepriceResponse,
  TripProBookResponse,
} from './types.js';
import {
  mapSearchRequest,
  mapSearchResponse,
  mapRepriceRequest,
  mapRepriceResponse,
  mapBookRequest,
  mapBookResponse,
} from './mapper.js';
import {
  soapRequest,
  buildReadPnrBody,
  buildOrderTicketBody,
  buildCancelPnrBody,
  hasSoapFault,
  extractSoapFaultMessage,
  extractXmlValue,
  extractXmlValues,
} from './soap-client.js';

export class TripProAdapter extends BaseAdapter implements ConnectAdapter {
  readonly supplierId = 'trippro';
  readonly supplierName = 'TripPro/Mondee';
  private readonly config: TripProConfig;

  constructor(config: unknown) {
    super();
    this.config = validateTripProConfig(config);
  }

  async searchFlights(input: SearchFlightsInput): Promise<FlightOffer[]> {
    return this.withRetry('searchFlights', async () => {
      const body = mapSearchRequest(input, this.config);

      const response = await this.fetchWithTimeout(this.config.searchUrl, {
        method: 'POST',
        headers: this.searchHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new ConnectError(
          `Search failed: ${response.status} ${response.statusText}`,
          this.supplierId,
          'searchFlights',
          response.status >= 500,
        );
      }

      const data = (await response.json()) as TripProSearchResponse;
      return mapSearchResponse(data.Results ?? []);
    });
  }

  async priceItinerary(offerId: string, passengers: PassengerCount): Promise<PricedItinerary> {
    return this.withRetry('priceItinerary', async () => {
      const body = mapRepriceRequest(offerId, passengers);

      const response = await this.fetchWithTimeout(this.config.repriceUrl, {
        method: 'POST',
        headers: this.bookingHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new ConnectError(
          `Reprice failed: ${response.status} ${response.statusText}`,
          this.supplierId,
          'priceItinerary',
          response.status >= 500,
        );
      }

      const data = (await response.json()) as TripProRepriceResponse;
      return mapRepriceResponse(data.Results ?? [], offerId);
    });
  }

  async createBooking(input: CreateBookingInput): Promise<BookingResult> {
    return this.withRetry('createBooking', async () => {
      const body = mapBookRequest(input);

      const response = await this.fetchWithTimeout(this.config.bookUrl, {
        method: 'POST',
        headers: this.bookingHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new ConnectError(
          `Booking failed: ${response.status} ${response.statusText}`,
          this.supplierId,
          'createBooking',
          response.status >= 500,
        );
      }

      const data = (await response.json()) as TripProBookResponse;

      if (!data.errorsList.empty && data.errorsList.tperror?.length) {
        const errorText = data.errorsList.tperror.map((e) => e.errorText).join('; ');
        throw new ConnectError(
          `Booking error: ${errorText}`,
          this.supplierId,
          'createBooking',
          false,
        );
      }

      return mapBookResponse(data);
    });
  }

  async getBookingStatus(bookingId: string): Promise<BookingStatusResult> {
    return this.withRetry('getBookingStatus', async () => {
      const xml = await soapRequest(
        this.config.soapBaseUrl,
        'ReadPNR',
        buildReadPnrBody(bookingId),
        this.config.accessToken,
      );

      if (hasSoapFault(xml)) {
        const fault = extractSoapFaultMessage(xml) ?? 'Unknown SOAP fault';
        throw new ConnectError(fault, this.supplierId, 'getBookingStatus', false);
      }

      const pnr = extractXmlValue(xml, 'PNR') ?? bookingId;
      const airlinePnr = extractXmlValue(xml, 'AirlinePNR') ?? undefined;
      const status = extractXmlValue(xml, 'Status') ?? 'held';
      const ticketNumbers = extractXmlValues(xml, 'TicketNumber');

      return {
        bookingId,
        supplier: 'trippro',
        status: this.mapBookingStatus(status),
        pnr,
        airlinePnr,
        ticketNumbers: ticketNumbers.length ? ticketNumbers : undefined,
        segments: [],
        passengers: [],
        totalPrice: { amount: '0', currency: 'USD' },
        raw: xml,
      };
    });
  }

  async requestTicketing(bookingId: string): Promise<BookingStatusResult> {
    return this.withRetry('requestTicketing', async () => {
      const xml = await soapRequest(
        this.config.soapBaseUrl,
        'OrderTicket',
        buildOrderTicketBody(bookingId),
        this.config.accessToken,
        { unsafe: true },
      );

      if (hasSoapFault(xml)) {
        const fault = extractSoapFaultMessage(xml) ?? 'Unknown SOAP fault';
        throw new ConnectError(fault, this.supplierId, 'requestTicketing', false);
      }

      const ticketNumbers = extractXmlValues(xml, 'TicketNumber');

      return {
        bookingId,
        supplier: 'trippro',
        status: ticketNumbers.length ? 'ticketed' : 'confirmed',
        pnr: bookingId,
        ticketNumbers: ticketNumbers.length ? ticketNumbers : undefined,
        segments: [],
        passengers: [],
        totalPrice: { amount: '0', currency: 'USD' },
        raw: xml,
      };
    });
  }

  async cancelBooking(bookingId: string): Promise<{ success: boolean; message: string }> {
    return this.withRetry('cancelBooking', async () => {
      const xml = await soapRequest(
        this.config.soapBaseUrl,
        'CancelPNR',
        buildCancelPnrBody(bookingId),
        this.config.accessToken,
        { unsafe: true },
      );

      if (hasSoapFault(xml)) {
        const fault = extractSoapFaultMessage(xml) ?? 'Unknown SOAP fault';
        // Business SOAP fault — definitive, not ambiguous transport failure.
        return { success: false, message: fault };
      }

      return { success: true, message: `PNR ${bookingId} cancelled` };
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const response = await this.fetchWithTimeout(
        this.config.searchUrl,
        { method: 'HEAD', headers: this.searchHeaders() },
        5_000,
      );
      return {
        healthy: response.ok || response.status === 405,
        latencyMs: Date.now() - start,
      };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private searchHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      SearchAccessToken: this.config.searchAccessToken,
      'M-IPAddress': this.config.whitelistedIp,
    };
  }

  private bookingHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      AccessToken: this.config.accessToken,
    };
  }

  private mapBookingStatus(tripProStatus: string): BookingStatusResult['status'] {
    const normalized = tripProStatus.toLowerCase();
    if (normalized.includes('ticket')) return 'ticketed';
    if (normalized.includes('cancel')) return 'cancelled';
    if (normalized.includes('confirm')) return 'confirmed';
    if (normalized.includes('fail')) return 'failed';
    return 'held';
  }
}
