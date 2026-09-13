/**
 * Pure conversion from Intervals.icu's raw activity shape to our own
 * normalized `RunningActivity` domain model.
 *
 * No other module should reach into `IntervalsActivity` fields directly —
 * everything downstream (domain functions, MCP tools) should depend on
 * `RunningActivity` instead. This keeps the raw provider shape isolated to
 * a single, small file.
 */

import {
  calculatePaceSecondsPerKm,
  formatPace,
  metersToKm,
  paceSecondsPerKmFromSpeed,
} from "@/lib/running/pace";
import type { IntervalsActivity, RunningActivity, RunningActivityDetail } from "@/types/activity";
import type { IntervalsInterval, RunningInterval } from "@/types/interval";
import type { IntervalsStream, RunningStreamPoint } from "@/types/stream";

/** Intervals.icu activity `type` values that we consider "a run". */
export const RUNNING_ACTIVITY_TYPES = ["Run", "TrailRun", "VirtualRun"] as const;

export type RunningActivityType = (typeof RUNNING_ACTIVITY_TYPES)[number];

/** Whether an Intervals.icu activity type should be treated as a run. */
export function isRunningActivityType(type: string | null | undefined): boolean {
  if (!type) {
    return false;
  }

  return (RUNNING_ACTIVITY_TYPES as readonly string[]).includes(type);
}

/**
 * Converts a raw Intervals.icu activity into our normalized
 * `RunningActivity` shape, calculating pace ourselves along the way.
 */
export function normalizeActivity(raw: IntervalsActivity): RunningActivity {
  const distanceKm = metersToKm(raw.distance) ?? 0;
  const movingTimeSeconds = raw.moving_time ?? 0;

  const paceSecondsPerKm = calculatePaceSecondsPerKm(movingTimeSeconds, distanceKm);

  return {
    id: raw.id,
    date: raw.start_date_local ?? raw.start_date ?? "",
    name: raw.name ?? null,

    distanceKm,
    movingTimeSeconds,
    elapsedTimeSeconds: raw.elapsed_time ?? null,

    paceSecondsPerKm,
    pace: formatPace(paceSecondsPerKm),

    averageHeartRate: raw.average_heartrate ?? null,
    maxHeartRate: raw.max_heartrate ?? null,

    elevationGainMeters: raw.total_elevation_gain ?? null,
    averageCadence: raw.average_cadence ?? null,

    trainingLoad: raw.icu_training_load ?? null,
    intensity: raw.icu_intensity ?? null,

    fitness: raw.icu_ctl ?? null,
    fatigue: raw.icu_atl ?? null,

    rpe: raw.icu_rpe ?? raw.perceived_exertion ?? null,
    feel: raw.feel ?? null,

    decoupling: raw.decoupling ?? null,
    source: raw.source ?? null,
  };
}

/**
 * Converts a raw Intervals.icu interval/lap into our normalized
 * `RunningInterval` shape.
 *
 * Pace is always computed from `distance` + moving time (never the raw
 * `average_speed`, which is in meters/second, not seconds/km). `gap`
 * (grade-adjusted pace) is also exposed in meters/second upstream, so it
 * goes through the same speed-to-pace conversion as streams.
 */
