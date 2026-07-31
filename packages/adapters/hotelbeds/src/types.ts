/**
 * Hotelbeds APItude wire types — Hotels API (v1.0).
 *
 * These types describe the request and response shapes the adapter speaks
 * with Hotelbeds. They are deliberately tolerant: every field that
 * Hotelbeds documents as optional is typed `?`, and unknown extension
 * fields on responses are accepted (`[k: string]: unknown` is omitted to
 * keep the surface small — the field-mapper only reads what it needs).
 *
 * Sources cross-checked against the Hotelbeds APItude OpenAPI docs.
 * Where Hotelbeds documents a field but its semantics depend on a domain
 * decision, the field-mapper carries a TODO: DOMAIN_QUESTION rather than
 * inventing behavior.
 */

import type { MoneyPathExecutorConfig, StoreDurability } from '@otaip/core';

// ---------------------------------------------------------------------------
// Adapter configuration
// ---------------------------------------------------------------------------

export type HotelbedsEnvironment = 'test' | 'production';

export interface HotelbedsAdapterConfig {
  apiKey?: string;
  secret?: string;
  environment?: HotelbedsEnvironment;
  /** Override the resolved base URL (useful for local mocks). */
  baseUrl?: string;
  /** Per-request timeout in ms (passed to fetchWithRetry / fetchOnce). */
  timeoutMs?: number;
  /** Money-path executor options (ledger, kill switch, ops). */
  moneyPath?: MoneyPathExecutorConfig;
  storeDurability?: StoreDurability;
  /**
   * Override live detection. Production environment / production base URL
   * always forces live — cannot be overridden off.
   */
  liveMode?: boolean;
}

export const HOTELBEDS_BASE_URLS: Record<HotelbedsEnvironment, string> = {
  test: 'https://api.test.hotelbeds.com',
  production: 'https://api.hotelbeds.com',
};

// ---------------------------------------------------------------------------
// Availability — request
// ---------------------------------------------------------------------------

export interface HotelbedsAvailabilityRequest {
  stay: {
    checkIn: string; // YYYY-MM-DD
    checkOut: string; // YYYY-MM-DD
    shiftDays?: number;
    allowOnlyShift?: boolean;
  };
  occupancies: HotelbedsOccupancy[];
  destination?: { code: string; zone?: number };
  hotels?: { hotel?: number[]; keyword?: string };
  geolocation?: {
    latitude: number;
    longitude: number;
    radius: number;
    unit: 'km' | 'mi';
  };
  filter?: {
    maxRate?: number;
    minRate?: number;
    minCategory?: number;
    maxCategory?: number;
    maxRooms?: number;
    maxHotels?: number;
    paymentType?: 'AT_HOTEL' | 'AT_WEB';
    packaging?: boolean;
  };
  boards?: { included?: boolean; board?: string[] };
  rooms?: { included?: boolean; room?: string[] };
  dailyRate?: boolean;
  sourceMarket?: string;
  language?: string;
  reviews?: Array<{ type: string; maxRate: number; minRate: number; minReviewCount: number }>;
}

export interface HotelbedsOccupancy {
  rooms: number;
  adults: number;
  children: number;
  paxes?: HotelbedsPax[];
}

export interface HotelbedsPax {
  /** "AD" = adult, "CH" = child */
  type: 'AD' | 'CH';
  age?: number;
  /** 1-indexed room id when paxes are split across rooms. */
  roomId?: number;
  name?: string;
  surname?: string;
}

// ---------------------------------------------------------------------------
// Availability — response
// ---------------------------------------------------------------------------

export interface HotelbedsAvailabilityResponse {
  hotels?: {
    hotels?: HotelbedsHotel[];
    checkIn?: string;
    checkOut?: string;
    total?: number;
  };
  auditData?: HotelbedsAuditData;
}

export interface HotelbedsAuditData {
  processTime?: string;
  timestamp?: string;
  requestHost?: string;
  serverId?: string;
  environment?: string;
  release?: string;
  token?: string;
  internal?: string;
}

export interface HotelbedsHotel {
  code: number;
  name: string;
  /** Star rating code, e.g. "3EST", "5LUJ" — NOT a clean integer. */
  categoryCode?: string;
  categoryName?: string;
  destinationCode?: string;
  destinationName?: string;
  zoneCode?: number;
  zoneName?: string;
  latitude?: string;
  longitude?: string;
  /** Currency in which all rates for this hotel are expressed. */
  currency?: string;
  minRate?: string;
  maxRate?: string;
  totalNet?: string;
  /** Net cost — the bedbank's selling price to us. */
  totalSellingRate?: string;
  rooms?: HotelbedsRoom[];
  /** Free-text address — Hotelbeds does NOT split into line/city/postal here. */
  address?: string | { content?: string; street?: string; number?: string };
  postalCode?: string;
  city?: string | { content?: string };
  countryCode?: string;
  stateCode?: string;
  chainCode?: string;
  accommodationTypeCode?: string;
  boardCodes?: string[];
  segmentCodes?: number[];
}

export interface HotelbedsRoom {
  code: string;
  name?: string;
  rates?: HotelbedsRate[];
}

