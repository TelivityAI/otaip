/**
 * GDS/NDC Router Engine
 *
 * Routes booking requests to the correct distribution channel.
 *
 * Routing is PER-TRANSACTION, not per-airline. The same carrier can route
 * differently for shopping vs booking vs ticketing vs servicing vs group
 * vs corporate transactions. The built-in carrier capability map covers
 * the common shopping/booking flows; for any other transaction type the
 * caller must supply `capability_overrides` or the engine returns
 * `domain_input_required` for that segment.
 *
 * // DOMAIN_QUESTION: per-carrier capability matrix per transaction type.
 * // The previous implementation treated `carrier → channel_priority` as
 * // unconditional, which was a CLAUDE.md violation: NDC carriers still
 * // require GDS for groups, corporate fares, and post-booking servicing.
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
} from './types.js';
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

function getCarrierConfig(
  iata: string,
  transactionType: TransactionType,
  overrides: GdsNdcRouterInput['capability_overrides'],
): CarrierChannelConfig | undefined {
  // Caller-supplied per-transaction override wins.
  const carrierOverrides = overrides?.[iata];
  if (carrierOverrides && carrierOverrides[transactionType]) {
    return carrierOverrides[transactionType];
  }
  // Built-in carrier defaults apply ONLY to shopping/booking transactions.
  if (BUILTIN_TRANSACTION_TYPES.has(transactionType)) {
    return carrierData.carriers[iata];
  }
  return undefined;
}

function resolveRoutingCarrier(
  segment: RoutingSegment,
  transactionType: TransactionType,
  overrides: GdsNdcRouterInput['capability_overrides'],
): { carrier: string; codeshare: boolean } {
  // Default strategy: use operating carrier if available
  if (segment.operating_carrier && segment.operating_carrier !== segment.marketing_carrier) {
    const opConfig = getCarrierConfig(segment.operating_carrier, transactionType, overrides);
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

  for (const segment of input.segments) {
    const { carrier, codeshare } = resolveRoutingCarrier(
      segment,
      input.transaction_type,
      input.capability_overrides,
    );
    const config = getCarrierConfig(carrier, input.transaction_type, input.capability_overrides);

    if (!config) {
      // Two cases:
      //  1. Transaction type beyond the built-in defaults and no override
      //     supplied → we cannot decide a channel. Return DOMAIN_INPUT_REQUIRED.
      //  2. Carrier truly unknown for shopping/booking → also DOMAIN_INPUT_REQUIRED.
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
        missing_inputs: [
          `capability_overrides[${carrier}].${input.transaction_type}`,
        ],
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

  const version = ndcRoutings[0]!.ndc_version ?? '21.3';

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
