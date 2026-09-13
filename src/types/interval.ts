/**
 * Type definitions for a single detected interval/lap within a running
 * activity, as returned by Intervals.icu's `/activity/{id}/intervals`
 * endpoint (`icu_intervals` array).
 */

/**
 * Minimal shape of one entry in Intervals.icu's `icu_intervals` array.
 *
 * Intervals.icu's real interval objects have 80+ fields (power-meter,
 * running-dynamics, weather, etc.); we only model the subset this project
 * needs. `average_speed` and `gap` are in meters/second, matching the
 * activity-level `average_speed`/`pace`/`gap` fields — never trust them as
 * pace directly, see `src/lib/running/pace.ts`.
 */
export interface IntervalsInterval {
  id: number | string;
  type: string | null;
  label: string | null;

  start_index: number | null;
  end_index: number | null;
  start_time: number | null;
  end_time: number | null;

  distance: number | null;
  moving_time: number | null;
  elapsed_time: number | null;

  average_heartrate: number | null;
  max_heartrate: number | null;
  average_cadence: number | null;
  average_speed: number | null;
  average_watts: number | null;
  total_elevation_gain: number | null;

  /** Grade-adjusted pace equivalent, in meters/second (not seconds/km). */
  gap: number | null;
  decoupling: number | null;
}

/**
 * Shape of Intervals.icu's `/activity/{id}/intervals` response. Detected
 * intervals live under `icu_intervals`; `icu_groups` (repeat-group
 * summaries) are not currently used.
 */
export interface IntervalsIntervalsResponse {
  id?: string;
  icu_intervals?: IntervalsInterval[] | null;
  icu_groups?: unknown[] | null;
}

/**
 * Our own normalized representation of a single detected interval/lap.
 *
 * `pace` is always computed from `distanceMeters` + a moving-time
 * duration (never from the raw `average_speed`). `gap` is Intervals'
 * grade-adjusted-pace, converted from meters/second to a formatted pace
 * string via the same speed-to-pace guard rails.
 */
export interface RunningInterval {
  id: string;
  type: string | null;
  label: string | null;

  startTimeSeconds: number | null;
  endTimeSeconds: number | null;
  durationSeconds: number | null;

  distanceMeters: number | null;

  paceSecondsPerKm: number | null;
  pace: string | null;

  averageHeartRate: number | null;
  maxHeartRate: number | null;

  averageCadence: number | null;
  averagePower: number | null;

  elevationGainMeters: number | null;
  /** Grade-adjusted pace, formatted like `"5:48/km"`, or `null`. */
  gap: string | null;
  decoupling: number | null;
}
