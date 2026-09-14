/**
 * Pure aggregation helpers for Milestone 3C's running progress/trend
 * analysis. Kept free of any Intervals.icu/MCP/fetching concerns (like
 * `pace.ts` and `downsample.ts`) so every aggregation rule can be unit
 * tested in isolation with plain in-memory `RunningActivity`/`DailyWellness`
 * arrays.
 */

import { calculatePaceSecondsPerKm, formatPace } from "@/lib/running/pace";
import type { RunningActivity } from "@/types/activity";
import type {
  HeartRateBandSummary,
  PeriodComparison,
  ProgressDataQuality,
  Vo2MaxTrend,
  WeeklyBucket,
} from "@/types/progress";
import type { DailyWellness } from "@/types/wellness";

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A run counts as having "valid" HR data if its average HR is a finite, positive number. */
function hasValidHeartRate(run: RunningActivity): run is RunningActivity & { averageHeartRate: number } {
  return isFiniteNumber(run.averageHeartRate) && run.averageHeartRate > 0;
}

/** Core aggregate stats shared by `period`/`recentPeriod`/`previousPeriod`/`weekly`/HR bands. */
export interface RunAggregate {
  runCount: number;
  distanceKm: number;
  movingTimeSeconds: number;
  trainingLoad: number;
  averagePaceSecondsPerKm: number | null;
  averagePace: string | null;
  averageHeartRate: number | null;
}

/**
 * Aggregates a set of runs.
 *
 * - `averagePaceSecondsPerKm` = total moving time ÷ total distance (never an
 *   average of per-run paces).
 * - `averageHeartRate` = moving-time-weighted average across runs with a
 *   valid average HR; runs missing HR are excluded, never treated as 0.
 * - `trainingLoad` = sum of runs' `trainingLoad`; runs missing it simply
 *   don't contribute to the sum.
 */
export function aggregateRuns(runs: RunningActivity[]): RunAggregate {
  const runCount = runs.length;
  const distanceKm = runs.reduce((sum, run) => sum + run.distanceKm, 0);
  const movingTimeSeconds = runs.reduce((sum, run) => sum + run.movingTimeSeconds, 0);
  const trainingLoad = runs.reduce(
    (sum, run) => sum + (isFiniteNumber(run.trainingLoad) ? run.trainingLoad : 0),
    0
  );

  const averagePaceSecondsPerKm = calculatePaceSecondsPerKm(movingTimeSeconds, distanceKm);
  const averagePace = formatPace(averagePaceSecondsPerKm);

  const hrRuns = runs.filter(hasValidHeartRate);
  const totalHrWeight = hrRuns.reduce((sum, run) => sum + run.movingTimeSeconds, 0);
  const averageHeartRate =
    hrRuns.length > 0 && totalHrWeight > 0
      ? hrRuns.reduce((sum, run) => sum + run.averageHeartRate * run.movingTimeSeconds, 0) / totalHrWeight
      : null;

  return { runCount, distanceKm, movingTimeSeconds, trainingLoad, averagePaceSecondsPerKm, averagePace, averageHeartRate };
}

/**
 * Returns the `"YYYY-MM-DD"` Monday that starts the week containing
 * `dateOnly` (a `"YYYY-MM-DD"` string).
 *
 * Does all arithmetic in UTC (via `Date.UTC`/`getUTCDay`/`setUTCDate`)
 * rather than local time, so it can't shift by a day depending on the
 * server's timezone offset (which a local-midnight `Date` + `toISOString()`
 * round-trip would risk in positive-UTC-offset zones).
 */
function mondayOfWeek(dateOnly: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  const dayOfWeek = date.getUTCDay(); // 0 = Sunday ... 6 = Saturday
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setUTCDate(date.getUTCDate() + offsetToMonday);

  return date.toISOString().slice(0, 10);
}

/**
 * Groups runs into Monday-start weekly buckets, sorted oldest → newest.
 *
 * Only weeks containing at least one run are included — empty historical
 * weeks are deliberately not manufactured (there's no well-defined "end" of
 * the requested window to pad to, and it would bloat the response without
 * adding signal for trend interpretation).
 */
export function groupIntoWeeklyBuckets(runs: RunningActivity[]): WeeklyBucket[] {
  const byWeekStart = new Map<string, RunningActivity[]>();

  for (const run of runs) {
    const weekStart = mondayOfWeek(run.date.slice(0, 10));
    const bucket = byWeekStart.get(weekStart);
    if (bucket) {
      bucket.push(run);
    } else {
      byWeekStart.set(weekStart, [run]);
    }
  }

  return Array.from(byWeekStart.entries())
    .map(([weekStart, weekRuns]) => ({ weekStart, ...aggregateRuns(weekRuns) }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0));
}

