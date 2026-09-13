/**
 * Domain-level access to a single Intervals.icu running activity's
 * time-series streams (heart rate, pace, cadence, power, elevation, ...).
 *
 * Like `activities.ts` and `activityDetails.ts`, this is the layer MCP
 * tools should call. It fetches the full raw stream set via the Intervals
 * client, normalizes it into per-instant points, and downsamples to a
 * bounded, MCP-response-friendly size. MCP code must not depend on
 * `IntervalsStream` or call `intervalsGet` directly.
 */

import { z } from "zod";

import { intervalsGet, IntervalsApiError } from "@/lib/intervals/client";
import { buildStreamPoints } from "@/lib/intervals/normalizers";
import { downsampleDeterministic } from "@/lib/running/downsample";
import type { IntervalsStream, RunningStreamPoint, RunningStreamsResult } from "@/types/stream";

export const getRunStreamsParamsSchema = z.object({
  activityId: z.string().trim().min(1, "activityId is required."),
  maxPoints: z.number().int().min(100).max(1000).default(600),
});

export type GetRunStreamsParams = z.input<typeof getRunStreamsParamsSchema>;

/**
 * Fetches the raw stream array for an activity, translating a 404 from
 * Intervals.icu into our own clean "not found" error.
 */
async function fetchRawStreams(activityId: string): Promise<IntervalsStream[]> {
  try {
    const response = await intervalsGet<IntervalsStream[]>(`/activity/${activityId}/streams.json`);
    return Array.isArray(response) ? response : [];
  } catch (error) {
    if (error instanceof IntervalsApiError && error.status === 404) {
      throw new Error("Running activity not found.");
    }

    throw error;
  }
}

/**
 * Average spacing, in seconds, between consecutive *returned* points.
 * Returns `null` when it can't be meaningfully determined (fewer than two
 * points, or missing/non-finite elapsed-time data).
 */
function computeSamplingIntervalSeconds(points: RunningStreamPoint[]): number | null {
  if (points.length < 2) {
    return null;
  }

  const first = points[0].elapsedSeconds;
  const last = points[points.length - 1].elapsedSeconds;

  if (first === null || last === null) {
    return null;
  }

  const span = last - first;

  if (!Number.isFinite(span) || span <= 0) {
    return null;
  }

  return span / (points.length - 1);
}

/**
 * Fetches, normalizes, and downsamples a single running activity's
 * time-series streams.
 *
 * Returns at most `maxPoints` normalized points (deterministic bucket
 * sampling, never random), always including the first and last recorded
 * instant. If the activity already has `<= maxPoints` points, all of them
 * are returned unsampled.
 *
 * @throws Error with message "Running activity not found." if the activity
 * id doesn't exist.
 */
export async function getRunStreams(params: GetRunStreamsParams): Promise<RunningStreamsResult> {
  const { activityId, maxPoints } = getRunStreamsParamsSchema.parse(params);

  const rawStreams = await fetchRawStreams(activityId);
  const { points, availableStreams } = buildStreamPoints(rawStreams);

  const originalPointCount = points.length;
  const sampledPoints =
    originalPointCount <= maxPoints ? points : downsampleDeterministic(points, maxPoints);

  return {
    activityId,
    originalPointCount,
    returnedPointCount: sampledPoints.length,
    samplingIntervalSeconds: computeSamplingIntervalSeconds(sampledPoints),
    availableStreams,
    points: sampledPoints,
  };
}
