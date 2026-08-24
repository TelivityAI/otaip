/**
 * HOT (Hand-Off Tape) File Parser
 *
 * Production HOT follows IATA DISH Rev 23 fixed-width record grids
 * (BFH/BCH/BOH/BKT/BKS/…). Generic EDI X12 parsers miss those sections —
 * see docs/knowledge-base/bsp-hot-reconciliation.md.
 *
 * Supported lab formats:
 * - DISH_REV23: synthetic tagged records (never real agency data)
 * - FIXED_WIDTH / EDI_X12: legacy simplified fixtures
 */

import type {
  DishTransactionCode,
  HOTFileFormat,
  HOTFileRecord,
  HOTTransactionType,
  RelatedDocumentRef,
} from './types.js';

const EDI_DELIMITER = '*';
const EDI_SEGMENT_TERMINATOR = '~';

function detectFormat(content: string): HOTFileFormat {
  const trimmed = content.trimStart();
  const firstLine = trimmed.split('\n')[0] ?? '';
  if (
    firstLine.startsWith('# SYNTHETIC DISH') ||
    firstLine.startsWith('BFH|') ||
    firstLine.startsWith('BOH|') ||
    firstLine.startsWith('TXN|')
  ) {
    return 'DISH_REV23';
  }
  if (
    firstLine.includes(EDI_SEGMENT_TERMINATOR) ||
    firstLine.startsWith('ISA') ||
    firstLine.startsWith('ST')
  ) {
    return 'EDI_X12';
  }
  return 'FIXED_WIDTH';
}

function mapDishCodeToType(
  code: string,
  paymentType?: string,
): { transaction_type: HOTTransactionType; transaction_code: DishTransactionCode } {
  const c = code.trim().toUpperCase();
  const pay = (paymentType ?? '').trim().toUpperCase();

  if (c === 'EXCH' || pay === 'EX' || pay === 'EXCH') {
    return { transaction_type: 'EXCHANGE', transaction_code: c === 'EXCH' ? 'EXCH' : 'TKTT' };
  }

  switch (c) {
    case 'TKTT':
    case 'SALE':
    case 'S':
      return { transaction_type: 'SALE', transaction_code: c === 'S' || c === 'SALE' ? 'TKTT' : 'TKTT' };
    case 'RFND':
    case 'REFUND':
    case 'R':
      return { transaction_type: 'REFUND', transaction_code: 'RFND' };
    case 'ADMA':
    case 'ADM':
    case 'D':
      return { transaction_type: 'ADM', transaction_code: 'ADMA' };
    case 'ACMA':
    case 'ACM':
    case 'C':
      return { transaction_type: 'ACM', transaction_code: 'ACMA' };
    case 'EMDA':
      return { transaction_type: 'EMD', transaction_code: 'EMDA' };
    case 'EMDS':
      return { transaction_type: 'EMD', transaction_code: 'EMDS' };
    case 'CANX':
      return { transaction_type: 'SALE', transaction_code: 'CANX' };
    case 'TASF':
      return { transaction_type: 'SALE', transaction_code: 'TASF' };
    default:
      return { transaction_type: 'SALE', transaction_code: 'OTHER' };
  }
}

function parseTransactionType(code: string): HOTTransactionType {
  return mapDishCodeToType(code).transaction_type;
}

function normalizeTicket(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  // DISH TDNR is up to 14 AN; agency matching uses 13-digit form (drop check digit when present)
  if (digits.length === 14) return digits.slice(0, 13);
  return digits;
}

