/**
 * GDS/NDC capability matrix — consumption helpers for Agent 3.1.
 *
 * Authoritative narrative: docs/knowledge-base/gds-ndc-capability-matrix.md
 * Seed data: ./data/capability-matrix.json (from the KB CSV).
 *
 * Routing key is (carrier, vendor, transaction) — never a single
 * airline → channel map. Res 787 defines Shop / Order / Change process
 * names; it is NOT a channel parity checklist. NDC schema versions are
 * never invented (no "everyone is 21.3").
 */

import type {
  CarrierChannelConfig,
  DistributionChannel,
  GdsSystem,
  NdcVersion,
  TransactionCapabilityOverrides,
  TransactionType,
} from './types.js';
import capabilityMatrixJson from './data/capability-matrix.json';

/** Matrix transaction labels aligned with Res 787 + OTA/TMC forks. */
export type MatrixTransaction =
  | 'Shop'
  | 'OrderCreate'
  | 'OrderChange'
  | 'OrderCancel'
  | 'Servicing'
  | 'Groups'
  | 'Corporate';

export type MatrixVendor =
  | 'sabre'
  | 'amadeus'
  | 'duffel'
  | 'navitaire'
  | 'trippro'
  | 'airline_direct'
  | 'unknown';

export type MatrixChannel = 'NDC' | 'GDS' | 'Direct/API' | 'Either' | 'unknown';

export type MatrixConfidence = 'adapter_doc' | 'vendor_public' | 'unknown';

export interface CapabilityMatrixRow {
  carrier: string;
  vendor: MatrixVendor;
  transaction: MatrixTransaction;
  channel: MatrixChannel;
  ndc_version_notes: string;
  fallback: string;
  source: string;
  confidence: MatrixConfidence;
}

export interface MatrixLookupKey {
  carrier: string;
  vendor: MatrixVendor;
  transaction: MatrixTransaction;
}

/** Map Res 787 / matrix labels → existing Agent 3.1 TransactionType. */
export const MATRIX_TO_AGENT_TRANSACTION: Record<MatrixTransaction, TransactionType> = {
  Shop: 'shopping',
  OrderCreate: 'booking',
  OrderChange: 'servicing',
  OrderCancel: 'servicing',
  Servicing: 'servicing',
  Groups: 'group',
  Corporate: 'corporate',
};

const AGENT_TO_MATRIX_TRANSACTIONS: Record<TransactionType, readonly MatrixTransaction[]> = {
  shopping: ['Shop'],
  booking: ['OrderCreate'],
  ticketing: ['Servicing'],
  servicing: ['Servicing', 'OrderChange', 'OrderCancel'],
  group: ['Groups'],
  corporate: ['Corporate'],
};

const KNOWN_NDC_VERSIONS = new Set<NdcVersion>(['17.2', '18.1', '21.3']);

interface MatrixFile {
  rows: CapabilityMatrixRow[];
}

const matrixFile = capabilityMatrixJson as unknown as MatrixFile;

/** Seed rows shipped with the agent (mirrors the KB CSV). */
export function getSeedCapabilityMatrix(): readonly CapabilityMatrixRow[] {
  return matrixFile.rows;
}

/**
 * Parse a capability-matrix CSV (header row required).
 * Unknown cells stay as the literal string "unknown".
 */
export function parseCapabilityMatrixCsv(csv: string): CapabilityMatrixRow[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]!);
  const idx = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) {
      throw new Error(`capability matrix CSV missing column: ${name}`);
    }
    return i;
  };
  const iCarrier = idx('carrier');
  const iVendor = idx('vendor');
  const iTxn = idx('transaction');
  const iChannel = idx('channel');
  const iNotes = idx('ndc_version_notes');
  const iFallback = idx('fallback');
  const iSource = idx('source');
  const iConf = idx('confidence');

  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    return {
      carrier: cols[iCarrier] ?? '',
      vendor: (cols[iVendor] ?? 'unknown') as MatrixVendor,
      transaction: (cols[iTxn] ?? 'Shop') as MatrixTransaction,
      channel: (cols[iChannel] ?? 'unknown') as MatrixChannel,
      ndc_version_notes: cols[iNotes] ?? 'unknown',
      fallback: cols[iFallback] ?? 'unknown',
      source: cols[iSource] ?? '',
      confidence: (cols[iConf] ?? 'unknown') as MatrixConfidence,
    };
  });
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (c === ',' && !inQuotes) {
      cols.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  cols.push(cur);
  return cols;
}

