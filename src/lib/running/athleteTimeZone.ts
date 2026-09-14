/**
 * Athlete-local timezone configuration.
 *
 * Calendar-day boundaries (recent-runs / wellness / progress windows) must
 * be computed using the athlete's own local calendar date — not the
 * server's timezone, and not UTC (see `todayDateOnly` in `dates.ts` for
 * why). This is the one place that reads and validates which IANA
 * timezone to use, mirroring the read/validate/throw pattern in
 * `src/lib/intervals/auth.ts` and `src/lib/auth/config.ts`.
 *
 * This project is currently single-user/single-athlete, so a single
 * process-wide env var is enough. A future multi-user architecture will
 * need this to become a per-athlete setting instead.
 */

const DEFAULT_ATHLETE_TIME_ZONE = "Europe/Stockholm";

/** Whether `timeZone` is a value `Intl` recognizes as a valid IANA timezone identifier. */
function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    // Intl throws a RangeError for an unrecognized `timeZone`; a valid one
    // never throws, regardless of what it's later used to format.
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the configured athlete timezone from `ATHLETE_TIME_ZONE`,
 * defaulting to `"Europe/Stockholm"` when unset — this keeps the current
 * single-athlete deployment working immediately while making the
 * assumption explicit and easy to change later (e.g. per-athlete, once
 * this becomes multi-user).
 *
 * Fails loudly (throws) rather than silently falling back to UTC or the
 * server's local timezone when an invalid IANA identifier is configured —
 * silently substituting a different timezone would compute the wrong
 * calendar-day boundaries without any indication something is wrong.
 */
export function getAthleteTimeZone(): string {
  const configured = process.env.ATHLETE_TIME_ZONE?.trim();
  const timeZone = configured || DEFAULT_ATHLETE_TIME_ZONE;

  if (!isValidIanaTimeZone(timeZone)) {
    throw new Error(
      `Invalid ATHLETE_TIME_ZONE: "${timeZone}". Expected a valid IANA timezone identifier, e.g. "Europe/Stockholm".`
    );
  }

  return timeZone;
}
