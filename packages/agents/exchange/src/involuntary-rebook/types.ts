/**
 * Involuntary Rebook — Types
 *
 * Agent 5.3: Carrier-initiated schedule change handling, protection logic,
 * regulatory entitlements.
 *
 * Domain authority: docs/knowledge-base/involuntary-rebook-irrop.md
 * EU261 text: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32004R0261
 */

/** Delay / disruption measurement reference for carrier IRROP thresholds. */
export type IrropMeasurementPoint = 'DEPARTURE' | 'ARRIVAL';

export type InvoluntaryTrigger =
  | 'TIME_CHANGE'
  | 'ROUTING_CHANGE'
  | 'EQUIPMENT_DOWNGRADE'
  | 'FLIGHT_CANCELLATION'
  | 'MISCONNECT'
  | 'NO_SHOW';

/**
 * Reprotection candidate ranking (pattern). Not a silent auto-rebook order —
 * under EU261 Art.8 the passenger chooses reimbursement vs re-routing first.
 * Alliance ≠ any alliance flight; endorsement constraints apply.
 */
export type ProtectionPath =
  | 'SAME_OPERATING'
  | 'MARKETING_CARRIER'
  | 'ALLIANCE_PARTNER'
  | 'INTERLINE'
  | 'OTHER'
  | 'NONE_AVAILABLE';

/** @deprecated Prefer SAME_OPERATING — retained only as a mapping alias in callers. */
export type LegacyProtectionPath = 'SAME_CARRIER';

export type RegulatoryFramework = 'EU261' | 'US_DOT';

/** EU261 Art.8(1) choices — passenger must be offered these when jurisdiction applies. */
export type Art8Choice = 'REIMBURSEMENT' | 'REROUTING_EARLIEST' | 'REROUTING_LATER';

export interface ScheduleChangeNotification {
  /** Type of change */
  change_type:
    | 'TIME_CHANGE'
    | 'ROUTING_CHANGE'
    | 'EQUIPMENT_DOWNGRADE'
    | 'FLIGHT_CANCELLATION'
    | 'MISCONNECT';
  /** Original departure time (HH:MM) */
  original_departure_time?: string;
  /** New departure time (HH:MM) */
  new_departure_time?: string;
  /**
   * Absolute minutes of change relative to the carrier's measurement point
   * (departure or arrival). Caller must supply thresholds.measurement_point
   * so the engine knows which clock this number refers to.
   */
  time_change_minutes?: number;
  /** Original routing (airport codes) */
  original_routing?: string[];
  /** New routing (airport codes) */
  new_routing?: string[];
  /** Original equipment type */
  original_equipment?: string;
  /** New equipment type */
  new_equipment?: string;
  /** Whether original was widebody */
  original_is_widebody?: boolean;
  /** Whether new is widebody */
  new_is_widebody?: boolean;
  /** Carrier-provided reason */
  carrier_reason?: string;
  /**
   * For MISCONNECT: minutes by which the connection falls short of MCT
   * (or inbound arrival delay causing the break). Carrier MCT required
   * separately via thresholds — see KB DQ-IRROP-2.
   */
  misconnect_shortfall_minutes?: number;
}

export interface OriginalPnrSummary {
  /** Record locator */
  record_locator: string;
  /** Passenger name (LAST/FIRST) */
  passenger_name: string;
  /** Affected segment */
  affected_segment: {
    carrier: string;
    flight_number: string;
    origin: string;
    destination: string;
    departure_date: string;
    departure_time: string;
    booking_class: string;
    fare_basis: string;
    /** Operating carrier if codeshare; defaults to marketing `carrier` when omitted. */
    operating_carrier?: string;
  };
  /** Issuing carrier (for the ticket) */
  issuing_carrier: string;
  /** Departure country (ISO 2-letter) */
  departure_country: string;
  /** Arrival country (ISO 2-letter) */
  arrival_country: string;
  /** Whether passenger checked in */
  is_checked_in: boolean;
  /**
   * Whether the *operating* air carrier is a Community (EU/EEA) carrier
   * under Art.3(1)(b). Required for third-country→EU applicability.
   */
  is_eu_carrier: boolean;
  /**
   * Ticket endorsement text (e.g. "VALID BA ONLY"). When present, non–same-
   * operating candidates need explicit endorsement_allows from the caller.
   */
  endorsement?: string;
}

export interface ProtectionFlightOption {
  carrier: string;
  flight_number: string;
  departure_date: string;
  departure_time: string;
  booking_class: string;
  /** Same operating carrier as the disrupted segment. */
  is_same_operating_carrier?: boolean;
  /**
   * Marketing-carrier codeshare / plate option (not the operating carrier).
   * Ranked after same operating, before alliance.
   */
  is_marketing_carrier?: boolean;
  /**
   * Legacy flag — treated as same operating when finer flags are absent.
   * Prefer is_same_operating_carrier.
   */
  is_same_carrier?: boolean;
  is_alliance_partner: boolean;
  is_interline: boolean;
  /**
   * Whether ticket endorsement / reprotection agreement permits this flight.
   * Required (fail-closed) for any candidate that is not same-operating:
   * omit → excluded + DOMAIN_INPUT_REQUIRED. Same-operating may omit (defaults true).
   */
  endorsement_allows?: boolean;
}

