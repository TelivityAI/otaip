/**
 * @otaip/connect — Standard ConnectAdapter interface and all I/O types.
 *
 * Every supplier adapter MUST implement the ConnectAdapter interface.
 * Money amounts use string representation (decimal.js in implementations).
 */

// ============================================================
// INPUT TYPES
// ============================================================

export interface SearchFlightsInput {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers: PassengerCount;
  cabinClass?: CabinClass;
  directOnly?: boolean;
  preferredAirlines?: string[];
  currency?: string;
}

export interface PassengerCount {
  adults: number;
  children?: number;
  childAges?: number[];
  infants?: number;
}

export type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';

export interface CreateBookingInput {
  offerId: string;
  passengers: PassengerDetail[];
  contact: ContactInfo;
  /**
   * Required on GuardedConnectAdapter (default createAdapter path).
   * Same key → at most one supplier side effect (DoD 2).
   */
  idempotencyKey?: string;
}

export interface PassengerDetail {
  type: 'adult' | 'child' | 'infant';
  gender: 'M' | 'F';
  title?: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  dateOfBirth: string;
  passportNumber?: string;
  passportExpiry?: string;
  passportCountry?: string;
  nationality?: string;
}

export interface ContactInfo {
  email: string;
  phone: string;
  alternatePhone?: string;
}

// ============================================================
// OUTPUT TYPES
// ============================================================

export interface FlightOffer {
  offerId: string;
  supplier: string;
  validatingCarrier: string;
  validatingCarrierName?: string;
  segments: FlightSegment[][];
  fares: FareBreakdown[];
  totalPrice: MoneyAmount;
  fareType: 'published' | 'negotiated' | 'private' | 'net';
  cabinClass: CabinClass;
  refundable: boolean;
  changeable: boolean;
  baggageAllowance?: string;
  expiresAt?: string;
  raw?: unknown;
}

export interface FlightSegment {
  origin: string;
  destination: string;
  marketingCarrier: string;
  operatingCarrier?: string;
  flightNumber: string;
  departure: string;
  arrival: string;
  duration?: string;
  cabinClass: string;
  bookingClass: string;
  fareBasisCode?: string;
  equipment?: string;
  stops: number;
  stopLocations?: string[];
}

export interface FareBreakdown {
  passengerType: 'adult' | 'child' | 'infant';
  baseFare: MoneyAmount;
  taxes: MoneyAmount;
  fees?: MoneyAmount;
  total: MoneyAmount;
  count: number;
}

export interface MoneyAmount {
  amount: string;
  currency: string;
}

export interface PricedItinerary {
  offerId: string;
  supplier: string;
  totalPrice: MoneyAmount;
  fares: FareBreakdown[];
  fareRules: FareRules;
  priceChanged: boolean;
  available: boolean;
  raw?: unknown;
}

export interface FareRules {
  refundable: boolean;
  changeable: boolean;
  refundPenalty?: MoneyAmount;
  changePenalty?: MoneyAmount;
  refundPolicy?: string;
  changePolicy?: string;
  noShowPenalty?: MoneyAmount;
}

export interface BookingResult {
  bookingId: string;
  supplier: string;
  status: BookingStatus;
  paymentLink?: string;
  paymentDeadline?: string;
  pnr?: string;
  segments: FlightSegment[][];
  passengers: PassengerDetail[];
  totalPrice: MoneyAmount;
  raw?: unknown;
}

export type BookingStatus =
  | 'held'
  | 'payment_pending'
  | 'confirmed'
  | 'ticketed'
  | 'cancelled'
  | 'failed';

export interface BookingStatusResult {
  bookingId: string;
  supplier: string;
  status: BookingStatus;
  pnr?: string;
  airlinePnr?: string;
  ticketNumbers?: string[];
  segments: FlightSegment[][];
  passengers: PassengerDetail[];
  totalPrice: MoneyAmount;
  raw?: unknown;
}

// ============================================================
// ADAPTER INTERFACE
// ============================================================

export interface ConnectAdapter {
  readonly supplierId: string;
  readonly supplierName: string;

  searchFlights(input: SearchFlightsInput): Promise<FlightOffer[]>;
  priceItinerary(offerId: string, passengers: PassengerCount): Promise<PricedItinerary>;
  createBooking(input: CreateBookingInput): Promise<BookingResult>;
  getBookingStatus(bookingId: string): Promise<BookingStatusResult>;
  requestTicketing?(bookingId: string): Promise<BookingStatusResult>;
  cancelBooking?(bookingId: string): Promise<{ success: boolean; message: string }>;
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;
}

// ============================================================
// WHITE-LABEL CONFIG
// ============================================================

export interface WhiteLabelConfig {
  brandName: string;
  companyDescription?: string;
  supportEmail?: string;
  logoUrl?: string;
  customInstructions?: string[];
}
