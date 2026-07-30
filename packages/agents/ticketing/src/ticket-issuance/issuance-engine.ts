/**
 * Ticket Issuance Engine — ETR generation and conjunction ticketing.
 *
 * Live mode (OTAIP_MODE=live / NODE_ENV=production) refuses synthetic
 * hash-derived serials. Callers must supply supplier ticket numbers via
 * `supplier_ticket_numbers` (from adapter documents / ticketing response).
 */

import Decimal from 'decimal.js';
import { isLiveModeFromEnv, LiveSafetyError } from '@otaip/core';
import type {
  TicketIssuanceInput,
  TicketIssuanceOutput,
  TicketRecord,
  TicketSegment,
  CouponStatus,
} from './types.js';
// JSON imported directly so esbuild inlines it into dist/index.js — using
// createRequire on the bundled output would fail with MODULE_NOT_FOUND when
// this package is consumed as a built dep.
import prefixJson from './data/airline-ticket-prefixes.json';

const prefixData = prefixJson as unknown as { prefixes: Record<string, string> };

const MAX_COUPONS_PER_TICKET = 4;

export interface IssueTicketsOptions {
  /** Force live-mode guard (defaults to env). */
  readonly liveMode?: boolean;
}

/** Generate a deterministic 10-digit ticket serial from record locator + index */
function generateTicketSerial(recordLocator: string, index: number): string {
  // Demo/test only. Live mode must use supplier-allocated numbers.
  let hash = 0;
  const seed = `${recordLocator}-${index}`;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const serial = Math.abs(hash).toString().padStart(10, '0').slice(0, 10);
  return serial;
}

function resolvePrefix(input: TicketIssuanceInput): string {
  if (input.ticket_number_prefix) return input.ticket_number_prefix;
  const mapped = prefixData.prefixes[input.issuing_carrier];
  if (mapped) return mapped;
  // TODO: [NEEDS DOMAIN INPUT] Complete airline prefix table
  return '999';
}

function buildCoupons(
  input: TicketIssuanceInput,
  startIdx: number,
  count: number,
): TicketSegment[] {
  const coupons: TicketSegment[] = [];
  for (let i = 0; i < count; i++) {
    const seg = input.segments[startIdx + i]!;
    coupons.push({
      coupon_number: i + 1,
      carrier: seg.carrier,
      flight_number: seg.flight_number,
      origin: seg.origin,
      destination: seg.destination,
      departure_date: seg.departure_date,
      departure_time: seg.departure_time,
      booking_class: seg.booking_class,
      fare_basis: seg.fare_basis,
      not_valid_before: seg.not_valid_before,
      not_valid_after: seg.not_valid_after,
      baggage_allowance: seg.baggage_allowance,
      status: 'O' as CouponStatus,
    });
  }
  return coupons;
}

function computeTotalTax(input: TicketIssuanceInput): string {
  let total = new Decimal(0);
  for (const tax of input.taxes) {
    total = total.plus(new Decimal(tax.amount));
  }
  return total.toFixed(2);
}

function computeTotal(baseFare: string, totalTax: string): string {
  return new Decimal(baseFare).plus(new Decimal(totalTax)).toFixed(2);
}

export function issueTickets(
  input: TicketIssuanceInput,
  options?: IssueTicketsOptions,
): TicketIssuanceOutput {
  const liveMode = options?.liveMode ?? isLiveModeFromEnv();
  const supplierNumbers = input.supplier_ticket_numbers ?? [];

  if (liveMode && supplierNumbers.length === 0) {
    throw new LiveSafetyError(
      'Live mode refuses synthetic ticket serials. Provide supplier_ticket_numbers from the adapter ticketing/documents response.',
    );
  }

  const prefix = resolvePrefix(input);
  const issueDate = input.issue_date ?? new Date().toISOString().slice(0, 10);
  const totalTax = computeTotalTax(input);
  const baseFare = input.equivalent_fare ?? input.base_fare;
  const totalAmount = computeTotal(baseFare, totalTax);

  const segmentCount = input.segments.length;
  const ticketCount = Math.ceil(segmentCount / MAX_COUPONS_PER_TICKET);
  if (liveMode && supplierNumbers.length < ticketCount) {
    throw new LiveSafetyError(
      `Live mode requires ${ticketCount} supplier_ticket_numbers; received ${supplierNumbers.length}.`,
    );
  }
  const isConjunction = ticketCount > 1;

  const tickets: TicketRecord[] = [];

  for (let t = 0; t < ticketCount; t++) {
    const startIdx = t * MAX_COUPONS_PER_TICKET;
    const count = Math.min(MAX_COUPONS_PER_TICKET, segmentCount - startIdx);
    const supplierNumber = supplierNumbers[t];
    const ticketNumber =
      supplierNumber ?? `${prefix}${generateTicketSerial(input.record_locator, t)}`;
    const conjunctionSuffix = isConjunction ? `/${t + 1}` : undefined;

    const coupons = buildCoupons(input, startIdx, count);

    const ticket: TicketRecord = {
      ticket_number: ticketNumber,
      conjunction_suffix: conjunctionSuffix,
      record_locator: input.record_locator,
      issuing_carrier: input.issuing_carrier,
      issue_date: issueDate,
      passenger_name: input.passenger_name,
      coupons,
      base_fare: input.base_fare,
      base_fare_currency: input.base_fare_currency,
      equivalent_fare: input.equivalent_fare,
      equivalent_fare_currency: input.equivalent_fare_currency,
      total_tax: totalTax,
      taxes: input.taxes,
      total_amount: totalAmount,
      fare_calculation: input.fare_calculation,
      form_of_payment: input.form_of_payment,
      endorsements: input.endorsements,
      commission: input.commission,
      bsp_reporting: input.bsp_reporting,
      original_issue: input.original_issue,
    };

    tickets.push(ticket);
  }

  return {
    tickets,
    total_coupons: segmentCount,
    is_conjunction: isConjunction,
  };
}
