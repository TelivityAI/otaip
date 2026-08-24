/**
 * BSP Reconciliation Matcher
 *
 * Matches agency records against HOT file records with multi-currency gates
 * and exchange / conjunction / ADM-ACM cross-references (DISH Rev 23).
 *
 * Domain: docs/knowledge-base/bsp-hot-reconciliation.md
 * IROE ≠ ICER — never convert amounts for matching without an explicit rate source.
 */

import Decimal from 'decimal.js';
import type {
  AgencyRecord,
  HOTFileRecord,
  BSPReconciliationInput,
  BSPReconciliationOutput,
  Discrepancy,
  DiscrepancySeverity,
  ReconciliationSummary,
  PatternDetection,
  HOTTransactionType,
} from './types.js';

const DEFAULT_THRESHOLD = '10.00';

function severity(type: string, amount: Decimal): DiscrepancySeverity {
  if (
    type === 'MISSING_IN_HOT' ||
    type === 'MISSING_IN_AGENCY' ||
    type === 'CONJUNCTION_SET_MISMATCH'
  ) {
    return 'critical';
  }
  if (type === 'UNMATCHED_ADM' || type === 'UNMATCHED_EXCHANGE') return 'high';
  if (amount.abs().greaterThan(100)) return 'high';
  if (amount.abs().greaterThan(50)) return 'medium';
  return 'low';
}

function relatedTicketsFromHot(hot: HOTFileRecord): string[] {
  const out: string[] = [];
  if (hot.original_ticket_number) out.push(hot.original_ticket_number);
  if (hot.conjunction_primary) out.push(hot.conjunction_primary);
  if (hot.conjunction_ticket_numbers) out.push(...hot.conjunction_ticket_numbers);
  if (hot.related_documents) {
    for (const r of hot.related_documents) out.push(r.ticket_number);
  }
  return out;
}

function agencyCrossRefs(ar: AgencyRecord): string[] {
  const out: string[] = [];
  if (ar.original_ticket_number) out.push(ar.original_ticket_number);
  if (ar.related_ticket_number) out.push(ar.related_ticket_number);
  if (ar.conjunction_ticket_numbers) out.push(...ar.conjunction_ticket_numbers);
  return out;
}

/**
 * Find a HOT row that matches an agency row beyond simple ticket equality:
 * same ticket+type, or exchange via ORIT, or ADM/ACM/RFND via RTDN, or conjunction set.
 */
function findMatchingHot(
  ar: AgencyRecord,
  hotRecsForTicket: HOTFileRecord[] | undefined,
  allHot: HOTFileRecord[],
): HOTFileRecord | undefined {
  if (hotRecsForTicket) {
    const direct = hotRecsForTicket.find((h) => h.transaction_type === ar.transaction_type);
    if (direct) return direct;
  }

  // Exchange: agency new ticket ↔ HOT issue with ORIT = original
  if (ar.transaction_type === 'EXCHANGE') {
    const byNew = allHot.find(
      (h) =>
        h.ticket_number === ar.ticket_number &&
        (h.transaction_type === 'EXCHANGE' ||
          (h.transaction_type === 'SALE' && h.original_ticket_number !== undefined)),
    );
    if (byNew) return byNew;

    if (ar.original_ticket_number) {
      const byOrit = allHot.find(
        (h) =>
          h.original_ticket_number === ar.original_ticket_number &&
          (h.transaction_type === 'EXCHANGE' || h.payment_type?.toUpperCase() === 'EX'),
      );
      if (byOrit) return byOrit;
    }
  }

  // Agency still holding original while HOT shows exchange of that original
  if (ar.transaction_type === 'SALE') {
    const exch = allHot.find(
      (h) =>
        h.original_ticket_number === ar.ticket_number &&
        (h.transaction_type === 'EXCHANGE' || h.payment_type?.toUpperCase() === 'EX'),
    );
    // Do not treat original as matched to the exchange row for amount compare —
    // caller uses this only when direct miss; return undefined so original can
    // be reconciled separately unless agency marks EXCHANGE.
    void exch;
  }

  // Refund / ADM / ACM: HOT TDNR may be memo id; RTDN holds ticket
  if (ar.transaction_type === 'REFUND' || ar.transaction_type === 'ADM' || ar.transaction_type === 'ACM') {
    const related = ar.related_ticket_number ?? ar.ticket_number;
    const viaRtdn = allHot.find(
      (h) =>
        h.transaction_type === ar.transaction_type &&
        (h.ticket_number === ar.ticket_number ||
          h.related_documents?.some((r) => r.ticket_number === related) ||
          h.related_documents?.some((r) => r.ticket_number === ar.ticket_number)),
    );
    if (viaRtdn) return viaRtdn;
  }

  // Conjunction companion present under another TDNR sharing the set
  if (ar.conjunction_ticket_numbers && ar.conjunction_ticket_numbers.length > 0) {
    const set = new Set([ar.ticket_number, ...ar.conjunction_ticket_numbers]);
    const companion = allHot.find(
      (h) =>
        h.transaction_type === ar.transaction_type &&
        (set.has(h.ticket_number) ||
          h.conjunction_ticket_numbers?.some((t) => set.has(t)) ||
          (h.conjunction_primary !== undefined && set.has(h.conjunction_primary))),
    );
    if (companion && companion.ticket_number === ar.ticket_number) return companion;
    // Prefer the HOT row for this exact ticket within the set
    const exact = allHot.find((h) => h.ticket_number === ar.ticket_number && set.has(h.ticket_number));
    if (exact) return exact;
  }

  return undefined;
}

