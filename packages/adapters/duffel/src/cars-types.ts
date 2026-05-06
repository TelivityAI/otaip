/**
 * Duffel Cars API — types.
 *
 * Two layers:
 *   - **Canonical** (`Car*`) — the OTAIP-facing shape, matches the vendor brief.
 *   - **Wire** (`DuffelCars*`) — the raw JSON Duffel returns. Best-effort
 *     based on the brief; mappers tolerate missing fields. See
 *     `docs/knowledge-base/cars.md` for outstanding DOMAIN_QUESTIONs.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export interface Money {
  /** Decimal string — never parsed to Number. */
  amount: string;
  /** ISO 4217 currency code. */
  currency: string;
}

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Documented car categories. Suppliers may publish other values; the
 * mapper passes unknown strings through verbatim, so the public type is
 * the union OR the raw string. See DQ-C3 in the KB.
 */
export type CarCategory =
  | 'compact'
  | 'economy'
  | 'standard'
  | 'full_size'
  | 'premium'
  | 'luxury'
  | 'suv'
  | 'van';

export type CarTransmission = 'automatic' | 'manual';
export type CarPaymentType = 'guarantee' | 'prepaid' | 'postpaid';
export type CarBookingStatus = 'confirmed' | 'cancelled';

// ---------------------------------------------------------------------------
// Canonical types
// ---------------------------------------------------------------------------

export interface CarSearchLocation {
  latitude: number;
  longitude: number;
  /** Search radius in kilometres. Default 5 (DQ-C1 — upper bound unverified). */
  radius?: number;
}

export interface CarSearchRequest {
  /** ISO date. */
  pickupDate: string;
  /** HH:mm 24-hour. Timezone — see DQ-C2. */
  pickupTime: string;
  pickupLocation: CarSearchLocation;
  dropoffDate: string;
  dropoffTime: string;
  dropoffLocation: CarSearchLocation;
  driver: {
    age: number;
    /** ISO 3166-1 alpha-2. */
    residenceCountryCode: string;
  };
  signal?: AbortSignal;
}

export interface CarLocation {
  address: string;
  latitude: number;
  longitude: number;
  phone?: string;
  /** Free-form opening hours. */
  openingHours?: string;
}

export interface CarBaggage {
  small: number;
  large: number;
}

export interface CarDetails {
  name: string;
  /** Documented category or raw supplier value (DQ-C3). */
  category: CarCategory | string;
  /** Free-form body type — `four_door`, `suv`, etc. (DQ-C3). */
  type: string;
  transmission: CarTransmission;
  fuel: string;
  /** ACRISS four-letter code (e.g. `CDAV`). */
  acrissCode: string;
  maxPassengers: number;
  baggage: CarBaggage;
  airConditioning: boolean;
  images: string[];
}

export interface CarSupplier {
  name: string;
  logoUrl?: string;
}

export interface CarRate {
  rateId: string;
  searchId: string;
  car: CarDetails;
  supplier: CarSupplier;
  pickupLocation: CarLocation;
  dropoffLocation: CarLocation;
  baseAmount: Money;
  totalAmount: Money;
  paymentType: CarPaymentType;
}

export interface CarSearchResult {
  searchId: string;
  rates: CarRate[];
}

export interface CarCondition {
  title: string;
  text: string;
}

export interface CarCharge {
  amount: string;
  currency: string;
  description: string;
}

export interface CarMileage {
  unlimited: boolean;
  /** Allowance count when not unlimited. */
  included?: number;
  /** Unit string passed through verbatim. */
  unit?: string;
}

export interface CarQuote {
  quoteId: string;
  rateId: string;
  searchId: string;
  car: CarDetails;
  supplier: CarSupplier;
  pickupLocation: CarLocation;
  dropoffLocation: CarLocation;
  totalAmount: Money;
  conditions: CarCondition[];
  charges: CarCharge[];
  mileage?: CarMileage;
  /**
   * Privacy policies the user must acknowledge before booking. Adapter
   * surfaces them verbatim; consent is the orchestration layer's job.
   * See DQ-C4.
   */
  privacyPolicies: string[];
}