export interface ProtectionOption {
  /** Protection path ranking tier */
  path: ProtectionPath;
  /** Carrier code */
  carrier: string;
  /** Flight number */
  flight_number: string;
  /** Departure date */
  departure_date: string;
  /** Departure time */
  departure_time: string;
  /** Booking class */
  booking_class: string;
  /** Notes */
  notes: string;
}

export interface RegulatoryFlag {
  /** Regulatory framework */
  framework: RegulatoryFramework;
  /** Whether it applies */
  applies: boolean;
  /** Reason */
  reason: string;
  /**
   * For EU261: computed compensation per passenger when all required inputs
   * are available. Null when applies=true but compensation cannot be
   * computed (missing distance/delay/etc) — see `missing_inputs`.
   * Amounts come from Regulation Art.7 via @otaip/core applyEU261 — never invented.
   */
  compensation_eur?: string | null;
  /** For EU261 reductions (e.g. Art.7(2) 50% when re-routing within band). */
  reduction_percent?: number;
  /**
   * Names of required inputs that were not supplied, preventing
   * computation. See @otaip/core domain/types.ts.
   */
  missing_inputs?: string[];
}

export interface InvoluntaryRebookResult {
  /** Whether this qualifies as involuntary */
  is_involuntary: boolean;
  /** Trigger type */
  trigger: InvoluntaryTrigger;
  /** Whether the passenger was a no-show */
  is_no_show: boolean;
  /** Protection candidates (ordered by hierarchy). Not an executed rebook. */
  protection_options: ProtectionOption[];
  /**
   * Highest-ranked eligible candidate path, or NONE_AVAILABLE.
   * Under Art.8 this is a candidate ranking hint — not a silent selection.
   */
  protection_path: ProtectionPath;
  /**
   * True when EU261 applies: Art.8 requires offering reimbursement vs
   * re-routing choice before any reprotection is executed.
   */
  art8_passenger_choice_required: boolean;
  /** Art.8(1) choices to offer when art8_passenger_choice_required. */
  art8_choices: Art8Choice[];
  /** Measurement point used for TIME_CHANGE / MISCONNECT when supplied. */
  measurement_point?: IrropMeasurementPoint;
  /** Regulatory entitlement flags */
  regulatory_flags: RegulatoryFlag[];
  /** Original routing credit: passenger retains original fare basis */
  original_routing_credit: boolean;
  /** Human-readable summary */
  summary: string;
}

export interface InvoluntaryRebookInput {
  /** Original PNR summary */
  original_pnr: OriginalPnrSummary;
  /** Schedule change notification */
  schedule_change: ScheduleChangeNotification;
  /** Available protection flights (from search) — candidates only */
  available_flights?: ProtectionFlightOption[];
  /**
   * Involuntary trigger thresholds. NO defaults — different carriers define
   * IRROP triggers differently (60min, 90min, any misconnect). The trigger
   * may be based on departure delay or arrival delay. Caller must supply
   * the carrier-specific threshold. If absent, the engine fail-closes:
   * non-involuntary + DOMAIN_INPUT_REQUIRED warning.
   *
   * // TODO: DOMAIN_QUESTION: DQ-IRROP-1 per-carrier IRROP threshold catalogue
   */
  thresholds?: {
    /** Minutes of time change that triggers involuntary. REQUIRED for TIME_CHANGE. */
    time_change_minutes?: number;
    /**
     * Whether time_change_minutes is measured on departure or arrival.
     * REQUIRED for TIME_CHANGE — carriers differ; do not assume.
     */
    measurement_point?: IrropMeasurementPoint;
    /**
     * Minutes of connection shortfall (vs carrier MCT) that triggers MISCONNECT.
     * REQUIRED for MISCONNECT assessment.
     */
    misconnect_minutes?: number;
    /** Hours within which same carrier must be available. */
    same_carrier_window_hours?: number;
  };
  /** Whether passenger missed original flight (no-show) */
  is_passenger_no_show?: boolean;
  /**
   * True only for involuntary denied boarding due to oversales (14 CFR §250).
   * Delays/cancellations must leave this false/omit — IDB does not apply.
   */
  is_oversale_denied_boarding?: boolean;
  /**
   * Inputs required to compute EU261 compensation. When omitted but EU261
   * applies, the regulatory flag is set with `compensation_eur: null` and
   * `missing_inputs` listing what is needed.
   *
   * distance_km MUST be great-circle (Art.7(4)) — never TPM.
   */
  eu261_inputs?: {
    /** Great-circle distance origin → final destination (km). Art.7(4) — NOT TPM. */
    distance_km?: number;
    /** Arrival delay at the FINAL destination, in hours. */
    arrival_delay_hours?: number;
    /** Carrier asserts extraordinary circumstances exemption. */
    extraordinary_circumstances?: boolean;
    /** For cancellations: how many days before departure was the passenger notified? */
    notice_days_before_departure?: number;
    /** Article 7(2): carrier offered rerouting whose arrival is within band threshold. */
    rerouting_offered?: boolean;
    /** Hours by which rerouted arrival exceeds original scheduled arrival. */
    rerouting_arrival_lateness_hours?: number;
    /**
     * Art.3(1)(b): passenger already received benefits/compensation/assistance
     * in the third country of departure. When true, EU261 does not apply on
     * the inbound Community-carrier leg.
     */
    third_country_benefits_already_received?: boolean;
  };
}

export interface InvoluntaryRebookOutput {
  /** Rebook result */
  result: InvoluntaryRebookResult;
}