function conjunctionSetOf(hot: HOTFileRecord): string[] {
  const set = new Set<string>([hot.ticket_number]);
  if (hot.conjunction_primary) set.add(hot.conjunction_primary);
  if (hot.conjunction_ticket_numbers) {
    for (const t of hot.conjunction_ticket_numbers) set.add(t);
  }
  return [...set];
}

function matchRecords(input: BSPReconciliationInput): BSPReconciliationOutput {
  const threshold = new Decimal(input.min_threshold ?? DEFAULT_THRESHOLD);
  const thresholdCurrency = input.threshold_currency ?? 'USD';
  const discrepancies: Discrepancy[] = [];

  const hotByTicket = new Map<string, HOTFileRecord[]>();
  for (const hot of input.hot_records) {
    const existing = hotByTicket.get(hot.ticket_number) ?? [];
    existing.push(hot);
    hotByTicket.set(hot.ticket_number, existing);
  }

  const agencyByTicket = new Map<string, AgencyRecord[]>();
  for (const ar of input.agency_records) {
    const existing = agencyByTicket.get(ar.ticket_number) ?? [];
    existing.push(ar);
    agencyByTicket.set(ar.ticket_number, existing);
  }

  const matchedHotTickets = new Set<string>();
  let matchedCount = 0;

  for (const [ticketNum, agencyRecs] of agencyByTicket) {
    for (const ar of agencyRecs) {
      const matchingHot = findMatchingHot(ar, hotByTicket.get(ticketNum), input.hot_records);

      if (!matchingHot) {
        // If this ticket is only the original of an exchange that exists on HOT,
        // and agency did not book a separate SALE for it in-period, skip critical miss
        // when agency also has an EXCHANGE referencing it.
        const coveredByAgencyExchange = input.agency_records.some(
          (other) =>
            other.transaction_type === 'EXCHANGE' && other.original_ticket_number === ticketNum,
        );
        const hotExchangeOfOriginal = input.hot_records.some(
          (h) => h.original_ticket_number === ticketNum,
        );
        if (coveredByAgencyExchange && hotExchangeOfOriginal && ar.transaction_type === 'SALE') {
          matchedCount++;
          matchedHotTickets.add(ticketNum);
          continue;
        }

        const amount = new Decimal(ar.ticket_amount);
        const type = ar.transaction_type === 'EXCHANGE' ? 'UNMATCHED_EXCHANGE' : 'MISSING_IN_HOT';
        // Even exchanges may have zero amounts (DISH §6.5.6) — still surface unmatched EXCHANGE
        if (type === 'UNMATCHED_EXCHANGE' || amount.abs().greaterThanOrEqualTo(threshold)) {
          discrepancies.push({
            type,
            severity: type === 'UNMATCHED_EXCHANGE' ? 'high' : 'critical',
            ticket_number: ticketNum,
            ...(ar.original_ticket_number
              ? { related_ticket_number: ar.original_ticket_number }
              : ar.related_ticket_number
                ? { related_ticket_number: ar.related_ticket_number }
                : {}),
            airline_code: ar.airline_code,
            agency_amount: ar.ticket_amount,
            currency: ar.currency,
            description:
              type === 'UNMATCHED_EXCHANGE'
                ? `Exchange ticket ${ticketNum}` +
                  (ar.original_ticket_number ? ` (ORIT ${ar.original_ticket_number})` : '') +
                  ` not matched in BSP HOT via TDNR/ORIT cross-ref.`
                : `Ticket ${ticketNum} exists in agency records but not in BSP HOT file.`,
          });
        }
        continue;
      }

      matchedCount++;
      matchedHotTickets.add(matchingHot.ticket_number);
      for (const rel of relatedTicketsFromHot(matchingHot)) matchedHotTickets.add(rel);

      // Conjunction set coverage
      const hotSet = conjunctionSetOf(matchingHot);
      const agencySet = new Set<string>([
        ar.ticket_number,
        ...(ar.conjunction_ticket_numbers ?? []),
      ]);
      if (hotSet.length > 1 || agencySet.size > 1) {
        const missingFromHot = [...agencySet].filter((t) => !hotSet.includes(t));
        const missingFromAgency = hotSet.filter((t) => !agencySet.has(t));
        if (missingFromHot.length > 0 || missingFromAgency.length > 0) {
          discrepancies.push({
            type: 'CONJUNCTION_SET_MISMATCH',
            severity: 'critical',
            ticket_number: ticketNum,
            airline_code: ar.airline_code,
            currency: ar.currency,
            description: `Conjunction set mismatch for ${ticketNum}: agency=[${[...agencySet].join(',')}] hot=[${hotSet.join(',')}]` +
              (missingFromHot.length ? `; missing in HOT: ${missingFromHot.join(',')}` : '') +
              (missingFromAgency.length
                ? `; missing in agency: ${missingFromAgency.join(',')}`
                : ''),
          });
        }
      }

      // Currency gate — transaction CUTP must match; no IROE/ICER conversion
      if (ar.currency !== matchingHot.currency) {
        discrepancies.push({
          type: 'CURRENCY_MISMATCH',
          severity: 'high',
          ticket_number: ticketNum,
          airline_code: ar.airline_code,
          currency: ar.currency,
          description: `Currency mismatch on ${ticketNum}: agency transaction currency ${ar.currency}, HOT CUTP ${matchingHot.currency}` +
            (matchingHot.reporting_currency
              ? ` (HOT reporting/default ${matchingHot.reporting_currency}; IROE≠ICER — do not auto-convert).`
              : ' (do not assume single-currency HOT; IROE≠ICER — do not auto-convert).'),
        });
        continue;
      }

      // Amount mismatch (same CUTP only). Threshold is in transaction-currency units —
      // never FX-convert via IROE/ICER (KB §2).
      const agencyAmt = new Decimal(ar.ticket_amount);
      const hotAmt = new Decimal(matchingHot.ticket_amount);
      const amtDiff = agencyAmt.minus(hotAmt).abs();

      if (amtDiff.greaterThanOrEqualTo(threshold)) {
        discrepancies.push({
          type: 'AMOUNT_MISMATCH',
          severity: severity('AMOUNT_MISMATCH', amtDiff),
          ticket_number: ticketNum,
          airline_code: ar.airline_code,
          agency_amount: ar.ticket_amount,
          bsp_amount: matchingHot.ticket_amount,
          difference: amtDiff.toFixed(2),
          currency: ar.currency,
          description: `Amount mismatch on ${ticketNum}: agency ${ar.ticket_amount}, BSP ${matchingHot.ticket_amount} (diff ${amtDiff.toFixed(2)} ${ar.currency}).`,
        });
      }

      const agencyComm = new Decimal(ar.commission_amount);
      const hotComm = new Decimal(matchingHot.commission_amount);
      const commDiff = agencyComm.minus(hotComm).abs();

      if (commDiff.greaterThanOrEqualTo(threshold)) {
        discrepancies.push({
          type: 'COMMISSION_MISMATCH',
          severity: severity('COMMISSION_MISMATCH', commDiff),
          ticket_number: ticketNum,
          airline_code: ar.airline_code,
          agency_amount: ar.commission_amount,
          bsp_amount: matchingHot.commission_amount,
          difference: commDiff.toFixed(2),
          currency: ar.currency,
          description: `Commission mismatch on ${ticketNum}: agency ${ar.commission_amount}, BSP ${matchingHot.commission_amount} (diff ${commDiff.toFixed(2)} ${ar.currency}).`,
        });
      }
    }
  }

  // HOT rows missing in agency (consider cross-refs)
  for (const [ticketNum, hotRecs] of hotByTicket) {
    for (const hot of hotRecs) {
      if (matchedHotTickets.has(ticketNum)) continue;

      const agencyHit =
        agencyByTicket.has(ticketNum) ||
        input.agency_records.some((ar) => {
          if (agencyCrossRefs(ar).includes(ticketNum)) return true;
          if (
            hot.original_ticket_number &&
            (ar.ticket_number === hot.original_ticket_number ||
              ar.original_ticket_number === hot.original_ticket_number)
          ) {
            return true;
          }
          if (hot.related_documents?.some((r) => r.ticket_number === ar.ticket_number)) {
            return true;
          }
          if (
            ar.conjunction_ticket_numbers?.includes(ticketNum) ||
            hot.conjunction_ticket_numbers?.includes(ar.ticket_number)
          ) {
            return true;
          }
          return false;
        });

      if (agencyHit) {
        matchedHotTickets.add(ticketNum);
        continue;
      }

      const amount = new Decimal(hot.ticket_amount);
      if (amount.abs().lessThan(threshold) && hot.transaction_type !== 'ADM' && hot.transaction_type !== 'ACM') {
        continue;
      }

      if (hot.transaction_type === 'ADM') {
        const related = hot.related_documents?.[0]?.ticket_number;
        discrepancies.push({
          type: 'UNMATCHED_ADM',
          severity: 'high',
          ticket_number: ticketNum,
          ...(related ? { related_ticket_number: related } : {}),
          airline_code: hot.airline_code,
          bsp_amount: hot.ticket_amount,
          currency: hot.currency,
          description: `ADM ${ticketNum} in BSP HOT` +
            (related ? ` (RTDN ${related})` : '') +
            ` not matched in agency records.`,
        });
      } else if (hot.transaction_type === 'ACM') {
        const related = hot.related_documents?.[0]?.ticket_number;
        discrepancies.push({
          type: 'UNMATCHED_ACM',
          severity: 'medium',
          ticket_number: ticketNum,
          ...(related ? { related_ticket_number: related } : {}),
          airline_code: hot.airline_code,
          bsp_amount: hot.ticket_amount,
          currency: hot.currency,
          description: `ACM ${ticketNum} in BSP HOT` +
            (related ? ` (RTDN ${related})` : '') +
            ` not matched in agency records.`,
        });
      } else if (hot.transaction_type === 'EXCHANGE' || hot.original_ticket_number) {
        discrepancies.push({
          type: 'UNMATCHED_EXCHANGE',
          severity: 'high',
          ticket_number: ticketNum,
          ...(hot.original_ticket_number
            ? { related_ticket_number: hot.original_ticket_number }
            : {}),
          airline_code: hot.airline_code,
          bsp_amount: hot.ticket_amount,
          currency: hot.currency,
          description: `Exchange-linked HOT document ${ticketNum}` +
            (hot.original_ticket_number ? ` (ORIT ${hot.original_ticket_number})` : '') +
            ` not matched in agency records.`,
        });
      } else {
        discrepancies.push({
          type: 'MISSING_IN_AGENCY',
          severity: 'critical',
          ticket_number: ticketNum,
          airline_code: hot.airline_code,
          bsp_amount: hot.ticket_amount,
          currency: hot.currency,
          description: `Ticket ${ticketNum} in BSP HOT file but not in agency records.`,
        });
      }
    }
  }

  // Duplicate detection within HOT (same TDNR + category)
  for (const [ticketNum, hotRecs] of hotByTicket) {
    const byType = new Map<HOTTransactionType, HOTFileRecord[]>();
    for (const h of hotRecs) {
      const list = byType.get(h.transaction_type) ?? [];
      list.push(h);
      byType.set(h.transaction_type, list);
    }
    for (const [txnType, list] of byType) {
      if (txnType === 'SALE' && list.length > 1) {
        discrepancies.push({
          type: 'DUPLICATE_TRANSACTION',
          severity: 'high',
          ticket_number: ticketNum,
          airline_code: list[0]!.airline_code,
          bsp_amount: list[0]!.ticket_amount,
          currency: list[0]!.currency,
          description: `Duplicate SALE for ${ticketNum} in HOT file (${list.length} occurrences).`,
        });
      }
    }
  }

  const patterns = detectPatterns(discrepancies, input);

  const totalDiscrepancyAmount = discrepancies.reduce(
    (sum, d) => sum.plus(new Decimal(d.difference ?? d.agency_amount ?? d.bsp_amount ?? '0')),
    new Decimal(0),
  );

  const currenciesPresent = [
    ...new Set(input.hot_records.map((h) => h.currency).filter(Boolean)),
  ].sort();

  const summary: ReconciliationSummary = {
    total_agency_records: input.agency_records.length,
    total_hot_records: input.hot_records.length,
    matched_count: matchedCount,
    discrepancy_count: discrepancies.length,
    critical_count: discrepancies.filter((d) => d.severity === 'critical').length,
    total_discrepancy_amount: totalDiscrepancyAmount.toFixed(2),
    currency: thresholdCurrency,
    currencies_present: currenciesPresent,
    patterns,
  };

  const passed = discrepancies.filter((d) => d.severity === 'critical').length === 0;

  return { discrepancies, summary, passed };
}

