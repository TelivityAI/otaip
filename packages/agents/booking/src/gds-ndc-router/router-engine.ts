/**
 * GDS/NDC Router Engine
 *
 * Routes booking requests to the correct distribution channel.
 *
 * Routing is PER (carrier, vendor, transaction), not per-airline. The same
 * carrier can route differently for shopping vs booking vs ticketing vs
 * servicing vs group vs corporate — and differently per vendor. Prefer the
 * KB capability matrix (docs/knowledge-base/gds-ndc-capability-matrix.md)
 * via `capability_matrix` / capability-matrix.ts helpers. The built-in
 * carrier-channels.json map is a shopping/booking HINT only; for any other
 * transaction type the caller must supply matrix rows or
 * `capability_overrides`, or the engine returns `domain_input_required`.
 *
 * Res 787 is the Offer/Order process standard — not a channel parity matrix.
 * NDC schema versions are never invented (no default 21.3).
 */

import type {
  GdsNdcRouterInput,
  GdsNdcRouterOutput,
  ChannelRouting,
  CarrierChannelConfig,
  DistributionChannel,
  GdsSystem,
  NdcVersion,
  GdsPnrFormat,
  NdcOrderFormat,
  RoutingSegment,
  TransactionType,
  CapabilityMatrixInputRow,
} from './types.js';
import {
  buildCapabilityOverridesFromMatrix,
  matrixTransactionsForAgentType,
  type CapabilityMatrixRow,
  type MatrixVendor,
} from './capability-matrix.js';
// JSON imported directly so esbuild inlines it into dist/index.js — using
// createRequire on the bundled output would fail with MODULE_NOT_FOUND when
// this package is consumed as a built dep.
import carrierChannelsJson from './data/carrier-channels.json';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

interface CarrierData {
  carriers: Record<string, CarrierChannelConfig>;
  codeshare_rules: { default_strategy: string; fallback_strategy: string };
}

const carrierData = carrierChannelsJson as unknown as CarrierData;

