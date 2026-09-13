/**
 * Pure, reusable pace calculation helpers.
 *
 * Kept free of any Intervals.icu or MCP concerns so they can be unit tested
 * in isolation and reused by future milestones (e.g. workout planning).
 */

/**
 * Calculates pace in seconds per kilometer.
 *
 * Returns `null` when distance or moving time is missing, zero, or
 * negative, since pace is not meaningful in those cases.
 */
export function calculatePaceSecondsPerKm(
  movingTimeSeconds: number | null | undefined,
  distanceKm: number | null | undefined
): number | null {
  if (
    movingTimeSeconds === null ||
    movingTimeSeconds === undefined ||
    distanceKm === null ||
    distanceKm === undefined
  ) {
    return null;
  }

  if (movingTimeSeconds <= 0 || distanceKm <= 0) {
    return null;
  }

  return movingTimeSeconds / distanceKm;
}

/**
 * Formats a pace given in seconds per kilometer as "M:SS/km".
 *
 * Returns `null` when the input is missing or not a finite positive number.
 */
export function formatPace(paceSecondsPerKm: number | null | undefined): string | null {
  if (
    paceSecondsPerKm === null ||
    paceSecondsPerKm === undefined ||
    !Number.isFinite(paceSecondsPerKm) ||
    paceSecondsPerKm <= 0
  ) {
    return null;
  }

  const totalSeconds = Math.round(paceSecondsPerKm);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}/km`;
}

/** Converts a distance in meters to kilometers. */
export function metersToKm(meters: number | null | undefined): number | null {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) {
    return null;
  }

  return meters / 1000;
}
