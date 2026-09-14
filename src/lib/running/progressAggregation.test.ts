import { describe, expect, it } from "vitest";

import {
  aggregateRuns,
  computeComparison,
  computeDataQuality,
  computeVo2MaxTrend,
  groupByHeartRateBand,
  groupIntoWeeklyBuckets,
} from "./progressAggregation";
import type { RunningActivity } from "@/types/activity";
import type { DailyWellness } from "@/types/wellness";

function makeRun(overrides: Partial<RunningActivity> = {}): RunningActivity {
  return {
    id: "r1",
    date: "2026-09-10T08:00:00",
    name: null,
    distanceKm: 10,
    movingTimeSeconds: 3000, // 5:00/km
    elapsedTimeSeconds: 3000,
    paceSecondsPerKm: 300,
    pace: "5:00/km",
    averageHeartRate: 150,
    maxHeartRate: 170,
    elevationGainMeters: 50,
    averageCadence: 170,
    trainingLoad: 60,
    intensity: 0.8,
    fitness: 40,
    fatigue: 30,
    rpe: null,
    feel: null,
    decoupling: null,
    source: null,
    ...overrides,
  };
}

function makeWellnessDay(overrides: Partial<DailyWellness> = {}): DailyWellness {
  return {
    date: "2026-09-10",
    restingHeartRate: null,
    hrv: null,
    sleepSeconds: null,
    sleepScore: null,
    sleepQuality: null,
    weightKg: null,
    vo2Max: null,
    fitnessCtl: null,
    fatigueAtl: null,
    ...overrides,
  };
}

describe("aggregateRuns", () => {
  it("computes aggregate pace as total moving time / total distance, not an average of per-run paces", () => {
    // Run A: 10km in 3000s (5:00/km). Run B: 5km in 1200s (4:00/km).
    // A naive average of paces would be 4:30/km; distance-weighted total is
    // 15km in 4200s = 280s/km = 4:40/km.
    const runs = [
      makeRun({ distanceKm: 10, movingTimeSeconds: 3000 }),
      makeRun({ distanceKm: 5, movingTimeSeconds: 1200 }),
    ];

    const result = aggregateRuns(runs);

    expect(result.averagePaceSecondsPerKm).toBeCloseTo(4200 / 15, 5);
    expect(result.averagePace).toBe("4:40/km");
  });

  it("weights average heart rate by moving time, not a plain average", () => {
    // Long run at HR 140 for 3600s, short run at HR 170 for 600s.
    // Plain average would be 155; time-weighted average favors the long run.
    const runs = [
      makeRun({ averageHeartRate: 140, movingTimeSeconds: 3600 }),
      makeRun({ averageHeartRate: 170, movingTimeSeconds: 600 }),
    ];

    const result = aggregateRuns(runs);
    const expected = (140 * 3600 + 170 * 600) / (3600 + 600);

    expect(result.averageHeartRate).toBeCloseTo(expected, 5);
    expect(result.averageHeartRate).not.toBeCloseTo(155, 0);
  });

  it("excludes runs with missing heart rate entirely, rather than treating them as 0", () => {
    const runs = [
      makeRun({ averageHeartRate: 150, movingTimeSeconds: 1000 }),
      makeRun({ averageHeartRate: null, movingTimeSeconds: 1000 }),
    ];

    const result = aggregateRuns(runs);

    expect(result.averageHeartRate).toBe(150);
  });

  it("returns null average heart rate when no run has valid HR data", () => {
    const runs = [makeRun({ averageHeartRate: null }), makeRun({ averageHeartRate: null })];

    expect(aggregateRuns(runs).averageHeartRate).toBeNull();
  });

  it("sums valid training load values, skipping runs with a missing value", () => {
    const runs = [
      makeRun({ trainingLoad: 50 }),
      makeRun({ trainingLoad: null }),
      makeRun({ trainingLoad: 30 }),
    ];

    expect(aggregateRuns(runs).trainingLoad).toBe(80);
  });

  it("returns zeros/nulls for an empty run set", () => {
    const result = aggregateRuns([]);

    expect(result).toEqual({
      runCount: 0,
      distanceKm: 0,
      movingTimeSeconds: 0,
      trainingLoad: 0,
      averagePaceSecondsPerKm: null,
      averagePace: null,
      averageHeartRate: null,
    });
  });
});

