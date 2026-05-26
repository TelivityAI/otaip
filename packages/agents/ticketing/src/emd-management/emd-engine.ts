/**
 * EMD Engine — EMD-A and EMD-S issuance logic.
 */

import Decimal from 'decimal.js';
import type {
  EmdManagementInput,
  EmdManagementOutput,
  EmdRecord,
  EmdCoupon,
  CouponStatus,
} from './types.js';
// JSON imported directly so esbuild inlines it into dist/index.js — using
// createRequire on the bundled output would fail with MODULE_NOT_FOUND when
// this package is consumed as a built dep.
import prefixJson from '../ticket-issuance/data/airline-ticket-prefixes.json';

const prefixData = prefixJson as unknown as { prefixes: Record<string, string> };

function generateEmdSerial(recordLocator: string, salt: string): string {
  let hash = 0;
  const seed = `EMD-${recordLocator}-${salt}`;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString().padStart(10, '0').slice(0, 10);
}

function resolvePrefix(input: EmdManagementInput): string {
  if (input.emd_number_prefix) return input.emd_number_prefix;
  const mapped = prefixData.prefixes[input.issuing_carrier];
  if (mapped) return mapped;
  return '999';
}

export function issueEmd(input: EmdManagementInput): EmdManagementOutput {
  const prefix = resolvePrefix(input);
  const issueDate = input.issue_date ?? new Date().toISOString().slice(0, 10);
  const serial = generateEmdSerial(input.record_locator, input.passenger_name);
  const emdNumber = `${prefix}${serial}`;

  let totalAmount = new Decimal(0);
  const coupons: EmdCoupon[] = input.services.map((svc, idx) => {
    totalAmount = totalAmount.plus(new Decimal(svc.amount));
    return {
      coupon_number: idx + 1,
      rfic: svc.rfic,
      rfisc: svc.rfisc,
      description: svc.description,
      amount: svc.amount,
      currency: svc.currency,
      status: 'O' as CouponStatus,
      associated_ticket_number: svc.associated_ticket_number,
      associated_coupon_number: svc.associated_coupon_number,
    };
  });

  const currency = input.services[0]!.currency;

  const emd: EmdRecord = {
    emd_number: emdNumber,
    emd_type: input.emd_type,
    record_locator: input.record_locator,
    issuing_carrier: input.issuing_carrier,
    issue_date: issueDate,
    passenger_name: input.passenger_name,
    coupons,
    total_amount: totalAmount.toFixed(2),
    currency,
    related_ticket_number: input.related_ticket_number,
  };

  return {
    emd,
    coupon_count: coupons.length,
  };
}
