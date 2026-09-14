/**
 * Pure, generic date-only helpers shared by domain functions that work with
 * calendar-day windows (activities, wellness, progress). Kept free of any
 * Intervals.icu/MCP concerns, like `pace.ts` and `downsample.ts`.
 *
 * IMPORTANT: "today" is timezone-sensitive. `new Date().toISOString()`
 * reports the UTC calendar date for the current instant, which is the
 * *wrong* date for part of the day in any non-UTC timezone (e.g. shortly
 * after local midnight in a positive-UTC-offset zone like
 * `Europe/Stockholm`, or shortly before local midnight in a
 * negative-UTC-offset zone). `todayDateOnly` is the one function in this
 * module that's aware of this and takes an explicit IANA timezone; every
 * other helper here is deliberately timezone-agnostic, pure UTC-component
 * arithmetic on already-resolved `"YYYY-MM-DD"` strings, so it can never
 * itself reintroduce this class of bug.
 */

/**
 * Returns the `"YYYY-MM-DD"` calendar date for `date` (an instant) as seen
 * in `timeZone` (an IANA identifier, e.g. `"Europe/Stockholm"`, `"UTC"`).
 *
 * This is the only correct way to answer "what day is it right now for the
 * athlete" — see the module doc comment for why a plain UTC conversion is
 * wrong. `date` defaults to the current instant but can be passed
 * explicitly so callers (and tests) don't depend on the system clock.
 */
export function todayDateOnly(timeZone: string, date: Date = new Date()): string {
  // "en-CA" formats as "YYYY-MM-DD" directly, so no manual reassembly of
  // year/month/day parts is needed.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Adds (or, for a negative `deltaDays`, subtracts) whole calendar days to a
 * `"YYYY-MM-DD"` date-only string, returning another `"YYYY-MM-DD"` string.
 *
 * Pure arithmetic on the parsed year/month/day components via `Date.UTC` —
 * deliberately never touches the server's local timezone, so (unlike
 * constructing a local-time `Date` and reading it back with
 * `toISOString()`) it cannot itself shift the result by a day.
 */
export function addDaysToDateOnly(dateOnly: string, deltaDays: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

/** Whether a `"YYYY-MM-DD"` date-only string falls within `[startDate, endDate]`, inclusive. */
export function isDateOnlyInRange(dateOnly: string, startDate: string, endDate: string): boolean {
  return dateOnly >= startDate && dateOnly <= endDate;
}

/**
 * Whether `value` is a genuinely valid `"YYYY-MM-DD"` calendar date —
 * correct format AND a real date (e.g. `"2026-02-30"` is rejected, not
 * silently normalized to March 2nd). Used by write-path input validation
 * (Milestone 3E's `RunningWorkoutInput.date`) where an invalid date must
 * be rejected with a clear error rather than accidentally scheduling a
 * workout on the wrong day.
 */
export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  // `Date.UTC` silently rolls over out-of-range components (e.g. month 13
  // becomes January of the next year); comparing the parsed components
  // back against the input is what actually catches that.
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
