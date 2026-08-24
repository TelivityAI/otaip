/**
 * Class of Service Mapper — Static reference data
 *
 * Carrier-specific booking class maps for major airlines plus IATA default fallback.
 * Includes loyalty earning data for UA, AA, DL.
 *
 * [NEEDS DOMAIN INPUT] Complete carrier mappings require GDS fare filing data
 * or airline distribution agreements. Community contributions welcome.
 */

import type {
  CabinClass,
  UpgradeType,
  SeatSelection,
  PriorityLevel,
  LoyaltyEarning,
  PqpEarning,
} from './types.js';

/**
 * Static definition for a single booking class within a carrier's class map.
 */
export interface BookingClassDef {
  cabin_class: CabinClass;
  cabin_brand_name: string | null;
  fare_family: string | null;
  upgrade_eligible: boolean;
  upgrade_type: UpgradeType | null;
  same_day_change: boolean;
  seat_selection: SeatSelection;
  changes_allowed: boolean;
  refundable: boolean;
  priority: PriorityLevel;
}

/**
 * Loyalty earning definition for a booking class.
 */
export interface LoyaltyEarningDef {
  program_name: string;
  rdm_percent: number;
  pqm_percent: number | null;
  pqp_earning: PqpEarning | null;
  status_earning: boolean;
}

/** Per-carrier booking class maps: carrier code -> (class letter -> definition) */
export type CarrierClassMap = Map<string, Map<string, BookingClassDef>>;

/** Per-carrier loyalty earning maps: carrier code -> (class letter -> earning def) */
export type CarrierLoyaltyMap = Map<string, Map<string, LoyaltyEarningDef>>;

// ---------------------------------------------------------------------------
// Helper to build a Map<string, BookingClassDef> from an array of entries
// ---------------------------------------------------------------------------
function classMap(entries: Array<[string[], BookingClassDef]>): Map<string, BookingClassDef> {
  const map = new Map<string, BookingClassDef>();
  for (const [classes, def] of entries) {
    for (const cls of classes) {
      map.set(cls, def);
    }
  }
  return map;
}

