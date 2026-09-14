/**
 * Domain-level running progress/trend analysis (Milestone 3C).
 *
 * Deliberately cheap: reuses the existing activity-list (`activities.ts`)
 * and wellness (`wellness.ts`) domain functions — exactly one activities
 * request and one wellness request, no per-run detail/stream fetches (no
 * N+1). All aggregation math lives in the pure, independently-tested
 * `progressAggregation.ts` module; this file is just fetching + windowing.
 */

import { z } from "zod";

import { getRunningActivitiesInRange, MAX_ACTIVITIES_FOR_PROGRESS } from "@/lib/intervals/activities";
import { getWellness } from "@/lib/intervals/wellness";
import { getAthleteTimeZone } from "@/lib/running/athleteTimeZone";
import { addDaysToDateOnly, isDateOnlyInRange, todayDateOnly } from "@/lib/running/dates";
import {
  aggregateRuns,
  computeComparison,
  computeDataQuality,
  computeVo2MaxTrend,
  groupByHeartRateBand,
  groupIntoWeeklyBuckets,
} from "@/lib/running/progressAggregation";
import type { RunningActivity } from "@/types/activity";
import type { PeriodSummary, RunningProgressResult } from "@/types/progress";

export const getRunningProgressParamsSchema = z.object({
  days: z.number().int().min(14).max(365).default(90),
  comparisonDays: z.number().int().min(7).max(56).default(14),
});

export type GetRunningProgressParams = z.input<typeof getRunningProgressParamsSchema>;

function activityDateOnly(run: RunningActivity): string {
  return run.date.slice(0, 10);
}

function buildPeriodSummary(runs: RunningActivity[], startDate: string, endDate: string): PeriodSummary {
  const runsInRange = runs.filter((run) => isDateOnlyInRange(activityDateOnly(run), startDate, endDate));
  return { startDate, endDate, ...aggregateRuns(runsInRange) };
}

/**
 * Analyzes running progress and trends: weekly volume, aggregate pace,
 * heart rate, training load, VO2 max trend, and recent-vs-previous period
 * comparisons.
 *
 * @param days - Overall analysis window, in days. Integer 14-365, default 90.
 * @param comparisonDays - Length of the recent/previous comparison windows,
 * in days. Integer 7-56, default 14. `recentPeriod` is the last
 * `comparisonDays` calendar days; `previousPeriod` is the `comparisonDays`
 * days immediately before that.
 */
export async function getRunningProgress(
  params: GetRunningProgressParams = {}
): Promise<RunningProgressResult> {
  const { days, comparisonDays } = getRunningProgressParamsSchema.parse(params);

  // "Today" must be the athlete's local calendar date, not the server's
  // timezone and not UTC — see `todayDateOnly`'s doc comment.
  const todayStr = todayDateOnly(getAthleteTimeZone());

  const periodStart = addDaysToDateOnly(todayStr, -(days - 1));
  const recentStart = addDaysToDateOnly(todayStr, -(comparisonDays - 1));
  const previousStart = addDaysToDateOnly(todayStr, -(comparisonDays * 2 - 1));
  const previousEnd = addDaysToDateOnly(todayStr, -comparisonDays);

  // recentPeriod + previousPeriod together can span up to `2 * comparisonDays`
  // days, which may exceed `days` itself (e.g. days=14, comparisonDays=56).
  // Fetch whichever window is larger so the comparison is never silently
  // truncated — still exactly one activities request and one wellness
  // request either way (no N+1).
  const fetchWindowDays = Math.max(days, comparisonDays * 2);

  const [runs, wellness] = await Promise.all([
    getRunningActivitiesInRange({ days: fetchWindowDays, fetchLimit: MAX_ACTIVITIES_FOR_PROGRESS }),
    getWellness({ days: fetchWindowDays }),
  ]);

  const period = buildPeriodSummary(runs, periodStart, todayStr);
  const recentPeriod = buildPeriodSummary(runs, recentStart, todayStr);
  const previousPeriod = buildPeriodSummary(runs, previousStart, previousEnd);

  const comparison = computeComparison(recentPeriod, previousPeriod);
  const dataQuality = computeDataQuality(recentPeriod.runCount, previousPeriod.runCount);

  // Weekly buckets, HR bands, and the VO2 trend are all scoped to the
  // `daysRequested` window (not the possibly-wider fetch window).
  const runsInPeriod = runs.filter((run) => isDateOnlyInRange(activityDateOnly(run), periodStart, todayStr));
  const weekly = groupIntoWeeklyBuckets(runsInPeriod);
  const paceByAverageHeartRateBand = groupByHeartRateBand(runsInPeriod);

  const wellnessInPeriod = wellness.days.filter((day) => isDateOnlyInRange(day.date, periodStart, todayStr));
  const vo2MaxTrend = computeVo2MaxTrend(wellnessInPeriod);

  return {
    daysRequested: days,
    comparisonDays,
    period,
    recentPeriod,
    previousPeriod,
    comparison,
    weekly,
    paceByAverageHeartRateBand,
    vo2MaxTrend,
    dataQuality,
  };
}