/** Transaction types whose channel capability is covered by the built-in carrier map. */
const BUILTIN_TRANSACTION_TYPES: ReadonlySet<TransactionType> = new Set<TransactionType>([
  'shopping',
  'booking',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asMatrixRows(
  rows: CapabilityMatrixInputRow[] | undefined,
): CapabilityMatrixRow[] | undefined {
  if (!rows || rows.length === 0) return undefined;
  return rows.map((r) => ({
    carrier: r.carrier,
    vendor: r.vendor,
    transaction: r.transaction,
    channel: r.channel,
    ndc_version_notes: r.ndc_version_notes,
    fallback: r.fallback,
    source: r.source ?? '',
    confidence: r.confidence ?? 'unknown',
  }));
}

function getCarrierConfig(
  iata: string,
  transactionType: TransactionType,
  overrides: GdsNdcRouterInput['capability_overrides'],
  matrixRows: CapabilityMatrixRow[] | undefined,
  vendor: MatrixVendor | undefined,
  preferredChannel: DistributionChannel | undefined,
): CarrierChannelConfig | undefined {
  // Caller-supplied per-transaction override wins.
  const carrierOverrides = overrides?.[iata];
  if (carrierOverrides && carrierOverrides[transactionType]) {
    return carrierOverrides[transactionType];
  }

  // KB matrix: (carrier, vendor, transaction) — requires vendor.
  if (matrixRows && vendor && vendor !== 'unknown') {
    const fromMatrix = buildCapabilityOverridesFromMatrix(
      matrixRows,
      iata,
      vendor,
      preferredChannel,
    );
    if (fromMatrix[transactionType]) {
      return fromMatrix[transactionType];
    }
    // If matrix has rows for this carrier+vendor but none resolve for this
    // transaction (unknown / Either), do NOT fall through to the airline map.
    const hasCarrierVendorRows = matrixRows.some(
      (r) => r.carrier === iata && r.vendor === vendor,
    );
    if (hasCarrierVendorRows) {
      const labels = matrixTransactionsForAgentType(transactionType);
      const hasUnknownOrEither = matrixRows.some(
        (r) =>
          r.carrier === iata &&
          r.vendor === vendor &&
          labels.includes(r.transaction) &&
          (r.channel === 'unknown' || r.channel === 'Either'),
      );
      if (hasUnknownOrEither) {
        return undefined;
      }
    }
  }

  // Built-in carrier defaults apply ONLY to shopping/booking transactions.
  // They are hints, not a per-airline channel map for all transactions.
  if (BUILTIN_TRANSACTION_TYPES.has(transactionType)) {
    return carrierData.carriers[iata];
  }
  return undefined;
}

function resolveRoutingCarrier(
  segment: RoutingSegment,
  transactionType: TransactionType,
  overrides: GdsNdcRouterInput['capability_overrides'],
  matrixRows: CapabilityMatrixRow[] | undefined,
  vendor: MatrixVendor | undefined,
  preferredChannel: DistributionChannel | undefined,
  platingCarrier: string | undefined,
): { carrier: string; codeshare: boolean } {
  // // TODO: DOMAIN_QUESTION: plating vs marketing vs operating channel precedence.
  // When plating_carrier is supplied and differs, prefer it for matrix lookup.
  if (
    platingCarrier &&
    platingCarrier !== segment.marketing_carrier &&
    platingCarrier !== segment.operating_carrier
  ) {
    const plateConfig = getCarrierConfig(
      platingCarrier,
      transactionType,
      overrides,
      matrixRows,
      vendor,
      preferredChannel,
    );
    if (plateConfig) {
      return { carrier: platingCarrier, codeshare: true };
    }
  }

  // Default strategy: use operating carrier if available
  if (segment.operating_carrier && segment.operating_carrier !== segment.marketing_carrier) {
    const opConfig = getCarrierConfig(
      segment.operating_carrier,
      transactionType,
      overrides,
      matrixRows,
      vendor,
      preferredChannel,
    );
    if (opConfig) {
      return { carrier: segment.operating_carrier, codeshare: true };
    }
    // Fallback to marketing carrier if operating carrier not in config
  }
  return { carrier: segment.marketing_carrier, codeshare: false };
}

function getBookingFormat(channel: DistributionChannel): 'GDS_PNR' | 'NDC_ORDER' | 'DIRECT_API' {
  switch (channel) {
    case 'GDS':
      return 'GDS_PNR';
    case 'NDC':
      return 'NDC_ORDER';
    case 'DIRECT':
      return 'DIRECT_API';
  }
}

// ---------------------------------------------------------------------------
// Main routing
// ---------------------------------------------------------------------------

export function routeSegments(input: GdsNdcRouterInput): GdsNdcRouterOutput {
  const routings: ChannelRouting[] = [];
  const matrixRows = asMatrixRows(input.capability_matrix);
  const vendor = input.vendor;

  for (const segment of input.segments) {
    const { carrier, codeshare } = resolveRoutingCarrier(
      segment,
      input.transaction_type,
      input.capability_overrides,
      matrixRows,
      vendor,
      input.preferred_channel,
      input.plating_carrier,
    );
    const config = getCarrierConfig(
      carrier,
      input.transaction_type,
      input.capability_overrides,
      matrixRows,
      vendor,
      input.preferred_channel,
    );

    if (!config) {
      // Two cases:
      //  1. Transaction type beyond the built-in defaults and no matrix/override
      //     supplied → we cannot decide a channel. Return DOMAIN_INPUT_REQUIRED.
      //  2. Carrier truly unknown for shopping/booking → also DOMAIN_INPUT_REQUIRED.
      const missing: string[] = [
        `capability_matrix|capability_overrides[${carrier}].${input.transaction_type}`,
      ];
      if (!vendor || vendor === 'unknown') {
        missing.push('vendor');
      }
      routings.push({
        primary_channel: 'GDS', // placeholder; ignore when domain_input_required=true
        gds_system: null,
        ndc_version: null,
        ndc_provider_id: null,
        fallbacks: [],
        routed_carrier: carrier,
        codeshare_applied: codeshare,
        booking_format: 'GDS_PNR',
        domain_input_required: true,
        missing_inputs: missing,
      });
      continue;
    }

    // Determine primary channel
    let primaryChannel: DistributionChannel;
    if (input.preferred_channel && config.channels.includes(input.preferred_channel)) {
      primaryChannel = input.preferred_channel;
    } else {
      primaryChannel = config.channel_priority[0] ?? 'GDS';
    }

    // Determine GDS system
    let gdsSystem: GdsSystem | null = null;
    if (primaryChannel === 'GDS' || config.channels.includes('GDS')) {
      gdsSystem = input.preferred_gds ?? config.gds_preference ?? 'AMADEUS';
    }

    // Determine NDC version
    let ndcVersion: NdcVersion | null = null;
    let ndcProviderId: string | null = null;
    if (primaryChannel === 'NDC' && config.ndc_capable) {
      ndcVersion = config.ndc_version;
      ndcProviderId = config.ndc_provider_id;
    }

    // Build fallbacks
    const fallbacks: DistributionChannel[] = [];
    if (input.include_fallbacks) {
      for (const ch of config.channel_priority) {
        if (ch !== primaryChannel) {
          fallbacks.push(ch);
        }
      }
    }

    routings.push({
      primary_channel: primaryChannel,
      gds_system: primaryChannel === 'GDS' ? gdsSystem : null,
      ndc_version: ndcVersion,
      ndc_provider_id: ndcProviderId,
      fallbacks,
      routed_carrier: carrier,
      codeshare_applied: codeshare,
      booking_format: getBookingFormat(primaryChannel),
    });
  }

  // Determine unified channel — only over resolvable segments.
  const resolvedRoutings = routings.filter((r) => !r.domain_input_required);
  const primaryChannels = new Set(resolvedRoutings.map((r) => r.primary_channel));
  const unifiedChannel =
    resolvedRoutings.length === routings.length && primaryChannels.size === 1;
  const recommendedChannel = unifiedChannel
    ? (resolvedRoutings[0]?.primary_channel ?? null)
    : null;

  // Build format stubs
  const gdsFormat = buildGdsFormatStub(input.segments, routings);
  const ndcFormat = buildNdcFormatStub(input.segments, routings);

  return {
    routings,
    unified_channel: unifiedChannel,
    recommended_channel: recommendedChannel,
    gds_format: gdsFormat,
    ndc_format: ndcFormat,
  };
}

// ---------------------------------------------------------------------------
// Format translation stubs
// ---------------------------------------------------------------------------

function buildGdsFormatStub(
  segments: RoutingSegment[],
  routings: ChannelRouting[],
): GdsPnrFormat | null {
  const gdsRoutings = routings.filter(
    (r) => r.primary_channel === 'GDS' && !r.domain_input_required,
  );
  if (gdsRoutings.length === 0) return null;

  const gds = gdsRoutings[0]!.gds_system ?? 'AMADEUS';

  return {
    format: 'GDS_PNR',
    gds,
    record_locator: null,
    segments: segments
      .filter((_, i) => routings[i]?.primary_channel === 'GDS' && !routings[i]?.domain_input_required)
      .map((seg) => ({
        carrier: seg.marketing_carrier,
        flight_number: seg.flight_number ?? '',
        origin: seg.origin,
        destination: seg.destination,
        booking_class: '',
        date: '',
        status: 'SS',
      })),
  };
}

function buildNdcFormatStub(
  segments: RoutingSegment[],
  routings: ChannelRouting[],
): NdcOrderFormat | null {
  const ndcRoutings = routings.filter(
    (r) => r.primary_channel === 'NDC' && !r.domain_input_required,
  );
  if (ndcRoutings.length === 0) return null;

  // Never invent a schema version (CLAUDE.md / #142: no "everyone is 21.3").
  const version = ndcRoutings[0]!.ndc_version;
  if (!version) return null;

  return {
    format: 'NDC_ORDER',
    ndc_version: version,
    order_id: null,
    offer_items: segments
      .filter((_, i) => routings[i]?.primary_channel === 'NDC' && !routings[i]?.domain_input_required)
      .map((seg) => ({
        carrier: seg.marketing_carrier,
        origin: seg.origin,
        destination: seg.destination,
        service_id: '',
      })),
  };
}