describe("groupIntoWeeklyBuckets", () => {
  it("uses Monday as the start of the week", () => {
    // 2026-09-10 is a Thursday; its week's Monday is 2026-09-07.
    const runs = [makeRun({ date: "2026-09-10T08:00:00" })];

    const weekly = groupIntoWeeklyBuckets(runs);

    expect(weekly).toHaveLength(1);
    expect(weekly[0].weekStart).toBe("2026-09-07");
  });

  it("groups runs on Sunday into the week that started the preceding Monday", () => {
    // 2026-09-13 is a Sunday; it belongs to the week starting 2026-09-07.
    const runs = [makeRun({ date: "2026-09-13T08:00:00" })];

    const weekly = groupIntoWeeklyBuckets(runs);

    expect(weekly[0].weekStart).toBe("2026-09-07");
  });

  it("sorts weeks oldest to newest", () => {
    const runs = [
      makeRun({ id: "a", date: "2026-09-14T08:00:00" }), // week of 2026-09-14
      makeRun({ id: "b", date: "2026-08-31T08:00:00" }), // week of 2026-08-31
      makeRun({ id: "c", date: "2026-09-07T08:00:00" }), // week of 2026-09-07
    ];

    const weekly = groupIntoWeeklyBuckets(runs);

    expect(weekly.map((w) => w.weekStart)).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
  });

  it("aggregates multiple runs within the same week", () => {
    const runs = [
      makeRun({ id: "a", date: "2026-09-07T08:00:00", distanceKm: 5 }),
      makeRun({ id: "b", date: "2026-09-10T08:00:00", distanceKm: 8 }),
    ];

    const weekly = groupIntoWeeklyBuckets(runs);

    expect(weekly).toHaveLength(1);
    expect(weekly[0].runCount).toBe(2);
    expect(weekly[0].distanceKm).toBe(13);
  });

  it("does not manufacture buckets for weeks with no runs", () => {
    const runs = [
      makeRun({ id: "a", date: "2026-08-31T08:00:00" }),
      makeRun({ id: "b", date: "2026-09-14T08:00:00" }),
    ];

    const weekly = groupIntoWeeklyBuckets(runs);

    // Two weeks apart, but only the two weeks that actually have runs appear.
    expect(weekly).toHaveLength(2);
  });
});

describe("groupByHeartRateBand", () => {
  it("groups runs into deterministic 5 bpm bands", () => {
    const runs = [
      makeRun({ id: "a", averageHeartRate: 147 }),
      makeRun({ id: "b", averageHeartRate: 150 }),
      makeRun({ id: "c", averageHeartRate: 154 }),
    ];

    const bands = groupByHeartRateBand(runs);

    expect(bands).toEqual([
      expect.objectContaining({ minHeartRate: 145, maxHeartRate: 149, runCount: 1 }),
      expect.objectContaining({ minHeartRate: 150, maxHeartRate: 154, runCount: 2 }),
    ]);
  });

  it("excludes runs with missing average heart rate from every band", () => {
    const runs = [makeRun({ averageHeartRate: 150 }), makeRun({ averageHeartRate: null })];

    const bands = groupByHeartRateBand(runs);
    const totalBandedRuns = bands.reduce((sum, band) => sum + band.runCount, 0);

    expect(totalBandedRuns).toBe(1);
  });

  it("computes distance-weighted aggregate pace per band", () => {
    const runs = [
      makeRun({ averageHeartRate: 151, distanceKm: 10, movingTimeSeconds: 3000 }),
      makeRun({ averageHeartRate: 152, distanceKm: 5, movingTimeSeconds: 1200 }),
    ];

    const bands = groupByHeartRateBand(runs);

    expect(bands).toHaveLength(1);
    expect(bands[0].averagePaceSecondsPerKm).toBeCloseTo(4200 / 15, 5);
  });

  it("sorts bands by minHeartRate ascending", () => {
    const runs = [makeRun({ averageHeartRate: 165 }), makeRun({ averageHeartRate: 145 })];

    const bands = groupByHeartRateBand(runs);

    expect(bands.map((b) => b.minHeartRate)).toEqual([145, 165]);
  });
});

