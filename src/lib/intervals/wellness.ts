/**
 * Domain-level access to Intervals.icu daily wellness/recovery data.
 *
 * Like `activities.ts`, this is the layer MCP tools should call. It fetches
 * raw wellness entries via the Intervals client, normalizes them, and
 * derives the "most recent known value" for each sparse metric. MCP code
 * must not depend on `IntervalsWellnessEntry` or call `intervalsGet`
 * directly.
 */

import { z } from "zod";

import { getIntervalsAthleteId } from "@/lib/intervals/auth";
import { intervalsGet } from "@/lib/intervals/client";
import { normalizeWellnessEntry } from "@/lib/intervals/wellnessNormalizers";
import type {
  DailyWellness,
  IntervalsWellnessEntry,
  LatestNonNullMetric,
  WellnessResult,
} from "@/types/wellness";

export const getWellnessParamsSchema = z.object({
  days: z.number().int().min(7).max(365).default(30),
});

export type GetWellnessParams = z.input<typeof getWellnessParamsSchema>;

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Fetches raw wellness entries for the configured athlete within a date
 * range. Intervals.icu only returns a row for days it actually has some
 * wellness data for — the result can be (and often is) shorter than the
 * requested day count.
 */
async function fetchRawWellness(oldest: string, newest: string): Promise<IntervalsWellnessEntry[]> {
  const athleteId = getIntervalsAthleteId();

  const entries = await intervalsGet<IntervalsWellnessEntry[]>(
    `/athlete/${athleteId}/wellness.json`,
    { oldest, newest }
  );

  return Array.isArray(entries) ? entries : [];
}

/** Numeric (non-`date`) fields of `DailyWellness`, i.e. ones that can be "sparse". */
type SparseWellnessField = Exclude<keyof DailyWellness, "date">;

/**
 * Scans `days` (already sorted newest first) for the most recent entry
 * where `field` is non-null, returning its value and date, or `null` if
 * the field has no known value anywhere in range.
 */
function findLatestNonNull(
  days: DailyWellness[],
  field: SparseWellnessField
): LatestNonNullMetric | null {
  for (const day of days) {
    const value = day[field];

    if (typeof value === "number" && Number.isFinite(value)) {
      return { value, date: day.date };
    }
  }

  return null;
}

/**
 * Fetches, normalizes, and summarizes daily wellness/recovery data.
 *
 * @param days - How many days back to search. Integer 7-365, default 30.
 * Intervals.icu only returns rows for days with actual data, so
 * `entriesReturned` may be well below `daysRequested`.
 */
export async function getWellness(params: GetWellnessParams = {}): Promise<WellnessResult> {
  const { days } = getWellnessParamsSchema.parse(params);

  const newest = new Date();
  const oldest = new Date(newest);
  oldest.setDate(oldest.getDate() - days);

  const rawEntries = await fetchRawWellness(toDateOnly(oldest), toDateOnly(newest));

  const normalizedDays = rawEntries
    .map(normalizeWellnessEntry)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    daysRequested: days,
    entriesReturned: normalizedDays.length,
    latest: normalizedDays[0] ?? null,
    latestNonNull: {
      restingHeartRate: findLatestNonNull(normalizedDays, "restingHeartRate"),
      hrv: findLatestNonNull(normalizedDays, "hrv"),
      sleepSeconds: findLatestNonNull(normalizedDays, "sleepSeconds"),
      sleepScore: findLatestNonNull(normalizedDays, "sleepScore"),
      sleepQuality: findLatestNonNull(normalizedDays, "sleepQuality"),
      weightKg: findLatestNonNull(normalizedDays, "weightKg"),
      vo2Max: findLatestNonNull(normalizedDays, "vo2Max"),
    },
    days: normalizedDays,
  };
}
