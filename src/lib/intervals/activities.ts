/**
 * Domain-level access to Intervals.icu activities.
 *
 * This is the layer MCP tools (and any future consumer) should call. It
 * fetches raw activities via the Intervals client, normalizes them, and
 * applies our own running-specific filtering/sorting/limiting rules. MCP
 * code must not depend on `IntervalsActivity` or call `intervalsGet`
 * directly.
 */

import { z } from "zod";

import { getIntervalsAthleteId } from "@/lib/intervals/auth";
import { intervalsGet } from "@/lib/intervals/client";
import { isRunningActivityType, normalizeActivity } from "@/lib/intervals/normalizers";
import { getAthleteTimeZone } from "@/lib/running/athleteTimeZone";
import { addDaysToDateOnly, todayDateOnly } from "@/lib/running/dates";
import type { IntervalsActivity, RunningActivity } from "@/types/activity";

/**
 * Upper bound on how many raw activities we ask Intervals.icu for when
 * looking for recent runs. The athlete's activity history may contain many
 * non-running activities (rides, swims, strength, ...), so we over-fetch
 * within the date range and filter client-side. 100 is a reasonable cap for
 * Milestone 1.
 */
const MAX_ACTIVITIES_TO_FETCH = 100;

/**
 * Upper bound used by `getRunningActivitiesInRange` when called for
 * Milestone 3C's progress analysis, which can span up to a year. Still a
 * single Intervals.icu request — just asking for more rows.
 */
export const MAX_ACTIVITIES_FOR_PROGRESS = 500;

export const getRecentRunsParamsSchema = z.object({
  limit: z.number().int().min(1).max(20).default(5),
  days: z.number().int().min(7).max(365).default(90),
});

export type GetRecentRunsParams = z.input<typeof getRecentRunsParamsSchema>;

/**
 * Fetches raw activities for the configured athlete within a date range.
 *
 * Kept separate from `getRecentRuns` so future domain functions (e.g. a
 * future "recent rides" or "all activities" tool) can reuse it without
 * duplicating the fetch/query-building logic.
 */
async function fetchRawActivities(params: {
  oldest: string;
  newest: string;
  limit: number;
}): Promise<IntervalsActivity[]> {
  const athleteId = getIntervalsAthleteId();

  const activities = await intervalsGet<IntervalsActivity[]>(
    `/athlete/${athleteId}/activities`,
    {
      oldest: params.oldest,
      newest: params.newest,
      limit: params.limit,
    }
  );

  return Array.isArray(activities) ? activities : [];
}

/**
 * Returns ALL normalized running activities (Run, TrailRun, VirtualRun)
 * within the last `days` days, newest first — no result-count limit.
 *
 * Shared by `getRecentRuns` (Milestone 1) and `getRunningProgress`
 * (Milestone 3C) so both stay consistent and neither duplicates the
 * fetch/filter/normalize/sort logic. `getRecentRuns` still limits how many
 * raw rows it *asks Intervals.icu for*; callers needing a full year of
 * history (like progress analysis) can raise `fetchLimit` — it's always a
 * single Intervals.icu request, never N+1.
 *
 * @param days - How many days back to search for activities.
 * @param fetchLimit - Max raw activities to request from Intervals.icu
 * (over-fetched since the athlete may have non-running activities mixed
 * in). Defaults to `MAX_ACTIVITIES_TO_FETCH`.
 */
export async function getRunningActivitiesInRange(params: {
  days: number;
  fetchLimit?: number;
}): Promise<RunningActivity[]> {
  const { days, fetchLimit = MAX_ACTIVITIES_TO_FETCH } = params;

  // "Today" must be the athlete's local calendar date, not the server's
  // timezone and not UTC — see `todayDateOnly`'s doc comment.
  const newest = todayDateOnly(getAthleteTimeZone());
  const oldest = addDaysToDateOnly(newest, -days);

  const rawActivities = await fetchRawActivities({ oldest, newest, limit: fetchLimit });

  return rawActivities
    .filter((activity) => isRunningActivityType(activity.type))
    .map(normalizeActivity)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * Returns the athlete's most recent running activities (Run, TrailRun,
 * VirtualRun), newest first, normalized into our `RunningActivity` shape.
 *
 * @param limit - Max number of runs to return. Integer 1-20, default 5.
 * @param days - How many days back to search for activities. Integer
 * 7-365, default 90. If fewer runs exist in that window, returns whatever
 * is available (it does not widen the window automatically).
 */
export async function getRecentRuns(params: GetRecentRunsParams = {}): Promise<RunningActivity[]> {
  const { limit, days } = getRecentRunsParamsSchema.parse(params);

  const runs = await getRunningActivitiesInRange({ days, fetchLimit: MAX_ACTIVITIES_TO_FETCH });

  return runs.slice(0, limit);
}
