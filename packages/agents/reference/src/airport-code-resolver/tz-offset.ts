/**
 * UTC offset derivation for Airport Code Resolver.
 *
 * Derives a `±HH:MM` UTC offset from an IANA timezone name (e.g.
 * "America/New_York") using the built-in `Intl.DateTimeFormat` — no external
 * timezone library. Because the offset is computed for a specific instant, DST
 * is handled automatically: the same timezone yields a different offset in
 * summer vs winter.
 */

/**
 * Derive the UTC offset for an IANA timezone at a given instant.
 *
 * @param timeZone - IANA timezone name (e.g. "America/New_York", "Asia/Kolkata").
 * @param at - Instant to evaluate the offset at. Defaults to now. Pass an
 *   explicit date to get a DST-correct offset for a specific season.
 * @returns Offset string like "+05:30", "-08:00", or "+00:00"; `null` if the
 *   timezone is empty/invalid.
 */
export function deriveUtcOffset(timeZone: string | null | undefined, at: Date = new Date()): string | null {
  if (!timeZone) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(at);

    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (!tzName) return null;

    // "longOffset" yields e.g. "GMT+05:30", "GMT-08:00", or bare "GMT" for UTC.
    const match = tzName.match(/GMT([+-]\d{2}:\d{2})/);
    if (match) return match[1]!;
    if (/^GMT$/.test(tzName) || /^UTC$/.test(tzName)) return '+00:00';

    return null;
  } catch {
    // Invalid timezone name → RangeError from Intl.
    return null;
  }
}
