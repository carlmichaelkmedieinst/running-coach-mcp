/**
 * Type definitions for daily wellness/recovery data, as returned by
 * Intervals.icu's `/athlete/{id}/wellness.json` endpoint.
 *
 * Wellness is athlete-level and per-calendar-day — it is never tied to a
 * specific activity. It's also inherently sparse: which fields (if any)
 * are populated on a given day depends entirely on what the athlete's
 * wearable (Garmin, in this project) actually synced that day.
 */

/**
 * Minimal shape of one day's raw Intervals.icu wellness entry.
 *
 * Intervals.icu's real wellness schema has 40+ fields (menstrual cycle,
 * blood glucose, macros, hydration, mood, ...); confirmed via live
 * read-only discovery against a real account, we only model the subset
 * that (a) exists and (b) is actually populated for a Garmin-synced
 * runner. Fields discovered but found to be always-`null` for this
 * account (e.g. `readiness`, `fatigue` [subjective], `hrvSDNN`, `mood`,
 * `stress`, `spO2`, `bodyFat`, ...) are intentionally NOT modeled here —
 * see the Milestone 3B report / README for the full discovery notes.
 *
 * `id` is the entry's date (`"YYYY-MM-DD"`), matching the single-date
 * endpoint's path parameter (`/athlete/{id}/wellness/{date}`).
 */
export interface IntervalsWellnessEntry {
  id: string;
  restingHR: number | null;
  hrv: number | null;
  sleepSecs: number | null;
  sleepScore: number | null;
  sleepQuality: number | null;
  weight: number | null;
  vo2max: number | null;
  /** Chronic Training Load ("Fitness"), tracked daily. */
  ctl: number | null;
  /** Acute Training Load ("Fatigue"), tracked daily. */
  atl: number | null;
}

/**
 * Our own normalized representation of one day's wellness/recovery data.
 *
 * All fields are `null` when Intervals.icu has no value for that day —
 * that is the normal, expected state for a sparse wearable-derived
 * metric, not an error.
 */
export interface DailyWellness {
  /** `"YYYY-MM-DD"`. */
  date: string;

  /** Resting heart rate, beats per minute. */
  restingHeartRate: number | null;
  /** Heart rate variability, as reported by Intervals.icu (milliseconds). */
  hrv: number | null;
  /** Total sleep duration, in seconds. */
  sleepSeconds: number | null;
  /** Garmin/Intervals sleep score, roughly 0-100 (higher is better). */
  sleepScore: number | null;
  /** Provider-defined numeric sleep quality value, as reported by Intervals.icu. The scale is not publicly documented upstream, so this is passed through as-is rather than assumed. */
  sleepQuality: number | null;
  /** Body weight, kilograms. */
  weightKg: number | null;
  /**
   * Estimated VO2 max, ml/kg/min, as synced from Garmin via Intervals.icu
   * wellness data. This is a device-estimated physiological metric, NOT a
   * lab-measured VO2 max, and is often `null` (only updated periodically).
   */
  vo2Max: number | null;
  /**
   * Chronic Training Load (Intervals.icu's raw `ctl`), tracked daily rather
   * than per-activity. A training-load model value, not a subjective
   * wellness rating. Named `fitnessCtl` (rather than plain `fitness`) to
   * stay unambiguous: this is distinct from `RunningActivity.fitness`
   * (the same CTL concept, but as of a specific activity) and from
   * Intervals.icu's separate, always-null-for-this-account subjective
   * `fatigue` wellness field.
   */
  fitnessCtl: number | null;
  /**
   * Acute Training Load (Intervals.icu's raw `atl`), tracked daily rather
   * than per-activity. A training-load model value, not a subjective
   * wellness rating. Named `fatigueAtl` (rather than plain `fatigue`)
   * because Intervals.icu's wellness data has a *separate*, subjective
   * `fatigue` field (self-reported, always null for this account) — using
   * plain `fatigue` for ATL here would be ambiguous with that field.
   */
  fatigueAtl: number | null;
}

/** A sparse metric's most recent non-null value, with the date it occurred on. */
export interface LatestNonNullMetric {
  value: number;
  date: string;
}

/**
 * Normalized response for `getWellness`.
 *
 * `days` is newest first. `latest` is the most recent day's entry as-is
 * (which may itself have null fields); `latestNonNull` separately answers
 * "what was the last known value of X", which for sparse metrics is
 * usually a more useful question than "what is X today".
 */
export interface WellnessResult {
  daysRequested: number;
  entriesReturned: number;

  /** The most recent day's entry, or `null` if there is no wellness data at all in range. */
  latest: DailyWellness | null;

  latestNonNull: {
    restingHeartRate: LatestNonNullMetric | null;
    hrv: LatestNonNullMetric | null;
    sleepSeconds: LatestNonNullMetric | null;
    sleepScore: LatestNonNullMetric | null;
    sleepQuality: LatestNonNullMetric | null;
    weightKg: LatestNonNullMetric | null;
    vo2Max: LatestNonNullMetric | null;
  };

  /** Newest first. */
  days: DailyWellness[];
}