function parseKvLine(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = line.split('|');
  // parts[0] is record tag (BFH, BOH, TXN, CNJ, REL, …)
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toUpperCase();
    const value = part.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

/**
 * Synthetic DISH Rev 23–like tagged HOT.
 * Lines: BFH|…, BOH|CUTP=…, TXN|TRNC=…|TDNR=…|CUTP=…, CNJ|…, REL|…
 * Never parse live agency HOT dumps into fixtures.
 */
function parseDishRev23(content: string): HOTFileRecord[] {
  const records: HOTFileRecord[] = [];
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);

  let reportingCurrency: string | undefined;
  let billingPeriod: string | undefined;
  // Conjunction / related docs keyed by TRNN until we flush TXN rows
  const conjunctionByTrnn = new Map<string, string[]>();
  const relatedByTrnn = new Map<string, RelatedDocumentRef[]>();
  const pendingByTrnn = new Map<string, Partial<HOTFileRecord> & { ticket_number: string }>();

  const flushPending = (): void => {
    for (const partial of pendingByTrnn.values()) {
      const trnn = partial.transaction_number ?? '';
      const cnj = conjunctionByTrnn.get(trnn) ?? [];
      const related = relatedByTrnn.get(trnn) ?? [];
      const ticket = partial.ticket_number;
      const others = cnj.filter((t) => t !== ticket);
      const pay = partial.payment_type;
      const mapped = mapDishCodeToType(
        partial.transaction_code ?? partial.transaction_type ?? 'TKTT',
        pay,
      );

      records.push({
        ticket_number: ticket,
        passenger_name: partial.passenger_name ?? '',
        origin: partial.origin ?? '',
        destination: partial.destination ?? '',
        airline_code: partial.airline_code ?? 'XX',
        issue_date: partial.issue_date ?? '',
        ticket_amount: partial.ticket_amount ?? '0.00',
        commission_amount: partial.commission_amount ?? '0.00',
        tax_amount: partial.tax_amount ?? '0.00',
        ...(partial.refund_amount !== undefined ? { refund_amount: partial.refund_amount } : {}),
        transaction_type: mapped.transaction_type,
        transaction_code: mapped.transaction_code,
        ...(partial.issue_sequence !== undefined ? { issue_sequence: partial.issue_sequence } : {}),
        ...(pay !== undefined ? { payment_type: pay } : {}),
        currency: partial.currency ?? reportingCurrency ?? 'USD',
        ...(reportingCurrency !== undefined ? { reporting_currency: reportingCurrency } : {}),
        ...(billingPeriod !== undefined ? { billing_period: billingPeriod } : {}),
        ...(trnn ? { transaction_number: trnn } : {}),
        ...(partial.is_conjunction !== undefined ? { is_conjunction: partial.is_conjunction } : {}),
        ...(partial.conjunction_primary !== undefined
          ? { conjunction_primary: partial.conjunction_primary }
          : {}),
        ...(others.length > 0 ? { conjunction_ticket_numbers: others } : {}),
        ...(partial.original_ticket_number !== undefined
          ? { original_ticket_number: partial.original_ticket_number }
          : {}),
        ...(related.length > 0 ? { related_documents: related } : {}),
      });
    }
    pendingByTrnn.clear();
  };

  for (const line of lines) {
    if (line.startsWith('#')) continue;
    const tag = line.split('|')[0]?.toUpperCase() ?? '';
    const kv = parseKvLine(line);

    if (tag === 'BFH') {
      if (kv['PERIOD']) billingPeriod = kv['PERIOD'];
      continue;
    }
    if (tag === 'BOH') {
      if (kv['CUTP']) reportingCurrency = kv['CUTP'];
      if (kv['PERIOD']) billingPeriod = kv['PERIOD'];
      continue;
    }
    if (tag === 'CNJ') {
      const trnn = kv['TRNN'] ?? '';
      const tdnr = normalizeTicket(kv['TDNR'] ?? '');
      const primary = normalizeTicket(kv['PRIMARY'] ?? '');
      if (!trnn || !tdnr) continue;
      const list = conjunctionByTrnn.get(trnn) ?? [];
      if (primary && !list.includes(primary)) list.push(primary);
      if (!list.includes(tdnr)) list.push(tdnr);
      conjunctionByTrnn.set(trnn, list);

      // Also register a pending CNJ document row if not already a TXN
      if (!pendingByTrnn.has(`${trnn}:${tdnr}`)) {
        pendingByTrnn.set(`${trnn}:${tdnr}`, {
          ticket_number: tdnr,
          transaction_number: trnn,
          is_conjunction: true,
          conjunction_primary: primary || undefined,
          transaction_type: 'SALE',
          transaction_code: 'TKTT',
          currency: kv['CUTP'] ?? reportingCurrency ?? 'USD',
          passenger_name: kv['PXNM'] ?? '',
          origin: kv['ORAC'] ?? '',
          destination: kv['DSTC'] ?? '',
          airline_code: kv['AL'] ?? 'XX',
          issue_date: kv['DAIS'] ?? '',
          ticket_amount: kv['TDAM'] ?? '0.00',
          commission_amount: kv['COAM'] ?? '0.00',
          tax_amount: kv['TMFA'] ?? '0.00',
        });
      } else {
        const existing = pendingByTrnn.get(`${trnn}:${tdnr}`)!;
        existing.is_conjunction = true;
        if (primary) existing.conjunction_primary = primary;
      }
      continue;
    }
    if (tag === 'REL') {
      const trnn = kv['TRNN'] ?? '';
      const rtdn = normalizeTicket(kv['RTDN'] ?? '');
      if (!trnn || !rtdn) continue;
      const list = relatedByTrnn.get(trnn) ?? [];
      list.push({
        ticket_number: rtdn,
        ...(kv['RCPN'] !== undefined ? { coupons: kv['RCPN'] } : {}),
        ...(kv['DIRD'] !== undefined ? { issue_date: kv['DIRD'] } : {}),
      });
      relatedByTrnn.set(trnn, list);
      continue;
    }
    if (tag === 'TXN') {
      const trnn = kv['TRNN'] ?? String(pendingByTrnn.size + 1).padStart(6, '0');
      const tdnr = normalizeTicket(kv['TDNR'] ?? '');
      if (!tdnr) continue;
      const pay = kv['FPTP'] ?? kv['PAY'];
      const mapped = mapDishCodeToType(kv['TRNC'] ?? 'TKTT', pay);
      const key = `${trnn}:${tdnr}`;
      pendingByTrnn.set(key, {
        ticket_number: tdnr,
        passenger_name: kv['PXNM'] ?? '',
        origin: kv['ORAC'] ?? '',
        destination: kv['DSTC'] ?? '',
        airline_code: kv['AL'] ?? 'XX',
        issue_date: kv['DAIS'] ?? '',
        ticket_amount: kv['TDAM'] ?? '0.00',
        commission_amount: kv['COAM'] ?? '0.00',
        tax_amount: kv['TMFA'] ?? '0.00',
        ...(kv['RFND'] !== undefined ? { refund_amount: kv['RFND'] } : {}),
        transaction_type: mapped.transaction_type,
        transaction_code: mapped.transaction_code,
        issue_sequence: kv['SQNR'],
        payment_type: pay,
        currency: kv['CUTP'] ?? reportingCurrency ?? 'USD',
        transaction_number: trnn,
        ...(kv['ORIT'] !== undefined
          ? { original_ticket_number: normalizeTicket(kv['ORIT']) }
          : {}),
        ...(kv['CJCP']?.toUpperCase() === 'CNJ' ? { is_conjunction: true } : {}),
        ...(kv['PRIMARY'] !== undefined
          ? { conjunction_primary: normalizeTicket(kv['PRIMARY']) }
          : {}),
      });

      // Inline RTDN on TXN for convenience in fixtures
      if (kv['RTDN']) {
        const list = relatedByTrnn.get(trnn) ?? [];
        list.push({ ticket_number: normalizeTicket(kv['RTDN']) });
        relatedByTrnn.set(trnn, list);
      }
      continue;
    }
  }

  flushPending();

  // Attach conjunction companions onto primary TXN rows sharing TRNN
  for (const rec of records) {
    if (!rec.transaction_number) continue;
    const set = conjunctionByTrnn.get(rec.transaction_number);
    if (!set || set.length === 0) continue;
    const others = set.filter((t) => t !== rec.ticket_number);
    if (others.length > 0) {
      rec.conjunction_ticket_numbers = others;
    }
  }

  return records;
}