/** Band width in bpm for `groupByHeartRateBand` (e.g. 145-149, 150-154). */
const HEART_RATE_BAND_SIZE_BPM = 5;

/**
 * Groups runs with valid average HR into deterministic 5 bpm bands, sorted
 * by `minHeartRate` ascending. Runs without valid HR are excluded entirely.
 * Descriptive only — not a physiological training zone.
 */
export function groupByHeartRateBand(runs: RunningActivity[]): HeartRateBandSummary[] {
  const byBandMin = new Map<number, RunningActivity[]>();

  for (const run of runs.filter(hasValidHeartRate)) {
    const bandMin = Math.floor(run.averageHeartRate / HEART_RATE_BAND_SIZE_BPM) * HEART_RATE_BAND_SIZE_BPM;
    const bucket = byBandMin.get(bandMin);
    if (bucket) {
      bucket.push(run);
    } else {
      byBandMin.set(bandMin, [run]);
    }
  }

  return Array.from(byBandMin.entries())
    .map(([bandMin, bandRuns]) => {
      const { runCount, distanceKm, averagePaceSecondsPerKm, averagePace } = aggregateRuns(bandRuns);
      return {
        minHeartRate: bandMin,
        maxHeartRate: bandMin + HEART_RATE_BAND_SIZE_BPM - 1,
        runCount,
        distanceKm,
        averagePaceSecondsPerKm,
        averagePace,
      };
    })
    .sort((a, b) => a.minHeartRate - b.minHeartRate);
}

/**
 * Compares a recent aggregate against a previous one.
 *
 * Percentage change is `null` (never divide-by-zero or infinity) when the
 * previous denominator is 0. Pace change convention: negative = recent
 * pace faster, positive = recent pace slower.
 */
export function computeComparison(recent: RunAggregate, previous: RunAggregate): PeriodComparison {
  const distanceChangeKm = recent.distanceKm - previous.distanceKm;
  const distanceChangePercent =
    previous.distanceKm > 0 ? (distanceChangeKm / previous.distanceKm) * 100 : null;

  const paceChangeSecondsPerKm =
    isFiniteNumber(recent.averagePaceSecondsPerKm) && isFiniteNumber(previous.averagePaceSecondsPerKm)
      ? recent.averagePaceSecondsPerKm - previous.averagePaceSecondsPerKm
      : null;

  const averageHeartRateChange =
    isFiniteNumber(recent.averageHeartRate) && isFiniteNumber(previous.averageHeartRate)
      ? recent.averageHeartRate - previous.averageHeartRate
      : null;

  return {
    distanceChangeKm,
    distanceChangePercent,
    runCountChange: recent.runCount - previous.runCount,
    movingTimeChangeSeconds: recent.movingTimeSeconds - previous.movingTimeSeconds,
    trainingLoadChange: recent.trainingLoad - previous.trainingLoad,
    paceChangeSecondsPerKm,
    averageHeartRateChange,
  };
}

/** Minimum runs required in BOTH comparison periods to consider the comparison well-supported. */
const MIN_RUNS_FOR_CONFIDENT_COMPARISON = 2;

/**
 * Flags whether there's enough data for a confident recent-vs-previous
 * comparison (at least 2 runs in both periods), with a plain-text caveat if
 * not. Never a coaching conclusion — just a data-sufficiency fact.
 */
export function computeDataQuality(recentRunCount: number, previousRunCount: number): ProgressDataQuality {
  const enoughRunsForComparison =
    recentRunCount >= MIN_RUNS_FOR_CONFIDENT_COMPARISON && previousRunCount >= MIN_RUNS_FOR_CONFIDENT_COMPARISON;

  const notes: string[] = [];
  if (!enoughRunsForComparison) {
    notes.push(
      `Trend confidence is limited: at least ${MIN_RUNS_FOR_CONFIDENT_COMPARISON} runs are recommended in both ` +
        `the recent and previous comparison periods (found ${recentRunCount} recent, ${previousRunCount} previous).`
    );
  }

  return { enoughRunsForComparison, recentRunCount, previousRunCount, notes };
}

/**
 * Builds a VO2 max trend from wellness days. Null observations are ignored
 * (never interpolated). `observations` is oldest → newest.
 */
export function computeVo2MaxTrend(wellnessDays: DailyWellness[]): Vo2MaxTrend {
  const observations = wellnessDays
    .filter((day) => isFiniteNumber(day.vo2Max))
    .map((day) => ({ date: day.date, value: day.vo2Max as number }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (observations.length === 0) {
    return { latest: null, earliest: null, change: null, observations: [] };
  }

  const earliest = observations[0];
  const latest = observations[observations.length - 1];

  return {
    latest: { value: latest.value, date: latest.date },
    earliest: { value: earliest.value, date: earliest.date },
    change: latest.value - earliest.value,
    observations,
  };
}
