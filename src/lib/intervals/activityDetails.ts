/**
 * Domain-level access to a single Intervals.icu running activity's detail
 * and detected intervals.
 *
 * Like `activities.ts`, this is the layer MCP tools should call. It fetches
 * raw activity + interval data via the Intervals client, normalizes it, and
 * enforces the running-only activity type rule. MCP code must not depend on
 * `IntervalsActivity`/`IntervalsInterval` or call `intervalsGet` directly.
 */

import { z } from "zod";

import { intervalsGet, IntervalsApiError } from "@/lib/intervals/client";
import { isRunningActivityType, normalizeActivityDetail } from "@/lib/intervals/normalizers";
import type { IntervalsActivity } from "@/types/activity";
import type { RunningActivityDetail } from "@/types/activity";
import type { IntervalsInterval, IntervalsIntervalsResponse } from "@/types/interval";

const activityIdSchema = z.string().trim().min(1, "activityId is required.");

/**
 * Fetches the raw activity by id, translating a 404 from Intervals.icu into
 * our own clean "not found" error (never the raw upstream error).
 */
async function fetchRawActivity(activityId: string): Promise<IntervalsActivity> {
  try {
    return await intervalsGet<IntervalsActivity>(`/activity/${activityId}`);
  } catch (error) {
    if (error instanceof IntervalsApiError && error.status === 404) {
      throw new Error("Running activity not found.");
    }

    throw error;
  }
}

/**
 * Fetches the raw detected intervals for an activity. Some activities
 * genuinely have none analyzed (Intervals.icu returns 404 for those) — that
 * is treated as "no intervals" rather than an error. Any other failure
 * (auth, rate limit, network, ...) propagates normally.
 */
async function fetchRawIntervals(activityId: string): Promise<IntervalsInterval[]> {
  try {
    const response = await intervalsGet<IntervalsIntervalsResponse>(
      `/activity/${activityId}/intervals`
    );

    return Array.isArray(response?.icu_intervals) ? response.icu_intervals : [];
  } catch (error) {
    if (error instanceof IntervalsApiError && error.status === 404) {
      return [];
    }

    throw error;
  }
}

/**
 * Fetches, validates, and normalizes a single running activity's detail
 * and detected intervals.
 *
 * Only `Run`, `TrailRun`, and `VirtualRun` activities are allowed; anything
 * else is rejected with a clean error rather than being normalized. No raw
 * time-series streams are included here — see `getRunStreams` for those.
 *
 * @throws Error with message "Running activity not found." if the activity
 * id doesn't exist.
 * @throws Error with message "Activity is not a running activity." if the
 * activity exists but isn't a running type.
 */
export async function getRunDetails(activityId: string): Promise<RunningActivityDetail> {
  const id = activityIdSchema.parse(activityId);

  const rawActivity = await fetchRawActivity(id);

  if (!isRunningActivityType(rawActivity.type)) {
    throw new Error("Activity is not a running activity.");
  }

  const rawIntervals = await fetchRawIntervals(id);

  return normalizeActivityDetail(rawActivity, rawIntervals);
}