function parseEdiX12(content: string): HOTFileRecord[] {
  const records: HOTFileRecord[] = [];
  const segments = content
    .split(EDI_SEGMENT_TERMINATOR)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const fields = segment.split(EDI_DELIMITER);
    const segType = fields[0]?.trim();

    // Lab fixture format — not DISH. Generic X12 alone is insufficient for production HOT.
    if (segType === 'TKT' && fields.length >= 15) {
      const pay = fields[13]?.trim() || undefined;
      const mapped = mapDishCodeToType(fields[11]?.trim() ?? 'SALE', pay);
      const original = fields[16]?.trim();
      const related = fields[17]?.trim();
      records.push({
        ticket_number: normalizeTicket(fields[1]?.trim() ?? ''),
        passenger_name: fields[2]?.trim() ?? '',
        origin: fields[3]?.trim() ?? '',
        destination: fields[4]?.trim() ?? '',
        airline_code: fields[5]?.trim() ?? '',
        issue_date: fields[6]?.trim() ?? '',
        ticket_amount: fields[7]?.trim() ?? '0.00',
        commission_amount: fields[8]?.trim() ?? '0.00',
        tax_amount: fields[9]?.trim() ?? '0.00',
        refund_amount: fields[10]?.trim() || undefined,
        transaction_type: mapped.transaction_type,
        transaction_code: mapped.transaction_code,
        issue_sequence: fields[12]?.trim() || undefined,
        payment_type: pay,
        currency: fields[14]?.trim() ?? 'USD',
        billing_period: fields[15]?.trim() || undefined,
        ...(original ? { original_ticket_number: normalizeTicket(original) } : {}),
        ...(related
          ? { related_documents: [{ ticket_number: normalizeTicket(related) }] }
          : {}),
      });
    }
  }

  return records;
}

