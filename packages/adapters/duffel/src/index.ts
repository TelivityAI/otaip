export { MockDuffelAdapter } from './mock-duffel-adapter.js';
export { DuffelAdapter, parseDurationToMinutes } from './duffel-adapter.js';
export type { BookRequest, BookResponse } from './duffel-adapter.js';
export { DuffelOrderBridge } from './order-bridge.js';
export { duffelCapabilities } from './capabilities.js';

// Cars — types
export type {
  CarBaggage,
  CarBookRequest,
  CarBookResponse,
  CarBookingStatus,
  CarCancelResponse,
  CarCategory,
  CarCharge,
  CarCondition,
  CarDetails,
  CarDriver,
  CarLocation,
  CarMileage,
  CarPayment,
  CarPaymentType,
  CarQuote,
  CarRate,
  CarSearchLocation,
  CarSearchRequest,
  CarSearchResult,
  CarSupplier,
  CarTransmission,
  DuffelCarWire,
  DuffelCarsBookingRequest,
  DuffelCarsBookingResponse,
  DuffelCarsBookingWire,
  DuffelCarsCancelResponse,
  DuffelCarsLocationWire,
  DuffelCarsQuoteRequest,
  DuffelCarsQuoteResponse,
  DuffelCarsQuoteWire,
  DuffelCarsRateWire,
  DuffelCarsSearchRequest,
  DuffelCarsSearchResponse,
  GeoCoordinates,
  Money,
} from './cars-types.js';

// Cars — mappers
export {
  mapBookingResponse as mapCarBookingResponse,
  mapCancelResponse as mapCarCancelResponse,
  mapQuoteResponse as mapCarQuoteResponse,
  mapRate as mapCarRate,
  mapSearchResponse as mapCarSearchResponse,
} from './cars-mapper.js';