export function lookupMatrixRow(
  rows: readonly CapabilityMatrixRow[],
  key: MatrixLookupKey,
): CapabilityMatrixRow | undefined {
  return rows.find(
    (r) =>
      r.carrier === key.carrier &&
      r.vendor === key.vendor &&
      r.transaction === key.transaction,
  );
}

/**
 * Resolve a matrix channel cell to a DistributionChannel.
 * Returns undefined when the cell is unknown or Either without preference.
 */
export function matrixChannelToDistribution(
  channel: MatrixChannel,
  preferred?: DistributionChannel,
): DistributionChannel | undefined {
  switch (channel) {
    case 'NDC':
      return 'NDC';
    case 'GDS':
      return 'GDS';
    case 'Direct/API':
      return 'DIRECT';
    case 'Either':
      if (preferred && (preferred === 'NDC' || preferred === 'GDS' || preferred === 'DIRECT')) {
        return preferred;
      }
      // Either without preference is not a decision — caller must choose.
      return undefined;
    case 'unknown':
      return undefined;
  }
}

/** Extract a concrete NdcVersion from notes, or null — never invent 21.3. */
export function parseNdcVersionNotes(notes: string): NdcVersion | null {
  if (!notes || notes === 'unknown' || notes.startsWith('n/a') || notes.startsWith('unknown')) {
    return null;
  }
  for (const v of KNOWN_NDC_VERSIONS) {
    if (notes.includes(v)) return v;
  }
  return null;
}

function parseFallbackChannel(fallback: string): DistributionChannel | null {
  switch (fallback) {
    case 'GDS':
      return 'GDS';
    case 'NDC':
      return 'NDC';
    case 'Direct/API':
    case 'DIRECT':
      return 'DIRECT';
    default:
      return null;
  }
}

function defaultGdsForVendor(vendor: MatrixVendor): GdsSystem | null {
  switch (vendor) {
    case 'sabre':
      return 'SABRE';
    case 'amadeus':
      return 'AMADEUS';
    default:
      return null;
  }
}

/**
 * Convert one matrix row into a CarrierChannelConfig for capability_overrides.
 * Returns undefined when channel is unknown / unresolved Either.
 */
export function matrixRowToCarrierConfig(
  row: CapabilityMatrixRow,
  preferredChannel?: DistributionChannel,
): CarrierChannelConfig | undefined {
  const primary = matrixChannelToDistribution(row.channel, preferredChannel);
  if (!primary) return undefined;

  const fallback = parseFallbackChannel(row.fallback);
  const channels: DistributionChannel[] = [primary];
  if (fallback && fallback !== primary) channels.push(fallback);

  const channel_priority: DistributionChannel[] = [...channels];
  const ndc_capable = primary === 'NDC' || row.channel === 'Either';
  const ndc_version = ndc_capable ? parseNdcVersionNotes(row.ndc_version_notes) : null;

  return {
    name: `${row.carrier}/${row.vendor}`,
    channels,
    channel_priority,
    ndc_version,
    gds_preference: primary === 'GDS' || fallback === 'GDS' ? defaultGdsForVendor(row.vendor) : null,
    ndc_capable: ndc_capable && primary === 'NDC',
    ndc_provider_id: primary === 'NDC' ? `NDC_${row.vendor.toUpperCase()}` : null,
  };
}

/**
 * Build capability_overrides for a carrier from matrix rows for one vendor.
 * Skips unknown / unresolved Either rows (caller must DOMAIN_INPUT_REQUIRED).
 */
export function buildCapabilityOverridesFromMatrix(
  rows: readonly CapabilityMatrixRow[],
  carrier: string,
  vendor: MatrixVendor,
  preferredChannel?: DistributionChannel,
): TransactionCapabilityOverrides {
  const overrides: TransactionCapabilityOverrides = {};
  const carrierRows = rows.filter((r) => r.carrier === carrier && r.vendor === vendor);

  for (const row of carrierRows) {
    const config = matrixRowToCarrierConfig(row, preferredChannel);
    if (!config) continue;
    const agentTxn = MATRIX_TO_AGENT_TRANSACTION[row.transaction];
    // First concrete row for a given agent transaction wins (e.g. Servicing
    // before OrderChange when both map to 'servicing').
    if (!overrides[agentTxn]) {
      overrides[agentTxn] = config;
    }
  }
  return overrides;
}

/**
 * Convenience: resolve agent TransactionType → preferred matrix labels
 * (for callers that still speak shopping/booking/…).
 */
export function matrixTransactionsForAgentType(
  type: TransactionType,
): readonly MatrixTransaction[] {
  return AGENT_TO_MATRIX_TRANSACTIONS[type];
}