function parseFixedWidth(content: string): HOTFileRecord[] {
  const records: HOTFileRecord[] = [];
  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  for (const line of lines) {
    if (line.startsWith('HDR') || line.startsWith('TRL') || line.startsWith('#')) {
      continue;
    }

    // Legacy lab fixed-width (not a market DISH grid).
    if (line.length < 131) continue;

    const ticketNumber = normalizeTicket(line.slice(0, 13).trim());
    if (!/^\d{13}$/.test(ticketNumber)) continue;

    const txnCode = line.slice(109, 113).trim();
    const mapped = mapDishCodeToType(txnCode);
    const currency = line.slice(128, 131).trim() || 'USD';

    records.push({
      ticket_number: ticketNumber,
      passenger_name: line.slice(13, 43).trim(),
      origin: line.slice(43, 46).trim(),
      destination: line.slice(46, 49).trim(),
      airline_code: line.slice(49, 51).trim(),
      issue_date: line.slice(51, 61).trim(),
      ticket_amount: line.slice(61, 73).trim(),
      commission_amount: line.slice(73, 85).trim(),
      tax_amount: line.slice(85, 97).trim(),
      refund_amount: line.slice(97, 109).trim() || undefined,
      transaction_type: mapped.transaction_type,
      transaction_code: mapped.transaction_code,
      issue_sequence: line.slice(113, 123).trim() || undefined,
      payment_type: line.slice(123, 128).trim() || undefined,
      currency,
      // Explicit: do not assume file-wide single currency — each row carries CUTP-equivalent
      billing_period: line.length >= 139 ? line.slice(131, 139).trim() || undefined : undefined,
      ...(line.length >= 152 && line.slice(139, 152).trim()
        ? { original_ticket_number: normalizeTicket(line.slice(139, 152).trim()) }
        : {}),
    });
  }

  return records;
}

export class HOTFileParser {
  private format: HOTFileFormat | undefined;

  constructor(format?: HOTFileFormat) {
    this.format = format;
  }

  parse(content: string): HOTFileRecord[] {
    if (content.trim().length === 0) return [];

    const format = this.format ?? detectFormat(content);

    switch (format) {
      case 'DISH_REV23':
        return parseDishRev23(content);
      case 'EDI_X12':
        return parseEdiX12(content);
      case 'FIXED_WIDTH':
        return parseFixedWidth(content);
    }
  }

  static detectFormat(content: string): HOTFileFormat {
    return detectFormat(content);
  }
}

export { parseTransactionType, mapDishCodeToType };
