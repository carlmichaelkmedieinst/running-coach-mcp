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
import type { IntervalsActivity, RunningActivity } from "@/types/activity";

/**
 * Upper bound on how many raw activities we ask Intervals.icu for when
 * looking for recent runs. The athlete's activity history may contain many
 * non-running activities (rides, swims, strength, ...), so we over-fetch
 * within the date range and filter client-side. 100 is a reasonable cap for
 * Milestone 1.
 */
const MAX_ACTIVITIES_TO_FETCH = 100;

export const getRecentRunsParamsSchema = z.object({
  limit: z.number().int().min(1).max(20).default(5),
  days: z.number().int().min(7).max(365).default(90),
});

export type GetRecentRunsParams = z.input<typeof getRecentRunsParamsSchema>;

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

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

  const newest = new Date();
  const oldest = new Date(newest);
  oldest.setDate(oldest.getDate() - days);

  const rawActivities = await fetchRawActivities({
    oldest: toDateOnly(oldest),
    newest: toDateOnly(newest),
    limit: MAX_ACTIVITIES_TO_FETCH,
  });

  const runs = rawActivities
    .filter((activity) => isRunningActivityType(activity.type))
    .map(normalizeActivity)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return runs.slice(0, limit);
}