export function normalizeInterval(raw: IntervalsInterval): RunningInterval {
  const distanceMeters = raw.distance ?? null;
  // Prefer moving time for the pace calculation (consistent with
  // `normalizeActivity`); fall back to elapsed time if moving time is
  // unavailable for this interval.
  const durationSeconds = raw.moving_time ?? raw.elapsed_time ?? null;

  const distanceKm = metersToKm(distanceMeters);
  const paceSecondsPerKm = calculatePaceSecondsPerKm(durationSeconds, distanceKm);
  const gapPaceSecondsPerKm = paceSecondsPerKmFromSpeed(raw.gap);

  return {
    id: String(raw.id),
    type: raw.type ?? null,
    label: raw.label ?? null,

    startTimeSeconds: raw.start_time ?? null,
    endTimeSeconds: raw.end_time ?? null,
    durationSeconds,

    distanceMeters,

    paceSecondsPerKm,
    pace: formatPace(paceSecondsPerKm),

    averageHeartRate: raw.average_heartrate ?? null,
    maxHeartRate: raw.max_heartrate ?? null,

    averageCadence: raw.average_cadence ?? null,
    averagePower: raw.average_watts ?? null,

    elevationGainMeters: raw.total_elevation_gain ?? null,
    gap: formatPace(gapPaceSecondsPerKm),
    decoupling: raw.decoupling ?? null,
  };
}

/**
 * Converts a raw Intervals.icu activity + its raw intervals into our
 * normalized `RunningActivityDetail` shape. Builds on `normalizeActivity`
 * rather than duplicating its field mapping.
 */
export function normalizeActivityDetail(
  raw: IntervalsActivity,
  rawIntervals: IntervalsInterval[]
): RunningActivityDetail {
  const base = normalizeActivity(raw);

  return {
    ...base,
    type: raw.type ?? null,
    averagePower: raw.icu_average_watts ?? raw.icu_weighted_avg_watts ?? null,
    availableStreams: raw.stream_types ?? [],
    intervals: rawIntervals.map(normalizeInterval),
  };
}

/** Returns `value` if it is a finite number, otherwise `null`. */
function numericOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

/**
 * Converts Intervals.icu's `/activity/{id}/streams.json` response — an
 * array of independently-typed, index-aligned streams — into an array of
 * per-instant `RunningStreamPoint`s, plus which stream types were
 * actually present.
 *
 * Missing stream types simply leave the corresponding field `null` on
 * every point rather than failing; the point count is driven by whichever
 * present stream is longest, so a missing `time` stream (for example)
 * doesn't discard other available data.
 */
export function buildStreamPoints(rawStreams: IntervalsStream[]): {
  points: RunningStreamPoint[];
  availableStreams: string[];
} {
  const byType = new Map<string, Array<number | null>>();

  for (const stream of rawStreams ?? []) {
    if (stream && typeof stream.type === "string" && Array.isArray(stream.data)) {
      byType.set(stream.type, stream.data);
    }
  }

  const availableStreams = Array.from(byType.keys());

  const timeData = byType.get("time");
  const distanceData = byType.get("distance");
  const heartrateData = byType.get("heartrate");
  const cadenceData = byType.get("cadence");
  const wattsData = byType.get("watts");
  const altitudeData = byType.get("altitude") ?? byType.get("fixed_altitude");
  // Intervals.icu doesn't provide a dedicated "pace" stream; derive it
  // from smoothed speed instead.
  const speedData = byType.get("velocity_smooth") ?? byType.get("speed");

  const pointCount = Math.max(
    timeData?.length ?? 0,
    distanceData?.length ?? 0,
    heartrateData?.length ?? 0,
    cadenceData?.length ?? 0,
    wattsData?.length ?? 0,
    altitudeData?.length ?? 0,
    speedData?.length ?? 0
  );

  const points: RunningStreamPoint[] = [];

  for (let i = 0; i < pointCount; i++) {
    const speed = numericOrNull(speedData?.[i]);
    const paceSecondsPerKm = paceSecondsPerKmFromSpeed(speed);

    points.push({
      elapsedSeconds: numericOrNull(timeData?.[i]),
      distanceMeters: numericOrNull(distanceData?.[i]),
      paceSecondsPerKm,
      pace: formatPace(paceSecondsPerKm),
      heartRate: numericOrNull(heartrateData?.[i]),
      cadence: numericOrNull(cadenceData?.[i]),
      power: numericOrNull(wattsData?.[i]),
      altitude: numericOrNull(altitudeData?.[i]),
    });
  }

  return { points, availableStreams };
}