export interface HotelbedsRate {
  rateKey: string;
  /** "BOOKABLE" = book directly. "RECHECK" = must call /checkrates first. */
  rateType: 'BOOKABLE' | 'RECHECK';
  /** "NOR" = refundable, "NRF" = non-refundable. Other values exist. */
  rateClass?: string;
  /** Net price — the bedbank's selling price to us. String for decimal precision. */
  net: string;
  sellingRate?: string;
  hotelMandatory?: boolean;
  hotelCurrency?: string;
  hotelSellingRate?: string;
  amount?: string;
  /** Number of guests (adults + children) the rate is priced for. */
  allotment?: number;
  paymentType?: 'AT_HOTEL' | 'AT_WEB';
  packaging?: boolean;
  boardCode?: string;
  boardName?: string;
  rateBreakDown?: HotelbedsRateBreakdown;
  rateCommentsId?: string;
  cancellationPolicies?: HotelbedsCancellationPolicy[];
  taxes?: HotelbedsTaxes;
  rooms?: number;
  adults?: number;
  children?: number;
  childrenAges?: string;
  promotions?: HotelbedsPromotion[];
  offers?: HotelbedsOffer[];
  rateupMessage?: string;
}

export interface HotelbedsCancellationPolicy {
  /** Penalty amount if cancelled at or after `from`. String for decimal precision. */
  amount: string;
  /** ISO 8601 datetime — penalty applies at and after this instant. */
  from: string;
}

export interface HotelbedsTaxes {
  taxes?: HotelbedsTax[];
  /** When true, taxes are already included in the net amount. */
  allIncluded?: boolean;
}

export interface HotelbedsTax {
  included: boolean;
  percent?: string;
  amount?: string;
  currency?: string;
  type?: string;
  clientAmount?: string;
  clientCurrency?: string;
}

export interface HotelbedsRateBreakdown {
  rateDiscounts?: Array<{ code: string; name?: string; amount: string }>;
  rateSupplements?: Array<{
    code: string;
    name?: string;
    amount: string;
    chargeType?: string;
    paymentType?: string;
    from?: string;
    to?: string;
    nights?: number;
  }>;
}

export interface HotelbedsPromotion {
  code: string;
  name?: string;
  remark?: string;
}

export interface HotelbedsOffer {
  code: string;
  name?: string;
  amount?: string;
}

// ---------------------------------------------------------------------------
// CheckRate
// ---------------------------------------------------------------------------

export interface HotelbedsCheckRateRequest {
  rooms: Array<{ rateKey: string; data?: Record<string, unknown> }>;
  language?: string;
}

export interface HotelbedsCheckRateResponse {
  hotel?: HotelbedsHotel & {
    /** Possibly upgraded rates with new rateKeys after recheck. */
    rooms?: HotelbedsRoom[];
    upselling?: HotelbedsRoom[];
  };
  auditData?: HotelbedsAuditData;
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

export interface HotelbedsBookingRequest {
  holder: { name: string; surname: string };
  rooms: HotelbedsBookingRoom[];
  clientReference: string;
  /** Maximum % the price may have moved since search. Default 0 (strict). */
  tolerance?: number;
  remark?: string;
  voucher?: { language?: string; email?: HotelbedsVoucherEmail };
  paymentData?: HotelbedsPaymentData;
  language?: string;
}

export interface HotelbedsBookingRoom {
  rateKey: string;
  paxes: HotelbedsBookingPax[];
}

export interface HotelbedsBookingPax {
  /** 1-indexed room id used to attribute pax to a specific room. */
  roomId: number;
  /** "AD" = adult, "CH" = child */
  type: 'AD' | 'CH';
  age?: number;
  name: string;
  surname: string;
}

export interface HotelbedsVoucherEmail {
  to?: string;
  from?: string;
  subject?: string;
}

export interface HotelbedsPaymentData {
  paymentCard?: {
    pciToken?: string;
    cardHolderName?: string;
    cardType?: string;
    cardNumber?: string;
    expiryDate?: string;
    cardCVC?: string;
  };
  contactData?: { email?: string; phoneNumber?: string };
  billingAddress?: Record<string, string>;
}

export interface HotelbedsBookingResponse {
  booking?: HotelbedsBooking;
  auditData?: HotelbedsAuditData;
}

export interface HotelbedsBooking {
  reference: string;
  cancellationReference?: string;
  clientReference?: string;
  creationDate?: string;
  /** "CONFIRMED" | "CANCELLED" | "PENDING" — Hotelbeds status string. */
  status?: string;
  modificationPolicies?: { cancellation?: boolean; modification?: boolean };
  creationUser?: string;
  holder?: { name: string; surname: string };
  remark?: string;
  invoiceCompany?: Record<string, unknown>;
  totalNet?: string;
  totalSellingRate?: string;
  pendingAmount?: string;
  currency?: string;
  hotel?: HotelbedsHotel;
}

export interface HotelbedsBookingListResponse {
  bookings?: HotelbedsBooking[];
  auditData?: HotelbedsAuditData;
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export type HotelbedsCancellationFlag = 'SIMULATION' | 'CANCELLATION';

export interface HotelbedsCancellationResponse {
  booking?: HotelbedsBooking & { cancellationReference?: string };
  auditData?: HotelbedsAuditData;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface HotelbedsErrorResponse {
  error?: { code?: string; message?: string };
  auditData?: HotelbedsAuditData;
}
