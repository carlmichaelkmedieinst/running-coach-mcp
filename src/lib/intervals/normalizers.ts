/**
 * Pure conversion from Intervals.icu's raw activity shape to our own
 * normalized `RunningActivity` domain model.
 *
 * No other module should reach into `IntervalsActivity` fields directly —
 * everything downstream (domain functions, MCP tools) should depend on
 * `RunningActivity` instead. This keeps the raw provider shape isolated to
 * a single, small file.
 */

import { calculatePaceSecondsPerKm, formatPace, metersToKm } from "@/lib/running/pace";
import type { IntervalsActivity, RunningActivity } from "@/types/activity";

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
