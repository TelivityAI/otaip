/**
 * Void Engine — coupon status check, void window, BSP/ARC cut-off.
 */

import type { VoidAgentInput, VoidAgentOutput, CarrierVoidWindow, CouponStatus } from './types.js';
// JSON imported directly so esbuild inlines it into dist/index.js — using
// createRequire on the bundled output would fail with MODULE_NOT_FOUND when
// this package is consumed as a built dep.
import voidWindowsJson from './data/carrier-void-windows.json';

const windowData = voidWindowsJson as unknown as { carriers: CarrierVoidWindow[] };

const carrierWindows = new Map<string, CarrierVoidWindow>();
for (const c of windowData.carriers) {
  carrierWindows.set(c.carrier_code, c);
}

function currentTime(input: VoidAgentInput): Date {
  return input.current_datetime ? new Date(input.current_datetime) : new Date();
}

/** Default BSP cut-off: 23:59 local time on day of issuance */
const DEFAULT_BSP_CUTOFF = '23:59';

/** ARC weekly cycle: Monday 00:00 UTC (simplified) */
function isArcCutoffPassed(issueDate: Date, now: Date): boolean {
  // ARC settles weekly. Simplified: void allowed within 24h of issue.
  const hoursSinceIssue = (now.getTime() - issueDate.getTime()) / (1000 * 60 * 60);
  return hoursSinceIssue > 24;
}

export function processVoid(input: VoidAgentInput): VoidAgentOutput {
  const now = currentTime(input);

  // Step 1: Check coupon statuses — ALL must be Open
  const nonOpenCoupons = input.coupons.filter((c) => c.status !== 'O');
  if (nonOpenCoupons.length > 0) {
    const details = nonOpenCoupons.map((c) => `coupon ${c.coupon_number}: ${c.status}`).join(', ');
    return {
      result: {
        permitted: false,
        document_number: input.document_number,
        rejection_reason: 'COUPON_NOT_OPEN',
        message: `Cannot void — coupon(s) not in Open status: ${details}. Only unused (O) coupons can be voided.`,
      },
    };
  }

  // Step 2: Look up carrier void window
  const carrierConfig = carrierWindows.get(input.issuing_carrier);
  if (!carrierConfig) {
    return {
      result: {
        permitted: false,
        document_number: input.document_number,
        rejection_reason: 'UNKNOWN_CARRIER',
        message: `Cannot determine void window for carrier ${input.issuing_carrier}. Manual review required.`,
      },
    };
  }

  // Step 3: Carrier with no void window
  if (carrierConfig.void_window_hours === 0) {
    return {
      result: {
        permitted: false,
        document_number: input.document_number,
        rejection_reason: 'NO_VOID_ALLOWED',
        message: `${input.issuing_carrier} does not permit void. ${carrierConfig.notes}`,
        void_window_hours: 0,
      },
    };
  }

  // Step 4: Check void window
  const issueTime = new Date(input.issue_datetime);
  const hoursSinceIssue = (now.getTime() - issueTime.getTime()) / (1000 * 60 * 60);
  const hoursRemaining = carrierConfig.void_window_hours - hoursSinceIssue;

  if (hoursRemaining < 0) {
    return {
      result: {
        permitted: false,
        document_number: input.document_number,
        rejection_reason: 'VOID_WINDOW_EXPIRED',
        message: `Void window expired. ${input.issuing_carrier} allows void within ${carrierConfig.void_window_hours}h of issuance. Issued ${hoursSinceIssue.toFixed(1)}h ago.`,
        void_window_hours: carrierConfig.void_window_hours,
        hours_remaining: Number(hoursRemaining.toFixed(1)),
      },
    };
  }

  // Step 5: BSP/ARC cut-off check
  if (input.settlement_system === 'BSP') {
    const cutoff = input.bsp_cutoff_time ?? DEFAULT_BSP_CUTOFF;
    const [cutoffHour, cutoffMin] = cutoff.split(':').map(Number) as [number, number];
    const cutoffDate = new Date(issueTime);
    cutoffDate.setHours(cutoffHour, cutoffMin, 0, 0);
    // If issue and void are on the same day, check against cutoff
    if (now > cutoffDate && now.toDateString() === issueTime.toDateString()) {
      // Still within void window hours but past BSP cutoff — check next day
      // BSP transmits daily, so if past today's cutoff, void must happen before next cutoff
    }
    // If past next business day cutoff, BSP has transmitted
    const nextDayCutoff = new Date(cutoffDate);
    nextDayCutoff.setDate(nextDayCutoff.getDate() + 1);
    if (now > nextDayCutoff) {
      return {
        result: {
          permitted: false,
          document_number: input.document_number,
          rejection_reason: 'BSP_CUTOFF_PASSED',
          message: `BSP daily cut-off has passed. Ticket transmitted to BSP for settlement. Refund process required instead.`,
          void_window_hours: carrierConfig.void_window_hours,
          hours_remaining: Number(hoursRemaining.toFixed(1)),
        },
      };
    }
  }

  if (input.settlement_system === 'ARC') {
    if (isArcCutoffPassed(issueTime, now)) {
      return {
        result: {
          permitted: false,
          document_number: input.document_number,
          rejection_reason: 'ARC_CUTOFF_PASSED',
          message: `ARC settlement cycle cut-off has passed. Void no longer possible — process as refund.`,
          void_window_hours: carrierConfig.void_window_hours,
          hours_remaining: Number(hoursRemaining.toFixed(1)),
        },
      };
    }
  }

  // Step 6: Void permitted — set all coupons to V
  const updatedCoupons = input.coupons.map((c) => ({
    coupon_number: c.coupon_number,
    status: 'V' as CouponStatus,
  }));

  return {
    result: {
      permitted: true,
      document_number: input.document_number,
      message: `Void permitted. ${hoursRemaining.toFixed(1)}h remaining in void window.`,
      void_window_hours: carrierConfig.void_window_hours,
      hours_remaining: Number(hoursRemaining.toFixed(1)),
      updated_coupons: updatedCoupons,
    },
  };
}
