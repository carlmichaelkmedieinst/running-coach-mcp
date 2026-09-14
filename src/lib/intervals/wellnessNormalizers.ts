/**
 * Pure conversion from Intervals.icu's raw wellness entry shape to our own
 * normalized `DailyWellness` domain model.
 *
 * Mirrors `normalizers.ts`'s role for activities: no other module should
 * reach into `IntervalsWellnessEntry` fields directly — everything
 * downstream should depend on `DailyWellness` instead.
 */

import { numericOrNull } from "@/lib/intervals/normalizers";
import type { DailyWellness, IntervalsWellnessEntry } from "@/types/wellness";

/**
 * Converts a raw Intervals.icu wellness entry into our normalized
 * `DailyWellness` shape. Guards every numeric field against NaN/Infinity
 * (via `numericOrNull`) rather than trusting the upstream response.
 */
export function normalizeWellnessEntry(raw: IntervalsWellnessEntry): DailyWellness {
  return {
    date: raw.id,

    restingHeartRate: numericOrNull(raw.restingHR),
    hrv: numericOrNull(raw.hrv),
    sleepSeconds: numericOrNull(raw.sleepSecs),
    sleepScore: numericOrNull(raw.sleepScore),
    sleepQuality: numericOrNull(raw.sleepQuality),
    weightKg: numericOrNull(raw.weight),
    vo2Max: numericOrNull(raw.vo2max),
    fitnessCtl: numericOrNull(raw.ctl),
    fatigueAtl: numericOrNull(raw.atl),
  };
}
