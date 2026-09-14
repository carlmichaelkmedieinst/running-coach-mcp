/**
 * Type definitions for descriptive running progress/trend analysis
 * (Milestone 3C).
 *
 * Everything here is derived purely from already-normalized
 * `RunningActivity` (activity list) and `DailyWellness` (wellness) data —
 * no activity-detail or stream fetches, and no physiological modeling: no
 * VO2 max calculation, no cardiac drift, no training zones, no race-time
 * prediction, no proprietary fitness score. This is intentionally
 * *descriptive*, not predictive. ChatGPT (not this backend) is expected to
 * interpret what the numbers mean.
 */

import type { LatestNonNullMetric } from "./wellness";

/** Aggregate running stats for a single date window. */
export interface PeriodSummary {
  /** `"YYYY-MM-DD"`, inclusive. */
  startDate: string;
  /** `"YYYY-MM-DD"`, inclusive. */
  endDate: string;

  runCount: number;
  distanceKm: number;
  movingTimeSeconds: number;
  /**
   * Sum of each run's `trainingLoad`. Runs without a value simply don't
   * contribute to the sum (never treated as a 0 measurement).
   */
  trainingLoad: number;

  /**
   * Aggregate pace = total moving time ÷ total distance — never an average
   * of per-run paces, so longer runs correctly count more. `null` when
   * `distanceKm` is 0.
   */
  averagePaceSecondsPerKm: number | null;
  averagePace: string | null;

  /**
   * Moving-time-weighted average heart rate across runs with a valid
   * average HR. Runs without HR data are excluded entirely (never treated
   * as 0). `null` when no run in the period has valid HR data.
   */
  averageHeartRate: number | null;
}

/**
 * Recent-vs-previous comparison. All "change" fields are
 * `recentPeriod - previousPeriod`.
 */
export interface PeriodComparison {
  distanceChangeKm: number;
  /** `null` when `previousPeriod.distanceKm` is 0 (can't compute a percentage of zero). */
  distanceChangePercent: number | null;
  runCountChange: number;
  movingTimeChangeSeconds: number;
  trainingLoadChange: number;
  /**
   * `recentPeriod.averagePaceSecondsPerKm - previousPeriod.averagePaceSecondsPerKm`.
   * **Negative means the recent pace is faster; positive means it is
   * slower** (e.g. -12 means recent pace is 12 sec/km faster). `null` if
   * either period has no computable aggregate pace.
   */
  paceChangeSecondsPerKm: number | null;
  /** `null` if either period has no valid HR data. */
  averageHeartRateChange: number | null;
}

/** One Monday-to-Sunday week's aggregate running stats. */
export interface WeeklyBucket {
  /** Monday of the week, `"YYYY-MM-DD"`. */
  weekStart: string;
  runCount: number;
  distanceKm: number;
  movingTimeSeconds: number;
  trainingLoad: number;
  averagePaceSecondsPerKm: number | null;
  averagePace: string | null;
  averageHeartRate: number | null;
}

/**
 * A descriptive grouping of runs by their recorded activity-average heart
 * rate, in deterministic 5 bpm bands (e.g. 145-149, 150-154). This is
 * **not** a physiological training zone and does **not** represent cardiac
 * drift or prove aerobic fitness by itself — it simply lets a client
 * compare pace across runs performed at roughly similar average
 * cardiovascular load.
 */
export interface HeartRateBandSummary {
  minHeartRate: number;
  maxHeartRate: number;
  runCount: number;
  distanceKm: number;
  averagePaceSecondsPerKm: number | null;
  averagePace: string | null;
}

export interface Vo2MaxObservation {
  date: string;
  value: number;
}

/**
 * VO2 max trend, built entirely from `DailyWellness.vo2Max` observations
 * (device-estimated via Garmin/Intervals.icu — never calculated by this
 * project). Null wellness days are ignored, never interpolated.
 */
export interface Vo2MaxTrend {
  latest: LatestNonNullMetric | null;
  earliest: LatestNonNullMetric | null;
  /** `latest.value - earliest.value`. `null` when there are no observations. */
  change: number | null;
  /** All non-null VO2 max observations in the period, oldest first. */
  observations: Vo2MaxObservation[];
}

export interface ProgressDataQuality {
  /** `true` only when both comparison periods have at least 2 runs. */
  enoughRunsForComparison: boolean;
  recentRunCount: number;
  previousRunCount: number;
  /** Plain-text caveats about data sufficiency. Never a coaching conclusion. */
  notes: string[];
}

/**
 * Normalized result for `getRunningProgress` / the `get_running_progress`
 * MCP tool.
 */
export interface RunningProgressResult {
  daysRequested: number;
  comparisonDays: number;

  /** Aggregate over the full `daysRequested` window. */
  period: PeriodSummary;
  /** Aggregate over the most recent `comparisonDays` calendar days. */
  recentPeriod: PeriodSummary;
  /** Aggregate over the `comparisonDays` calendar days immediately before `recentPeriod`. */
  previousPeriod: PeriodSummary;
  comparison: PeriodComparison;

  /**
   * Oldest → newest. Only weeks containing at least one run are included
   * (empty weeks are deliberately not manufactured — see README).
   */
  weekly: WeeklyBucket[];

  /** Sorted by `minHeartRate` ascending. */
  paceByAverageHeartRateBand: HeartRateBandSummary[];
  vo2MaxTrend: Vo2MaxTrend;
  dataQuality: ProgressDataQuality;
}