describe("computeComparison", () => {
  const recent = aggregateRuns([makeRun({ distanceKm: 20, movingTimeSeconds: 6000, trainingLoad: 100 })]);
  const previous = aggregateRuns([makeRun({ distanceKm: 10, movingTimeSeconds: 3300, trainingLoad: 60 })]);

  it("computes distance percentage change relative to the previous period", () => {
    const comparison = computeComparison(recent, previous);

    expect(comparison.distanceChangeKm).toBe(10);
    expect(comparison.distanceChangePercent).toBeCloseTo(100, 5);
  });

  it("returns null percentage change when the previous denominator is zero", () => {
    const emptyPrevious = aggregateRuns([]);
    const comparison = computeComparison(recent, emptyPrevious);

    expect(comparison.distanceChangePercent).toBeNull();
    // The absolute change is still meaningful even with no previous data.
    expect(comparison.distanceChangeKm).toBe(recent.distanceKm);
  });

  it("follows the pace convention: negative means recent is faster", () => {
    // recent: 20km/6000s = 300s/km. previous: 10km/3300s = 330s/km.
    // Recent is faster, so the change should be negative.
    const comparison = computeComparison(recent, previous);

    expect(comparison.paceChangeSecondsPerKm).toBeLessThan(0);
    expect(comparison.paceChangeSecondsPerKm).toBeCloseTo(300 - 330, 5);
  });

  it("returns a positive pace change when recent is slower", () => {
    const comparison = computeComparison(previous, recent);

    expect(comparison.paceChangeSecondsPerKm).toBeGreaterThan(0);
  });

  it("returns null pace/HR change when either side has no data", () => {
    const emptyAggregate = aggregateRuns([]);
    const comparison = computeComparison(emptyAggregate, previous);

    expect(comparison.paceChangeSecondsPerKm).toBeNull();
    expect(comparison.averageHeartRateChange).toBeNull();
  });

  it("computes run count, moving time, and training load changes", () => {
    const comparison = computeComparison(recent, previous);

    expect(comparison.runCountChange).toBe(0);
    expect(comparison.movingTimeChangeSeconds).toBe(2700);
    expect(comparison.trainingLoadChange).toBe(40);
  });
});

describe("computeDataQuality", () => {
  it("flags enough data when both periods have at least 2 runs", () => {
    const quality = computeDataQuality(2, 2);

    expect(quality.enoughRunsForComparison).toBe(true);
    expect(quality.notes).toEqual([]);
  });

  it("flags insufficient data and adds a note when either period has fewer than 2 runs", () => {
    const quality = computeDataQuality(1, 3);

    expect(quality.enoughRunsForComparison).toBe(false);
    expect(quality.notes.length).toBeGreaterThan(0);
    expect(quality.recentRunCount).toBe(1);
    expect(quality.previousRunCount).toBe(3);
  });

  it("flags insufficient data when both periods have zero runs", () => {
    const quality = computeDataQuality(0, 0);

    expect(quality.enoughRunsForComparison).toBe(false);
  });
});

describe("computeVo2MaxTrend", () => {
  it("returns latest, earliest, and change from non-null observations", () => {
    const days = [
      makeWellnessDay({ date: "2026-06-01", vo2Max: 46 }),
      makeWellnessDay({ date: "2026-09-01", vo2Max: 47 }),
    ];

    const trend = computeVo2MaxTrend(days);

    expect(trend.earliest).toEqual({ value: 46, date: "2026-06-01" });
    expect(trend.latest).toEqual({ value: 47, date: "2026-09-01" });
    expect(trend.change).toBe(1);
  });

  it("ignores null vo2Max observations without interpolating", () => {
    const days = [
      makeWellnessDay({ date: "2026-06-01", vo2Max: 46 }),
      makeWellnessDay({ date: "2026-07-01", vo2Max: null }),
      makeWellnessDay({ date: "2026-08-01", vo2Max: null }),
      makeWellnessDay({ date: "2026-09-01", vo2Max: 47 }),
    ];

    const trend = computeVo2MaxTrend(days);

    expect(trend.observations).toHaveLength(2);
    expect(trend.observations).toEqual([
      { date: "2026-06-01", value: 46 },
      { date: "2026-09-01", value: 47 },
    ]);
  });

  it("returns nulls and an empty observations array when there are no VO2 max observations at all", () => {
    const days = [makeWellnessDay({ vo2Max: null }), makeWellnessDay({ vo2Max: null })];

    const trend = computeVo2MaxTrend(days);

    expect(trend).toEqual({ latest: null, earliest: null, change: null, observations: [] });
  });

  it("handles a single observation (earliest and latest are the same day, change is 0)", () => {
    const days = [makeWellnessDay({ date: "2026-09-01", vo2Max: 47 })];

    const trend = computeVo2MaxTrend(days);

    expect(trend.earliest).toEqual(trend.latest);
    expect(trend.change).toBe(0);
  });

  it("sorts observations oldest to newest regardless of input order", () => {
    const days = [
      makeWellnessDay({ date: "2026-09-01", vo2Max: 47 }),
      makeWellnessDay({ date: "2026-06-01", vo2Max: 46 }),
    ];

    const trend = computeVo2MaxTrend(days);

    expect(trend.observations.map((o) => o.date)).toEqual(["2026-06-01", "2026-09-01"]);
  });
});
