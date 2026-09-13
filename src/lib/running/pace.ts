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

/**
 * Below this speed we treat a sample as "stopped/paused" rather than a
 * real (if very slow) pace — roughly a 55 min/km walk. Prevents absurd
 * paces like "180:00/km" from a near-zero GPS/speed reading.
 */
const MIN_REALISTIC_SPEED_MPS = 0.3;

/**
 * Above this speed we treat a sample as a GPS/sensor spike rather than a
 * real sustained pace — faster than 2:00/km (world-class sprint pace),
 * implausible to sustain for a meaningful running interval.
 */
const MAX_REALISTIC_SPEED_MPS = 8.5;

/**
 * Converts a speed (meters/second) to pace (seconds/km).
 *
 * Intervals.icu often exposes speed (e.g. `average_speed`, `gap`, the
 * `velocity_smooth` stream) rather than a ready-made pace. This is the
 * single place that conversion happens, so it can guard against zero/
 * negative/non-finite speeds, paused samples, and GPS spikes consistently
 * — returning `null` rather than a nonsensical pace in those cases.
 */
export function paceSecondsPerKmFromSpeed(
  speedMetersPerSecond: number | null | undefined
): number | null {
  if (
    speedMetersPerSecond === null ||
    speedMetersPerSecond === undefined ||
    !Number.isFinite(speedMetersPerSecond) ||
    speedMetersPerSecond < MIN_REALISTIC_SPEED_MPS ||
    speedMetersPerSecond > MAX_REALISTIC_SPEED_MPS
  ) {
    return null;
  }

  return 1000 / speedMetersPerSecond;
}
