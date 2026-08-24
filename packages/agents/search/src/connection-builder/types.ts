/**
 * Connection Builder — Input/Output types
 *
 * Agent 1.3: Validates connections against MCT rules,
 * scores connection quality, and checks interline agreements.
 */

import type { FlightSegment } from '@otaip/core';

export type ConnectionType = 'domestic' | 'international' | 'mixed';
export type TerminalChangeType = 'same' | 'different' | 'unknown';

export interface ConnectionBuilderInput {
  /** Arriving flight segment */
  arriving_segment: FlightSegment;
  /** Departing flight segment */
  departing_segment: FlightSegment;
  /** Connection airport IATA code */
  connection_airport: string;
  /** Whether passengers have checked bags (affects MCT) */
  has_checked_bags?: boolean;
  /** Whether this is an interline connection (different carriers) */
  is_interline?: boolean;
}

export interface MctRule {
  /** Airport IATA code */
  airport: string;
  /** Connection type */
  connection_type: ConnectionType;
  /** Minimum connection time in minutes */
  minutes: number;
  /** Terminal change type */
  terminal_change?: TerminalChangeType;
  /** Specific arriving carrier (null = any) */
  arriving_carrier?: string;
  /** Specific departing carrier (null = any) */
  departing_carrier?: string;
}

export interface ConnectionValidation {
  /** Whether the connection meets MCT requirements (false when MCT unresolved / fail-closed) */
  valid: boolean;
  /** Available connection time in minutes */
  available_minutes: number;
  /**
   * Required MCT in minutes, or null when no curated MCT row matched (fail-closed).
   * Never invent a substitute minutes value when null.
   */
  required_mct_minutes: number | null;
  /** Buffer time (available - required); null when MCT unresolved */
  buffer_minutes: number | null;
  /** MCT rule that was applied (includes mct-unavailable:… when fail-closed) */
  applied_rule: string;
  /** Connection type classification */
  connection_type: ConnectionType;
}

export interface ConnectionQuality {
  /** Overall quality score 0.0 - 1.0 */
  score: number;
  /** Quality factors breakdown */
  factors: QualityFactor[];
}

export interface QualityFactor {
  /** Factor name */
  name: string;
  /** Factor score 0.0 - 1.0 */
  score: number;
  /** Description */
  description: string;
}

export interface InterlineCheck {
  /** Whether the carriers have an interline agreement */
  interline_allowed: boolean;
  /** Whether they are in the same alliance */
  same_alliance: boolean;
  /** Alliance name if same alliance */
  alliance?: string;
}

export interface ConnectionBuilderOutput {
  /** MCT validation result */
  validation: ConnectionValidation;
  /** Connection quality score */
  quality: ConnectionQuality;
  /** Interline check (if different carriers) */
  interline: InterlineCheck | null;
  /** Warnings about the connection */
  warnings: string[];
}
