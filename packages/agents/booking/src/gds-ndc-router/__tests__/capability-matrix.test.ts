/**
 * Capability matrix helpers — Agent 3.1 (#142).
 *
 * Asserts per-(carrier, vendor, transaction) consumption without a
 * single airline→channel map, and that NDC versions are never invented.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { GdsNdcRouter } from '../index.js';
import {
  getSeedCapabilityMatrix,
  parseCapabilityMatrixCsv,
  lookupMatrixRow,
  matrixRowToCarrierConfig,
  buildCapabilityOverridesFromMatrix,
  parseNdcVersionNotes,
  MATRIX_TO_AGENT_TRANSACTION,
} from '../capability-matrix.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const kbCsvPath = join(
  __dirname,
  '../../../../../../docs/knowledge-base/gds-ndc-capability-matrix.csv',
);

describe('capability matrix (KB #142)', () => {
  it('seed matrix has rows for every (carrier, vendor, transaction) seed', () => {
    const rows = getSeedCapabilityMatrix();
    expect(rows.length).toBeGreaterThanOrEqual(35);
    const carriers = new Set(rows.map((r) => r.carrier));
    expect(carriers.has('ANON-NDC-AGG')).toBe(true);
    expect(carriers.has('ANON-AGG-DUAL')).toBe(true);
  });

  it('KB CSV parses and matches seed carrier set', () => {
    const csv = readFileSync(kbCsvPath, 'utf8');
    const parsed = parseCapabilityMatrixCsv(csv);
    expect(parsed.length).toBe(getSeedCapabilityMatrix().length);
  });

  it('documents shop ≠ servicing for Duffel and TripPro anonymized carriers', () => {
    const rows = getSeedCapabilityMatrix();
    const duffelShop = lookupMatrixRow(rows, {
      carrier: 'ANON-NDC-AGG',
      vendor: 'duffel',
      transaction: 'Shop',
    });
    const duffelSvc = lookupMatrixRow(rows, {
      carrier: 'ANON-NDC-AGG',
      vendor: 'duffel',
      transaction: 'Servicing',
    });
    expect(duffelShop?.channel).toBe('NDC');
    expect(duffelSvc?.channel).toBe('GDS');
    expect(duffelShop?.channel).not.toBe(duffelSvc?.channel);

    const tripShop = lookupMatrixRow(rows, {
      carrier: 'ANON-AGG-DUAL',
      vendor: 'trippro',
      transaction: 'Shop',
    });
    const tripSvc = lookupMatrixRow(rows, {
      carrier: 'ANON-AGG-DUAL',
      vendor: 'trippro',
      transaction: 'Servicing',
    });
    expect(tripShop?.channel).toBe('Either');
    expect(tripSvc?.channel).toBe('GDS');
  });

  it('never invents an NDC version from unknown notes', () => {
    expect(parseNdcVersionNotes('unknown')).toBeNull();
    expect(parseNdcVersionNotes('unknown (Duffel API version header)')).toBeNull();
    expect(parseNdcVersionNotes('n/a')).toBeNull();
    expect(parseNdcVersionNotes('schema 18.1 per portal')).toBe('18.1');
  });

  it('maps Res 787 matrix labels to agent transaction types', () => {
    expect(MATRIX_TO_AGENT_TRANSACTION.Shop).toBe('shopping');
    expect(MATRIX_TO_AGENT_TRANSACTION.OrderCreate).toBe('booking');
    expect(MATRIX_TO_AGENT_TRANSACTION.Groups).toBe('group');
  });

  it('matrixRowToCarrierConfig skips unknown and unresolved Either', () => {
    const rows = getSeedCapabilityMatrix();
    const unknown = lookupMatrixRow(rows, {
      carrier: 'ANON-NDC-AGG',
      vendor: 'duffel',
      transaction: 'OrderChange',
    })!;
    expect(matrixRowToCarrierConfig(unknown)).toBeUndefined();

    const either = lookupMatrixRow(rows, {
      carrier: 'ANON-SABRE-OO',
      vendor: 'sabre',
      transaction: 'Shop',
    })!;
    expect(matrixRowToCarrierConfig(either)).toBeUndefined();
    expect(matrixRowToCarrierConfig(either, 'NDC')?.channel_priority[0]).toBe('NDC');
  });

  it('buildCapabilityOverridesFromMatrix does not create a single airline→channel map', () => {
    const rows = getSeedCapabilityMatrix();
    const overrides = buildCapabilityOverridesFromMatrix(rows, 'ANON-NDC-AGG', 'duffel');
    // Shopping/booking NDC, servicing GDS — different channels per transaction.
    expect(overrides.shopping?.channel_priority[0]).toBe('NDC');
    expect(overrides.booking?.channel_priority[0]).toBe('NDC');
    expect(overrides.servicing?.channel_priority[0]).toBe('GDS');
    expect(overrides.shopping?.ndc_version).toBeNull();
  });
});

describe('GdsNdcRouter matrix consumption', () => {
  const agent = new GdsNdcRouter();

  beforeAll(async () => {
    await agent.initialize();
  });

  it('routes ANON-NDC-AGG Shop via NDC and Servicing via GDS from matrix', async () => {
    const matrix = getSeedCapabilityMatrix().map((r) => ({
      carrier: r.carrier,
      vendor: r.vendor,
      transaction: r.transaction,
      channel: r.channel,
      ndc_version_notes: r.ndc_version_notes,
      fallback: r.fallback,
      source: r.source,
      confidence: r.confidence,
    }));

    const shop = await agent.execute({
      data: {
        segments: [{ marketing_carrier: 'AN', origin: 'LHR', destination: 'JFK' }],
        transaction_type: 'shopping',
        vendor: 'duffel',
        // Use matrix carrier id as marketing by rewriting rows for this test carrier.
        capability_matrix: matrix.map((r) =>
          r.carrier === 'ANON-NDC-AGG' ? { ...r, carrier: 'AN' } : r,
        ),
        include_fallbacks: true,
      },
    });
    expect(shop.data.routings[0]!.domain_input_required).toBeUndefined();
    expect(shop.data.routings[0]!.primary_channel).toBe('NDC');
    expect(shop.data.routings[0]!.ndc_version).toBeNull();
    expect(shop.data.ndc_format).toBeNull(); // no invented 21.3

    const svc = await agent.execute({
      data: {
        segments: [{ marketing_carrier: 'AN', origin: 'LHR', destination: 'JFK' }],
        transaction_type: 'servicing',
        vendor: 'duffel',
        capability_matrix: matrix.map((r) =>
          r.carrier === 'ANON-NDC-AGG' ? { ...r, carrier: 'AN' } : r,
        ),
        include_fallbacks: false,
      },
    });
    expect(svc.data.routings[0]!.primary_channel).toBe('GDS');
  });

  it('returns DOMAIN_INPUT_REQUIRED for Sabre Either Shop without preferred_channel', async () => {
    const matrix = getSeedCapabilityMatrix()
      .filter((r) => r.carrier === 'ANON-SABRE-OO')
      .map((r) => ({ ...r, carrier: 'SR' }));

    const result = await agent.execute({
      data: {
        segments: [{ marketing_carrier: 'SR', origin: 'DFW', destination: 'LHR' }],
        transaction_type: 'shopping',
        vendor: 'sabre',
        capability_matrix: matrix,
        include_fallbacks: false,
      },
    });
    expect(result.data.routings[0]!.domain_input_required).toBe(true);
  });

  it('resolves Sabre Either Shop when preferred_channel is supplied', async () => {
    const matrix = getSeedCapabilityMatrix()
      .filter((r) => r.carrier === 'ANON-SABRE-OO')
      .map((r) => ({ ...r, carrier: 'SR' }));

    const result = await agent.execute({
      data: {
        segments: [{ marketing_carrier: 'SR', origin: 'DFW', destination: 'LHR' }],
        transaction_type: 'shopping',
        vendor: 'sabre',
        preferred_channel: 'NDC',
        capability_matrix: matrix,
        include_fallbacks: true,
      },
    });
    expect(result.data.routings[0]!.domain_input_required).toBeUndefined();
    expect(result.data.routings[0]!.primary_channel).toBe('NDC');
    expect(result.data.routings[0]!.ndc_version).toBeNull();
  });
});