export interface CarDriver {
  givenName: string;
  familyName: string;
  email: string;
  phoneNumber: string;
  /** ISO date. */
  dateOfBirth?: string;
}

/**
 * Payment object passed through to Duffel verbatim. Card creation is
 * out of scope for this adapter (DQ-C5) — callers construct the payment
 * object using whatever Duffel-stored card they have.
 */
export type CarPayment =
  | { method: 'card'; cardId: string }
  | { method: string; [k: string]: unknown };

export interface CarBookRequest {
  quoteId: string;
  driver: CarDriver;
  payment?: CarPayment;
  inboundFlightNumber?: string;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
}

export interface CarBookResponse {
  bookingId: string;
  status: CarBookingStatus;
  /** Supplier-issued booking reference. */
  reference: string;
  confirmedAt: string;
  car: CarDetails;
  supplier: CarSupplier;
  pickupLocation: CarLocation;
  dropoffLocation: CarLocation;
  totalAmount: Money;
}

export interface CarCancelResponse {
  status: 'cancelled';
  cancelledAt: string;
}

// ---------------------------------------------------------------------------
// Wire types — Duffel Cars API responses
// ---------------------------------------------------------------------------

export interface DuffelCarsSearchRequest {
  data: {
    pickup_date: string;
    pickup_time: string;
    pickup_location: { radius?: number; geographic_coordinates: GeoCoordinates };
    dropoff_date: string;
    dropoff_time: string;
    dropoff_location: { radius?: number; geographic_coordinates: GeoCoordinates };
    driver: { age: number; residence_country_code: string };
  };
}

export interface DuffelCarWire {
  name?: string;
  category?: string;
  type?: string;
  transmission?: 'automatic' | 'manual' | string;
  fuel?: string;
  code?: string;
  max_passengers?: number;
  baggage?: { small?: number; large?: number };
  air_conditioning?: boolean;
  images?: Array<string | { url?: string }>;
}

export interface DuffelCarsLocationWire {
  address?: string;
  geographic_coordinates?: { latitude?: number; longitude?: number };
  phone?: string;
  opening_hours?: string;
}

export interface DuffelCarsRateWire {
  id: string;
  car?: DuffelCarWire;
  supplier?: { name?: string; logo_url?: string };
  pickup_location?: DuffelCarsLocationWire;
  dropoff_location?: DuffelCarsLocationWire;
  base_amount?: string;
  base_currency?: string;
  total_amount?: string;
  total_currency?: string;
  payment_type?: string;
}

export interface DuffelCarsSearchResponse {
  data: {
    id: string;
    rates?: DuffelCarsRateWire[];
  };
}

export interface DuffelCarsQuoteRequest {
  data: { rate_id: string };
}

export interface DuffelCarsQuoteWire extends DuffelCarsRateWire {
  search_id?: string;
  rate_id?: string;
  conditions?: Array<{ title?: string; text?: string }>;
  charges?: Array<{ amount?: string; currency?: string; description?: string }>;
  mileage?: { unlimited?: boolean; included?: number; unit?: string };
  privacy_policies?: Array<string | { text?: string; url?: string }>;
}

export interface DuffelCarsQuoteResponse {
  data: DuffelCarsQuoteWire;
}

export interface DuffelCarsBookingRequest {
  data: {
    quote_id: string;
    driver: {
      given_name: string;
      family_name: string;
      email: string;
      phone_number: string;
      date_of_birth?: string;
    };
    payment?: CarPayment;
    metadata?: Record<string, string>;
    inbound_flight_number?: string;
  };
}

export interface DuffelCarsBookingWire {
  id: string;
  status?: string;
  reference?: string;
  confirmed_at?: string;
  car?: DuffelCarWire;
  supplier?: { name?: string; logo_url?: string };
  pickup_location?: DuffelCarsLocationWire;
  dropoff_location?: DuffelCarsLocationWire;
  total_amount?: string;
  total_currency?: string;
}

export interface DuffelCarsBookingResponse {
  data: DuffelCarsBookingWire;
}

export interface DuffelCarsCancelResponse {
  data: {
    id?: string;
    status?: string;
    cancelled_at?: string;
  };
}