function detectPatterns(
  discrepancies: Discrepancy[],
  input: BSPReconciliationInput,
): PatternDetection[] {
  const patterns: PatternDetection[] = [];

  if (discrepancies.length < 10) return patterns;

  const commByAirline = new Map<string, { count: number; total: Decimal }>();
  for (const d of discrepancies) {
    if (d.type === 'COMMISSION_MISMATCH' && d.airline_code) {
      const existing = commByAirline.get(d.airline_code) ?? { count: 0, total: new Decimal(0) };
      existing.count++;
      existing.total = existing.total.plus(new Decimal(d.difference ?? '0'));
      commByAirline.set(d.airline_code, existing);
    }
  }
  for (const [airline, data] of commByAirline) {
    if (data.count >= 3) {
      patterns.push({
        pattern: 'RECURRING_COMMISSION_MISMATCH',
        count: data.count,
        total_amount: data.total.toFixed(2),
        currency: input.threshold_currency ?? 'USD',
        description: `Recurring commission mismatch for airline ${airline}: ${data.count} tickets, total ${data.total.toFixed(2)}.`,
      });
    }
  }

  const missingByAirline = new Map<string, number>();
  for (const d of discrepancies) {
    if ((d.type === 'MISSING_IN_HOT' || d.type === 'MISSING_IN_AGENCY') && d.airline_code) {
      missingByAirline.set(d.airline_code, (missingByAirline.get(d.airline_code) ?? 0) + 1);
    }
  }
  for (const [airline, count] of missingByAirline) {
    if (count >= 3) {
      patterns.push({
        pattern: 'RECURRING_MISSING_TRANSACTIONS',
        count,
        total_amount: '0.00',
        currency: input.threshold_currency ?? 'USD',
        description: `Recurring missing transactions for airline ${airline}: ${count} tickets unmatched.`,
      });
    }
  }

  return patterns;
}

export { matchRecords };
