export { HotelbedsAdapter } from './hotelbeds-adapter.js';
export { MockHotelbedsAdapter } from './mock-hotelbeds-adapter.js';
export {
  hotelbedsCapabilities,
  hotelbedsActivitiesCapabilities,
  hotelbedsTransfersCapabilities,
} from './capabilities.js';
export type {
  LodgingChannelCapability,
  LodgingChannelKind,
  ActivitiesChannelCapability,
  ActivitiesChannelKind,
  TransfersChannelCapability,
  TransfersChannelKind,
} from './capabilities.js';

export { signRequest, buildAuthHeaders } from './auth.js';
export type { HotelbedsCredentials } from './auth.js';

export {
  mapHotelToRawResult,
  mapCancellationPolicy,
  mapRate,
  mapBookingStatus,
  parseCategoryCodeStarRating,
  isRefundableRate,
  summarizeBooking,
  HOTELBEDS_SOURCE_ID,
  HOTELBEDS_CANCEL_FEE_MARKUP,
} from './field-mapper.js';
export type { BookingSummary, MapHotelOptions } from './field-mapper.js';

export type { HotelSearchParams, HotelSourceAdapter } from './lodging-source-interface.js';

export { HOTELBEDS_BASE_URLS } from './types.js';

// Activities + Transfers — mappers
export {
  mapActivity,
  mapActivityAvailability,
  mapActivityBookingResponse,
  mapActivityCancellation,
} from './activities-mapper.js';
export {
  mapTransfer,
  mapTransferAvailability,
  mapTransferBookingResponse,
  mapTransferCancellation,
} from './transfers-mapper.js';

// Activities — types
export type {
  ActivitySearchRequest,
  ActivityOffer,
  ActivityModality,
  ActivityCancellationPolicy,
  ActivityBookRequest,
  ActivityBookResponse,
  ActivityBookingStatus,
  ActivityCancelResponse,
  HotelbedsActivity,
  HotelbedsActivityModality,
  HotelbedsActivitiesAvailabilityRequest,
  HotelbedsActivitiesAvailabilityResponse,
  HotelbedsActivitiesBookingRequest,
  HotelbedsActivitiesBookingResponse,
  HotelbedsActivitiesCancellationResponse,
} from './activities-types.js';

// Transfers — types
export type {
  TransferSearchRequest,
  TransferLocation,
  TransferLocationType,
  TransferOffer,
  TransferType,
  TransferBookRequest,
  TransferBookResponse,
  TransferBookingStatus,
  TransferCancelResponse,
  HotelbedsTransfer,
  HotelbedsTransfersAvailabilityRequest,
  HotelbedsTransfersAvailabilityResponse,
  HotelbedsTransfersBookingRequest,
  HotelbedsTransfersBookingResponse,
  HotelbedsTransfersCancellationResponse,
} from './transfers-types.js';

// Shared
export type { Money } from './shared-types.js';
export type {
  HotelbedsAdapterConfig,
  HotelbedsEnvironment,
  HotelbedsAvailabilityRequest,
  HotelbedsAvailabilityResponse,
  HotelbedsHotel,
  HotelbedsRoom,
  HotelbedsRate,
  HotelbedsCancellationPolicy,
  HotelbedsCheckRateRequest,
  HotelbedsCheckRateResponse,
  HotelbedsBookingRequest,
  HotelbedsBookingResponse,
  HotelbedsBooking,
  HotelbedsBookingListResponse,
  HotelbedsCancellationFlag,
  HotelbedsCancellationResponse,
  HotelbedsErrorResponse,
  HotelbedsOccupancy,
  HotelbedsPax,
  HotelbedsBookingPax,
  HotelbedsBookingRoom,
  HotelbedsPaymentData,
  HotelbedsTax,
  HotelbedsTaxes,
  HotelbedsRateBreakdown,
  HotelbedsPromotion,
  HotelbedsOffer,
  HotelbedsAuditData,
  HotelbedsVoucherEmail,
} from './types.js';
