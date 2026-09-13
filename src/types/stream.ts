/**
 * Type definitions for activity time-series data ("streams"), as returned
 * by Intervals.icu's `/activity/{id}/streams.json` endpoint.
 */

/**
 * One entry in Intervals.icu's `streams.json` response array.
 *
 * Each stream is independently typed and index-aligned with the others
 * (the Nth entry of every stream's `data` array corresponds to the same
 * sample instant). Common `type` values include `time`, `distance`,
 * `heartrate`, `cadence`, `watts`, `altitude`, `velocity_smooth`, and
 * `latlng`; not every activity has every type — see the activity's
 * `stream_types` field.
 */
export interface IntervalsStream {
  type: string;
  data: Array<number | null> | null;
}

/**
 * One normalized, per-instant sample from a running activity's streams.
 *
 * `pace` is derived from a speed stream (never a dedicated "pace" stream,
 * which Intervals.icu doesn't provide) via
 * `paceSecondsPerKmFromSpeed`, guarding against stops/pauses and GPS
 * spikes. All metrics are `null` when the underlying stream is missing
 * for this activity.
 */
export interface RunningStreamPoint {
  elapsedSeconds: number | null;
  distanceMeters: number | null;
  paceSecondsPerKm: number | null;
  pace: string | null;
  heartRate: number | null;
  cadence: number | null;
  power: number | null;
  altitude: number | null;
}

/**
 * Normalized, size-bounded response for `getRunStreams`.
 *
 * `points` is downsampled (deterministic bucket sampling, never random)
 * to at most the requested `maxPoints` so MCP responses stay small even
 * for multi-hour activities recorded at 1Hz.
 */
export interface RunningStreamsResult {
  activityId: string;
  originalPointCount: number;
  returnedPointCount: number;
  /** Average seconds between returned points, or `null` if it can't be determined. */
  samplingIntervalSeconds: number | null;
  availableStreams: string[];
  points: RunningStreamPoint[];
}
