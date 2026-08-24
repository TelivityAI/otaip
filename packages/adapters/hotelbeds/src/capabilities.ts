/**
 * Hotelbeds channel capability manifest.
 *
 * The OTAIP `ChannelCapability` type in `@otaip/core` is shaped for air
 * (NDC level, IATA carriers, ticketing). Lodging needs a different shape;
 * rather than overload the air type, this module declares a parallel
 * `LodgingChannelCapability` so the lodging-orchestration layer has a
 * structured manifest to read.
 *
 * NOT exporting through @otaip/core to avoid scope creep — when the
 * lodging orchestration layer needs a shared shape it can promote this
 * locally-defined type up.
 */

export type LodgingChannelKind = 'bedbank' | 'gds' | 'direct' | 'ota';

export interface LodgingChannelCapability {
  channelId: string;
  channelKind: LodgingChannelKind;
  /** ISO 3166 country codes the channel sources content from (or "*"). */
  supportedMarkets: string[];
  supportedFunctions: Array<
    | 'availability'
    | 'check_rate'
    | 'book'
    | 'modify'
    | 'cancel_simulation'
    | 'cancel'
    | 'list_bookings'
    | 'get_booking'
  >;
  /** True if `net` is the bedbank cost and the platform sets the markup. */
  setsRetailPrice: false;
  /** Test-environment quota — Hotelbeds caps the sandbox at 50 req/day. */
  testEnvDailyRequestLimit?: number;
  /** Adapter version string for telemetry. */
  updatedAt: string;
}

export const hotelbedsCapabilities: LodgingChannelCapability = {
  channelId: 'hotelbeds',
  channelKind: 'bedbank',
  supportedMarkets: ['*'],
  supportedFunctions: [
    'availability',
    'check_rate',
    'book',
    'cancel_simulation',
    'cancel',
    'list_bookings',
    'get_booking',
  ],
  setsRetailPrice: false,
  testEnvDailyRequestLimit: 50,
  updatedAt: '2026-04-18',
};

// ---------------------------------------------------------------------------
// Activities + Transfers capability manifests
//
// These are intentionally narrower than the lodging capability shape —
// neither API has a check_rate / list_bookings step in the surface this
// session adds. The shape is local; promote it to `@otaip/core` when more
// adapters need a non-lodging activities/transfers manifest.
// ---------------------------------------------------------------------------

export type ActivitiesChannelKind = 'activities-bedbank';

export interface ActivitiesChannelCapability {
  channelId: string;
  channelKind: ActivitiesChannelKind;
  supportedMarkets: string[];
  supportedFunctions: Array<'availability' | 'book' | 'cancel'>;
  /** True when the channel sets retail price; Hotelbeds returns net. */
  setsRetailPrice: false;
  /**
   * Whether this surface returns supplier `'ON_REQUEST'` on confirm.
   * Hotelbeds Activities does **not** — DQ-A3 CLOSED (confirm =
   * CONFIRMED|CANCELLED; PRECONFIRMED is the separate preconfirm hold).
   */
  supportsOnRequest: boolean;
  testEnvDailyRequestLimit?: number;
  updatedAt: string;
}

export type TransfersChannelKind = 'transfers-bedbank';

export interface TransfersChannelCapability {
  channelId: string;
  channelKind: TransfersChannelKind;
  supportedMarkets: string[];
  supportedFunctions: Array<'availability' | 'book' | 'cancel'>;
  setsRetailPrice: false;
  /**
   * Whether this surface may return `'ON_REQUEST'` (vendor brief).
   * DQ-T6 remains OPEN for Transfers — do not copy Activities “no OnRequest”
   * marketing onto this flag.
   */
  supportsOnRequest: boolean;
  /** Official Availability Simple documents inbound; adapter surface is one-way (DQ-T8). */
  supportsRoundTrip: boolean;
  testEnvDailyRequestLimit?: number;
  updatedAt: string;
}

export const hotelbedsActivitiesCapabilities: ActivitiesChannelCapability = {
  channelId: 'hotelbeds-activities',
  channelKind: 'activities-bedbank',
  supportedMarkets: ['*'],
  supportedFunctions: ['availability', 'book', 'cancel'],
  setsRetailPrice: false,
  supportsOnRequest: false,
  testEnvDailyRequestLimit: 50,
  updatedAt: '2026-08-24',
};

export const hotelbedsTransfersCapabilities: TransfersChannelCapability = {
  channelId: 'hotelbeds-transfers',
  channelKind: 'transfers-bedbank',
  supportedMarkets: ['*'],
  supportedFunctions: ['availability', 'book', 'cancel'],
  setsRetailPrice: false,
  supportsOnRequest: true,
  supportsRoundTrip: false,
  testEnvDailyRequestLimit: 50,
  updatedAt: '2026-08-24',
};
