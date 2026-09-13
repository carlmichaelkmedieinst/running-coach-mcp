/**
 * Type definitions for activity data.
 *
 * `IntervalsActivity` mirrors the (partial) shape of Intervals.icu's raw API
 * response. `RunningActivity` is our own normalized domain model that the
 * rest of the app (and MCP tools) should depend on instead.
 */

/**
 * Minimal shape of an activity as returned by the Intervals.icu
 * `/athlete/{id}/activities` endpoint.
 *
 * Intervals.icu returns 150+ fields per activity; we only model the subset
 * this project currently needs. Every field besides `id` is treated as
 * possibly missing/null, since not all activities (or activity types)
 * populate every field.
 */
export interface IntervalsActivity {
  id: string;
  name: string | null;
  type: string | null;
  start_date_local: string | null;
  start_date: string | null;
  distance: number | null;
  moving_time: number | null;
  elapsed_time: number | null;
  total_elevation_gain: number | null;
  average_speed: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  average_cadence: number | null;
  icu_training_load: number | null;
  icu_intensity: number | null;
  icu_ctl: number | null;
  icu_atl: number | null;
  icu_rpe: number | null;
  perceived_exertion: number | null;
  feel: number | null;
  source: string | null;
  decoupling: number | null;
}

/**
 * Our own normalized representation of a running activity.
 *
 * This is the shape returned by domain functions (e.g. `getRecentRuns`) and
 * exposed via MCP tools. MCP-specific code should only ever depend on this
 * type, never on `IntervalsActivity` directly, so the upstream provider can
 * change or be swapped without touching the MCP layer.
 */
export interface RunningActivity {
  id: string;
  date: string;
  name: string | null;

  distanceKm: number;
  movingTimeSeconds: number;
  elapsedTimeSeconds: number | null;

  paceSecondsPerKm: number | null;
  pace: string | null;

  averageHeartRate: number | null;
  maxHeartRate: number | null;

  elevationGainMeters: number | null;
  averageCadence: number | null;

  trainingLoad: number | null;
  intensity: number | null;

  fitness: number | null;
  fatigue: number | null;

  rpe: number | null;
  feel: number | null;

  decoupling: number | null;
  source: string | null;
}