function loyaltyMap(entries: Array<[string[], LoyaltyEarningDef]>): Map<string, LoyaltyEarningDef> {
  const map = new Map<string, LoyaltyEarningDef>();
  for (const [classes, def] of entries) {
    for (const cls of classes) {
      map.set(cls, def);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// United Airlines (UA)
// ---------------------------------------------------------------------------
const UA_CLASSES = classMap([
  [
    ['F'],
    {
      cabin_class: 'first',
      cabin_brand_name: 'United First',
      fare_family: 'First',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['J', 'C'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'Polaris',
      fare_family: 'Business',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['D', 'Z', 'P'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'Polaris',
      fare_family: 'Business (Discounted)',
      upgrade_eligible: true,
      upgrade_type: 'instrument',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'premium',
    },
  ],
  [
    ['W'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'Premium Plus',
      fare_family: 'Premium Economy',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['Y', 'B'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Main Cabin Flexible',
      upgrade_eligible: true,
      upgrade_type: 'complimentary',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'standard',
    },
  ],
  [
    ['M', 'E', 'U', 'H', 'Q', 'V'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Main Cabin',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['K', 'L', 'S', 'T', 'G'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy (Discounted)',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: false,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['N'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Basic Economy',
      upgrade_eligible: false,
      upgrade_type: 'not_eligible',
      same_day_change: false,
      seat_selection: 'at_check_in',
      changes_allowed: false,
      refundable: false,
      priority: 'standard',
    },
  ],
]);

// ---------------------------------------------------------------------------
// American Airlines (AA)
// ---------------------------------------------------------------------------
const AA_CLASSES = classMap([
  [
    ['F', 'A'],
    {
      cabin_class: 'first',
      cabin_brand_name: 'Flagship First',
      fare_family: 'First',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['J', 'C', 'D', 'I'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'Flagship Business',
      fare_family: 'Business',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['W', 'R'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'Premium Economy',
      fare_family: 'Premium Economy',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['Y', 'M'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Main Cabin Flexible',
      upgrade_eligible: true,
      upgrade_type: 'complimentary',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'standard',
    },
  ],
  [
    ['H', 'Q', 'V', 'K', 'L', 'S', 'N', 'O'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Main Cabin',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  // Verified 2026-08-24: AA Basic Economy books in B on AA-operated flights
  // (AA SalesLink Basic Economy; aa.com AAdvantage special-fares chart lists Basic Economy (B)).
  // Codeshare Basic Economy may use a different RBD — verify fare rules per market.
  [
    ['B'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Basic Economy',
      upgrade_eligible: false,
      upgrade_type: 'not_eligible',
      same_day_change: false,
      seat_selection: 'at_check_in',
      changes_allowed: false,
      refundable: false,
      priority: 'standard',
    },
  ],
]);

// ---------------------------------------------------------------------------
// Delta Air Lines (DL)
// ---------------------------------------------------------------------------
const DL_CLASSES = classMap([
  [
    ['F', 'A'],
    {
      cabin_class: 'first',
      cabin_brand_name: 'Delta One',
      fare_family: 'First / Delta One',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['J', 'C', 'D', 'I', 'Z'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'Delta One',
      fare_family: 'Business (Delta One)',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['W', 'R'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'Delta Premium Select',
      fare_family: 'Premium Economy',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['Y', 'B', 'M', 'H'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Main Cabin',
      upgrade_eligible: true,
      upgrade_type: 'complimentary',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['Q', 'K', 'L', 'U', 'T', 'S', 'V'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy (Discounted)',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: false,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['E'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Basic Economy',
      upgrade_eligible: false,
      upgrade_type: 'not_eligible',
      same_day_change: false,
      seat_selection: 'at_check_in',
      changes_allowed: false,
      refundable: false,
      priority: 'standard',
    },
  ],
]);

// ---------------------------------------------------------------------------
// British Airways (BA)
// ---------------------------------------------------------------------------
const BA_CLASSES = classMap([
  [
    ['F', 'A'],
    {
      cabin_class: 'first',
      cabin_brand_name: 'First',
      fare_family: 'First',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['J', 'C', 'D', 'R'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'Club World',
      fare_family: 'Business (Club World)',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['W', 'E'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'World Traveller Plus',
      fare_family: 'Premium Economy',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['Y', 'B', 'H', 'K'],
    {
      cabin_class: 'economy',
      cabin_brand_name: 'World Traveller',
      fare_family: 'Economy (Flexible)',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['M', 'L', 'V', 'N', 'Q', 'O', 'G'],
    {
      cabin_class: 'economy',
      cabin_brand_name: 'World Traveller',
      fare_family: 'Economy (Restricted)',
      upgrade_eligible: false,
      upgrade_type: 'not_eligible',
      same_day_change: false,
      seat_selection: 'paid',
      changes_allowed: false,
      refundable: false,
      priority: 'standard',
    },
  ],
]);

// ---------------------------------------------------------------------------
// Lufthansa (LH)
// ---------------------------------------------------------------------------
const LH_CLASSES = classMap([
  [
    ['F', 'A'],
    {
      cabin_class: 'first',
      cabin_brand_name: 'Lufthansa First',
      fare_family: 'First',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['J', 'C', 'D', 'Z'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'Lufthansa Business',
      fare_family: 'Business',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['W', 'E'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'Premium Economy',
      fare_family: 'Premium Economy',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['Y', 'B', 'M', 'H'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy (Flexible)',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['Q', 'V', 'K', 'L', 'S', 'N', 'T', 'G'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy (Restricted)',
      upgrade_eligible: false,
      upgrade_type: 'not_eligible',
      same_day_change: false,
      seat_selection: 'paid',
      changes_allowed: false,
      refundable: false,
      priority: 'standard',
    },
  ],
]);

// ---------------------------------------------------------------------------
// Air France (AF)
// ---------------------------------------------------------------------------
// Verified 2026-08-24: No current public AF commercial merchandising map (RBD→cabin)
// found on airfrance.com / flyingblue.com. Flying Blue earn is spend-based for AF-marketed
// flights (not RBD tables). Partner earn charts (e.g. Qantas) are NOT authoritative for
// AF inventory cabin mapping.
// TODO: [NEEDS DOMAIN INPUT] Validate AF RBD→cabin against current GDS/ATPCO filings or
// an official AF trade fare-family document. Do not invent from partner earn tables.
// Re-verify: quarterly, or when AF announces branded-fare / cabin RBD changes.
const AF_CLASSES = classMap([
  [
    ['F', 'A'],
    {
      cabin_class: 'first',
      cabin_brand_name: 'La Premiere',
      fare_family: 'First',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['J', 'C', 'D', 'I', 'Z'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'Business',
      fare_family: 'Business',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['W', 'E'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'Premium Economy',
      fare_family: 'Premium Economy',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['Y', 'B', 'M', 'H', 'K'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['Q', 'V', 'L', 'S', 'N', 'T', 'G', 'O'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy (Restricted)',
      upgrade_eligible: false,
      upgrade_type: 'not_eligible',
      same_day_change: false,
      seat_selection: 'paid',
      changes_allowed: false,
      refundable: false,
      priority: 'standard',
    },
  ],
]);

// ---------------------------------------------------------------------------
// Emirates (EK)
// ---------------------------------------------------------------------------
// Verified 2026-08-24: No current public EK commercial merchandising map (RBD→cabin)
// found on emirates.com. Optional-services pages list some Economy seat-selection RBDs
// but not a full cabin merchandising matrix; Skywards calculator does not publish a
// static RBD→cabin table. Partner earn charts are NOT authoritative for EK cabin mapping
// (e.g. Qantas notes W/E earn as Flex Economy while receiving Premium Economy product).
// TODO: [NEEDS DOMAIN INPUT] Validate EK RBD→cabin against current GDS/ATPCO filings or
// an official Emirates trade fare-family document. Do not invent.
// Re-verify: quarterly, or when EK announces fare-family / Premium Economy RBD changes.
const EK_CLASSES = classMap([
  [
    ['F', 'A'],
    {
      cabin_class: 'first',
      cabin_brand_name: 'Emirates First',
      fare_family: 'First',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['J', 'C', 'D', 'I', 'Z'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'Emirates Business',
      fare_family: 'Business',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['W', 'R'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'Premium Economy',
      fare_family: 'Premium Economy',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['Y', 'B', 'M', 'H', 'K'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy (Flex)',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['Q', 'V', 'L', 'S', 'N', 'T', 'G', 'O', 'E', 'U'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy (Restricted)',
      upgrade_eligible: false,
      upgrade_type: 'not_eligible',
      same_day_change: false,
      seat_selection: 'paid',
      changes_allowed: false,
      refundable: false,
      priority: 'standard',
    },
  ],
]);

// ---------------------------------------------------------------------------
// Singapore Airlines (SQ)
// ---------------------------------------------------------------------------
// Verified 2026-08-24 against:
// - Live commercial fare-types page (singaporeair.com …/flying-withus/fare-types/):
//   Economy Lite V,K | Value Q,N | Standard M,H,W | Flexi Y,B,E;
//   PE Lite R | Standard L,P | Flexi S,T;
//   Business Lite D | Standard U | Flexi Z,C,J;
//   First/Suites F,A.
// - KrisFlyer earn FAQ (same date): Suites/First A,F; Business Z,C,J / D,U;
//   PE S,T / R,L,P; Economy B,E,Y / M,H,W / Q,N,V,K,G.
// - Dated trade PDF (issued 13 Apr 2021, eff. 22 Apr 2021): same RBD sets in Annex A
//   (developer.singaporeair.com Trade_Comms_Fare_Family_Changes-Economy_Class_eff_22_Apr_2021.pdf).
// TODO: [NEEDS DOMAIN INPUT] RBD O (and any award/group codes beyond G) — not on live
// fare-types or KrisFlyer cabin table.
// Re-verify: quarterly, or when SQ publishes fare-family trade updates.
const SQ_CLASSES = classMap([
  [
    ['F', 'A'],
    {
      cabin_class: 'first',
      cabin_brand_name: 'Suites / First',
      fare_family: 'First / Suites',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['Z', 'C', 'J'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'Business',
      fare_family: 'Business Flexi',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['U'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'Business',
      fare_family: 'Business Standard',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'premium',
    },
  ],
  [
    ['D'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'Business',
      fare_family: 'Business Lite',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'premium',
    },
  ],
  [
    ['S', 'T'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'Premium Economy',
      fare_family: 'Premium Economy Flexi',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['L', 'P'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'Premium Economy',
      fare_family: 'Premium Economy Standard',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['R'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'Premium Economy',
      fare_family: 'Premium Economy Lite',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: false,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['Y', 'B', 'E'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy Flexi',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['M', 'H', 'W'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy Standard',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['Q', 'N'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy Value',
      upgrade_eligible: false,
      upgrade_type: 'not_eligible',
      same_day_change: false,
      seat_selection: 'paid',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['V', 'K', 'G'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy Lite / Group',
      upgrade_eligible: false,
      upgrade_type: 'not_eligible',
      same_day_change: false,
      seat_selection: 'paid',
      changes_allowed: false,
      refundable: false,
      priority: 'standard',
    },
  ],
]);

// ---------------------------------------------------------------------------
// Qantas (QF)
// ---------------------------------------------------------------------------
// Verified 2026-08-24 against Qantas Frequent Flyer Earn Category tables
// (qantas.com …/earn-points/airline-earning-tables/earn-category-tables.html)
// for QF International revenue classes:
//   First AF | Business Flex CJ | Business Saver D | Business Sale I |
//   PE Flex W | PE Saver R | PE Sale T |
//   Economy Flex BHY | Economy Saver GKLMSV | Economy Sale ENOQ.
// Domestic Red e-Deal / Flex sets differ (e.g. K is Flex domestic, Saver international).
// TODO: [NEEDS DOMAIN INPUT] Classic Flight Reward RBDs (X economy, Z PE, U business, P first)
// and domestic vs international dual-use of K — map only when award/domestic path is known.
// Re-verify: quarterly, or when Qantas updates Earn Category tables.
const QF_CLASSES = classMap([
  [
    ['F', 'A'],
    {
      cabin_class: 'first',
      cabin_brand_name: 'Qantas First',
      fare_family: 'First Sale / Saver / Flex',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['C', 'J'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'Qantas Business',
      fare_family: 'Business Flex',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['D'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'Qantas Business',
      fare_family: 'Business Saver',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'premium',
    },
  ],
  [
    ['I'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'Qantas Business',
      fare_family: 'Business Sale',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'premium',
    },
  ],
  [
    ['W'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'Premium Economy',
      fare_family: 'Premium Economy Flex',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['R'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'Premium Economy',
      fare_family: 'Premium Economy Saver',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['T'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'Premium Economy',
      fare_family: 'Premium Economy Sale',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: false,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['B', 'H', 'Y'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy Flex',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['G', 'K', 'L', 'M', 'S', 'V'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy Saver',
      upgrade_eligible: false,
      upgrade_type: 'not_eligible',
      same_day_change: false,
      seat_selection: 'paid',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['E', 'N', 'O', 'Q'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy Sale',
      upgrade_eligible: false,
      upgrade_type: 'not_eligible',
      same_day_change: false,
      seat_selection: 'paid',
      changes_allowed: false,
      refundable: false,
      priority: 'standard',
    },
  ],
]);

// ---------------------------------------------------------------------------
// All Nippon Airways (NH)
// ---------------------------------------------------------------------------
// Verified 2026-08-24 against:
// - ANA Mileage Club international accrual (ana.co.jp …/amc/flightmile/int/):
//   First F,A; Business J / C,D,Z / P; Premium Economy G,E / N;
//   Economy Y,B,M / U,H,Q / V,W,S,T / L,K; not eligible O,I,R,X.
// - ANA branded-fare page (ana.co.jp …/branded-fare/): cabin labels F / C / PY / Y;
//   Economy advance-seat note uses booking-class ranges Y–Q free, V–K partly paid
//   (consistent with Economy RBD set above; does not remap PE/Business letters).
// TODO: [NEEDS DOMAIN INPUT] Domestic Japan RBD sets and award inventory (O,I,R,X).
// Re-verify: quarterly, or when ANA updates branded fares / Mileage Club accrual.
const NH_CLASSES = classMap([
  [
    ['F', 'A'],
    {
      cabin_class: 'first',
      cabin_brand_name: 'ANA First (THE Suite / THE Room)',
      fare_family: 'First',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['J'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'ANA Business (THE Room)',
      fare_family: 'Business',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['C', 'D', 'Z'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'ANA Business (THE Room)',
      fare_family: 'Business (Discounted)',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'premium',
    },
  ],
  [
    ['P'],
    {
      cabin_class: 'business',
      cabin_brand_name: 'ANA Business (THE Room)',
      fare_family: 'Business (Deep Discount)',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'premium',
    },
  ],
  [
    ['G', 'E'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'Premium Economy',
      fare_family: 'Premium Economy',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['N'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: 'Premium Economy',
      fare_family: 'Premium Economy (Discounted)',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['Y', 'B', 'M'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy (Flexible)',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['U', 'H', 'Q'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['V', 'W', 'S', 'T'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy (Restricted)',
      upgrade_eligible: false,
      upgrade_type: 'not_eligible',
      same_day_change: false,
      seat_selection: 'paid',
      changes_allowed: false,
      refundable: false,
      priority: 'standard',
    },
  ],
  [
    ['L', 'K'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy (Deep Discount)',
      upgrade_eligible: false,
      upgrade_type: 'not_eligible',
      same_day_change: false,
      seat_selection: 'paid',
      changes_allowed: false,
      refundable: false,
      priority: 'standard',
    },
  ],
]);

// ---------------------------------------------------------------------------
// IATA Default fallback (used for unknown carriers)
// ---------------------------------------------------------------------------
const IATA_DEFAULT_CLASSES = classMap([
  [
    ['F', 'P', 'A'],
    {
      cabin_class: 'first',
      cabin_brand_name: null,
      fare_family: 'First',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['J', 'C', 'D', 'I', 'Z'],
    {
      cabin_class: 'business',
      cabin_brand_name: null,
      fare_family: 'Business',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: true,
      priority: 'premium',
    },
  ],
  [
    ['W', 'R'],
    {
      cabin_class: 'premium_economy',
      cabin_brand_name: null,
      fare_family: 'Premium Economy',
      upgrade_eligible: true,
      upgrade_type: 'mileage',
      same_day_change: true,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'preferred',
    },
  ],
  [
    ['Y', 'B', 'M', 'H', 'Q', 'V', 'K', 'L', 'S', 'N', 'T', 'G', 'E', 'U', 'X', 'O'],
    {
      cabin_class: 'economy',
      cabin_brand_name: null,
      fare_family: 'Economy',
      upgrade_eligible: false,
      upgrade_type: null,
      same_day_change: false,
      seat_selection: 'included',
      changes_allowed: true,
      refundable: false,
      priority: 'standard',
    },
  ],
]);

// ---------------------------------------------------------------------------
// Carrier class map registry
// ---------------------------------------------------------------------------

/** All carrier-specific class maps, keyed by IATA carrier code */
export const CARRIER_CLASS_MAPS: CarrierClassMap = new Map<string, Map<string, BookingClassDef>>([
  ['UA', UA_CLASSES],
  ['AA', AA_CLASSES],
  ['DL', DL_CLASSES],
  ['BA', BA_CLASSES],
  ['LH', LH_CLASSES],
  ['AF', AF_CLASSES],
  ['EK', EK_CLASSES],
  ['SQ', SQ_CLASSES],
  ['QF', QF_CLASSES],
  ['NH', NH_CLASSES],
]);

/** IATA default class map (fallback for unknown carriers) */
export const IATA_DEFAULTS: Map<string, BookingClassDef> = IATA_DEFAULT_CLASSES;

// ---------------------------------------------------------------------------
// Loyalty earning data
// ---------------------------------------------------------------------------

const UA_LOYALTY = loyaltyMap([
  [
    ['F'],
    {
      program_name: 'MileagePlus',
      rdm_percent: 150,
      pqm_percent: 150,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['J', 'C'],
    {
      program_name: 'MileagePlus',
      rdm_percent: 150,
      pqm_percent: 150,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['D', 'Z', 'P'],
    {
      program_name: 'MileagePlus',
      rdm_percent: 125,
      pqm_percent: 125,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['W'],
    {
      program_name: 'MileagePlus',
      rdm_percent: 100,
      pqm_percent: 100,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['Y', 'B'],
    {
      program_name: 'MileagePlus',
      rdm_percent: 100,
      pqm_percent: 100,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['M', 'E', 'U', 'H'],
    {
      program_name: 'MileagePlus',
      rdm_percent: 100,
      pqm_percent: 100,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['Q', 'V'],
    {
      program_name: 'MileagePlus',
      rdm_percent: 75,
      pqm_percent: 75,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['K', 'L', 'S', 'T', 'G'],
    {
      program_name: 'MileagePlus',
      rdm_percent: 50,
      pqm_percent: 50,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['N'],
    {
      program_name: 'MileagePlus',
      rdm_percent: 0,
      pqm_percent: 0,
      pqp_earning: null,
      status_earning: false,
    },
  ],
]);

const AA_LOYALTY = loyaltyMap([
  [
    ['F', 'A'],
    {
      program_name: 'AAdvantage',
      rdm_percent: 150,
      pqm_percent: 150,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['J', 'C', 'D', 'I'],
    {
      program_name: 'AAdvantage',
      rdm_percent: 150,
      pqm_percent: 150,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['W', 'R'],
    {
      program_name: 'AAdvantage',
      rdm_percent: 100,
      pqm_percent: 100,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['Y', 'M'],
    {
      program_name: 'AAdvantage',
      rdm_percent: 100,
      pqm_percent: 100,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['H', 'Q', 'V'],
    {
      program_name: 'AAdvantage',
      rdm_percent: 75,
      pqm_percent: 75,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['K', 'L', 'S', 'N', 'O'],
    {
      program_name: 'AAdvantage',
      rdm_percent: 25,
      pqm_percent: 25,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['B'],
    {
      program_name: 'AAdvantage',
      rdm_percent: 0,
      pqm_percent: 0,
      pqp_earning: null,
      status_earning: false,
    },
  ],
]);

// Delta is fare-based earning (PQP = ticket price, not distance-based RDM)
const DL_LOYALTY = loyaltyMap([
  [
    ['F', 'A'],
    {
      program_name: 'SkyMiles',
      rdm_percent: 150,
      pqm_percent: null,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['J', 'C', 'D', 'I', 'Z'],
    {
      program_name: 'SkyMiles',
      rdm_percent: 150,
      pqm_percent: null,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['W', 'R'],
    {
      program_name: 'SkyMiles',
      rdm_percent: 100,
      pqm_percent: null,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['Y', 'B', 'M', 'H'],
    {
      program_name: 'SkyMiles',
      rdm_percent: 100,
      pqm_percent: null,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['Q', 'K', 'L', 'U', 'T', 'S', 'V'],
    {
      program_name: 'SkyMiles',
      rdm_percent: 75,
      pqm_percent: null,
      pqp_earning: 'fare_based',
      status_earning: true,
    },
  ],
  [
    ['E'],
    {
      program_name: 'SkyMiles',
      rdm_percent: 0,
      pqm_percent: null,
      pqp_earning: null,
      status_earning: false,
    },
  ],
]);

/** All carrier-specific loyalty earning maps */
export const CARRIER_LOYALTY_MAPS: CarrierLoyaltyMap = new Map<
  string,
  Map<string, LoyaltyEarningDef>
>([
  ['UA', UA_LOYALTY],
  ['AA', AA_LOYALTY],
  ['DL', DL_LOYALTY],
]);

/**
 * Convert a LoyaltyEarningDef to the output LoyaltyEarning type.
 */
export function toLoyaltyEarning(def: LoyaltyEarningDef): LoyaltyEarning {
  return {
    program_name: def.program_name,
    rdm_percent: def.rdm_percent,
    pqm_percent: def.pqm_percent,
    pqp_earning: def.pqp_earning,
    status_earning: def.status_earning,
  };
}
