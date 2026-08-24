/**
 * Connection quality scoring.
 *
 * Scores connections on a 0.0 - 1.0 scale based on multiple factors:
 * - Connection time (too short = risky, too long = inconvenient)
 * - Same carrier preference
 * - Same alliance preference
 * - Terminal change penalty
 */

import type { QualityFactor } from './types.js';

export interface ScoringInput {
  availableMinutes: number;
  /** Null when MCT unresolved (fail-closed) — connection_time scores 0 */
  requiredMctMinutes: number | null;
  sameCarrier: boolean;
  sameAlliance: boolean;
  terminalChange: boolean;
}

/**
 * Score connection time on a bell curve:
 * - Below MCT: 0
 * - At MCT: 0.3
 * - MCT + 30min: 0.9
 * - MCT + 60min: 1.0
 * - MCT + 120min: 0.8
 * - MCT + 240min: 0.5
 * - > 6 hours: 0.2
 */
function scoreConnectionTime(available: number, mct: number): number {
  if (available < mct) return 0;

  const buffer = available - mct;

  if (buffer <= 60) {
    // Ramp up from 0.3 at MCT to 1.0 at MCT+60
    return 0.3 + (buffer / 60) * 0.7;
  }

  if (buffer <= 120) {
    // Slight decrease: 1.0 → 0.8
    return 1.0 - ((buffer - 60) / 60) * 0.2;
  }

  if (buffer <= 240) {
    // Further decrease: 0.8 → 0.5
    return 0.8 - ((buffer - 120) / 120) * 0.3;
  }

  // Beyond 4 hours over MCT
  return Math.max(0.2, 0.5 - ((buffer - 240) / 240) * 0.3);
}

export function scoreConnection(input: ScoringInput): {
  score: number;
  factors: QualityFactor[];
} {
  const factors: QualityFactor[] = [];

  // Factor 1: Connection time (weight: 0.4)
  const mct = input.requiredMctMinutes;
  const timeScore = mct === null ? 0 : scoreConnectionTime(input.availableMinutes, mct);
  factors.push({
    name: 'connection_time',
    score: timeScore,
    description:
      mct === null
        ? 'MCT unavailable (fail-closed) — no curated SSIM row'
        : timeScore === 0
          ? `${input.availableMinutes}min < ${mct}min MCT - illegal connection`
          : `${input.availableMinutes}min available, ${mct}min required`,
  });

  // Factor 2: Same carrier (weight: 0.25)
  const carrierScore = input.sameCarrier ? 1.0 : 0.5;
  factors.push({
    name: 'carrier_alignment',
    score: carrierScore,
    description: input.sameCarrier ? 'Same carrier' : 'Different carriers',
  });

  // Factor 3: Alliance alignment (weight: 0.2)
  const allianceScore = input.sameAlliance ? 1.0 : input.sameCarrier ? 1.0 : 0.3;
  factors.push({
    name: 'alliance_alignment',
    score: allianceScore,
    description: input.sameAlliance ? 'Same alliance' : 'Different alliances',
  });

  // Factor 4: Terminal change (weight: 0.15)
  const terminalScore = input.terminalChange ? 0.4 : 1.0;
  factors.push({
    name: 'terminal_change',
    score: terminalScore,
    description: input.terminalChange ? 'Terminal change required' : 'Same terminal or unknown',
  });

  // Weighted average
  const weights = [0.4, 0.25, 0.2, 0.15];
  const totalScore = factors.reduce((sum, f, i) => sum + f.score * weights[i]!, 0);

  return {
    score: Math.round(totalScore * 100) / 100,
    factors,
  };
}
