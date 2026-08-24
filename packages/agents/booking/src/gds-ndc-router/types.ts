/**
 * GDS/NDC Router — Types
 *
 * Agent 3.1: Routes booking requests to the correct distribution channel.
 *
 * Authoritative matrix: docs/knowledge-base/gds-ndc-capability-matrix.md
 * Lookup key is (carrier, vendor, transaction) — never airline → channel alone.
 * Res 787 names the Shop / Order / Change processes; it is not a parity matrix.
 */

export type DistributionChannel = 'GDS' | 'NDC' | 'DIRECT';

export type NdcVersion = '17.2' | '18.1' | '21.3';

export type GdsSystem = 'AMADEUS' | 'SABRE' | 'TRAVELPORT';

/**
 * Distribution vendor / intermediary that executes the transaction.
 * Required for unambiguous matrix lookup when a carrier appears on
 * multiple vendors (e.g. Sabre Offer/Order vs Duffel vs airline direct).
 */
export type DistributionVendor =
  | 'sabre'
  | 'amadeus'
  | 'duffel'
  | 'navitaire'
  | 'trippro'
  | 'airline_direct'
  | 'unknown';

/**
 * Transaction-level routing dimension. Channel choice depends on the
 * type of operation AND vendor, not just the carrier — most NDC carriers
 * still require GDS for groups, corporate fares, and post-booking
 * servicing even when their default shopping/booking flow is NDC.
 *
 * Engine aliases map to Res 787 / KB matrix labels:
 *   shopping → Shop, booking → OrderCreate,
 *   servicing → Servicing|OrderChange|OrderCancel,
 *   group → Groups, corporate → Corporate.
 * See docs/knowledge-base/gds-ndc-capability-matrix.md.
 */
export type TransactionType =
  | 'shopping'
  | 'booking'
  | 'ticketing'
  | 'servicing'
  | 'group'
  | 'corporate';

export interface CarrierChannelConfig {
  name: string;
  channels: DistributionChannel[];
  channel_priority: DistributionChannel[];
  /** Concrete schema version only — never invent (no default 21.3). */
  ndc_version: NdcVersion | null;
  gds_preference: GdsSystem | null;
  ndc_capable: boolean;
  ndc_provider_id: string | null;
}

export interface RoutingSegment {
  /** Marketing carrier IATA code */
  marketing_carrier: string;
  /** Operating carrier IATA code (if different from marketing) */
  operating_carrier?: string;
  /** Origin airport */
  origin: string;
  /** Destination airport */
  destination: string;
  /** Flight number */
  flight_number?: string;
}

/**
 * Per-transaction-type capability override map. Caller supplies this when
 * routing transaction types that the built-in carrier defaults don't cover
 * ('ticketing', 'servicing', 'group', 'corporate'), or when consuming the
 * KB matrix via capability-matrix.ts helpers.
 */
export type TransactionCapabilityOverrides = Partial<
  Record<TransactionType, CarrierChannelConfig>
>;

/**
 * Inline matrix row shape accepted on input (same columns as the KB CSV).
 * Prefer this over a single airline→channel map.
 */
export interface CapabilityMatrixInputRow {
  carrier: string;
  vendor: DistributionVendor;
  transaction:
    | 'Shop'
    | 'OrderCreate'
    | 'OrderChange'
    | 'OrderCancel'
    | 'Servicing'
    | 'Groups'
    | 'Corporate';
  channel: 'NDC' | 'GDS' | 'Direct/API' | 'Either' | 'unknown';
  ndc_version_notes: string;
  fallback: string;
  source?: string;
  confidence?: 'adapter_doc' | 'vendor_public' | 'unknown';
}

export interface GdsNdcRouterInput {
  /** Segments to route */
  segments: RoutingSegment[];
  /**
   * Transaction type being routed. The decision is per-(carrier, vendor,
   * transaction), not per-airline: a carrier may use NDC for shopping but
   * require GDS for groups or post-booking servicing.
   */
  transaction_type: TransactionType;
  /**
   * Vendor / intermediary executing the transaction. Required for
   * unambiguous matrix lookup when the same carrier has rows under
   * multiple vendors.
   */
  vendor?: DistributionVendor;
  /**
   * Plating carrier when distinct from marketing/operating.
   * // TODO: DOMAIN_QUESTION: plating vs marketing vs operating channel precedence
   */
  plating_carrier?: string;
  /**
   * Inline capability matrix rows (KB CSV shape). When present, used to
   * resolve channel for (carrier, vendor, transaction) before falling back
   * to capability_overrides / built-in shopping|booking hints.
   */
  capability_matrix?: CapabilityMatrixInputRow[];
  /**
   * Caller-supplied capability overrides keyed by carrier IATA, then by
   * transaction type. Required for transaction types beyond
   * 'shopping'/'booking' when no matrix row resolves — otherwise the
   * engine returns DOMAIN_INPUT_REQUIRED.
   */
  capability_overrides?: Record<string, TransactionCapabilityOverrides>;
  /** Preferred channel (optional override) */
  preferred_channel?: DistributionChannel;
  /** Preferred GDS (optional override) */
  preferred_gds?: GdsSystem;
  /** Whether to include fallback channels */
  include_fallbacks: boolean;
}

// ---------------------------------------------------------------------------
// Format translation stubs (types only — no real API calls)
// ---------------------------------------------------------------------------

/** GDS PNR format stub */
export interface GdsPnrFormat {
  format: 'GDS_PNR';
  gds: GdsSystem;
  record_locator: string | null;
  segments: GdsPnrSegment[];
}

export interface GdsPnrSegment {
  carrier: string;
  flight_number: string;
  origin: string;
  destination: string;
  booking_class: string;
  date: string;
  status: string;
}

/** NDC Order format stub */
export interface NdcOrderFormat {
  format: 'NDC_ORDER';
  ndc_version: NdcVersion;
  order_id: string | null;
  offer_items: NdcOfferItem[];
}

export interface NdcOfferItem {
  carrier: string;
  origin: string;
  destination: string;
  service_id: string;
}

// ---------------------------------------------------------------------------
// Routing result
// ---------------------------------------------------------------------------

export interface ChannelRouting {
  /** Primary channel to use */
  primary_channel: DistributionChannel;
  /** GDS system (if channel is GDS) */
  gds_system: GdsSystem | null;
  /** NDC version (if channel is NDC) */
  ndc_version: NdcVersion | null;
  /** NDC provider ID from API abstraction layer */
  ndc_provider_id: string | null;
  /** Fallback channels in priority order */
  fallbacks: DistributionChannel[];
  /** The carrier code used for routing decision */
  routed_carrier: string;
  /** Whether codeshare routing was applied */
  codeshare_applied: boolean;
  /** Expected booking format */
  booking_format: 'GDS_PNR' | 'NDC_ORDER' | 'DIRECT_API';
  /**
   * Set when the engine could not resolve a channel for this segment
   * (transaction type lacks a capability entry). `primary_channel` is
   * meaningless in that case; callers must consult `missing_inputs`.
   */
  domain_input_required?: boolean;
  /** Names of missing inputs when `domain_input_required` is true. */
  missing_inputs?: string[];
}

export interface GdsNdcRouterOutput {
  /** Per-segment routing decisions */
  routings: ChannelRouting[];
  /** Whether all segments can be routed through the same channel */
  unified_channel: boolean;
  /** Recommended channel for the entire itinerary */
  recommended_channel: DistributionChannel | null;
  /** Format translation stubs */
  gds_format: GdsPnrFormat | null;
  ndc_format: NdcOrderFormat | null;
}
