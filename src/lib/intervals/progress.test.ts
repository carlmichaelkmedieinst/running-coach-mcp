import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunningActivity } from "@/types/activity";
import type { DailyWellness, WellnessResult } from "@/types/wellness";

const getRunningActivitiesInRangeMock = vi.fn();
const getWellnessMock = vi.fn();

vi.mock("@/lib/intervals/activities", async () => {
  const actual = await vi.importActual<typeof import("@/lib/intervals/activities")>(
    "@/lib/intervals/activities"
  );
  return {
    ...actual,
    getRunningActivitiesInRange: (...args: unknown[]) => getRunningActivitiesInRangeMock(...args),
  };
});

vi.mock("@/lib/intervals/wellness", async () => {
  const actual = await vi.importActual<typeof import("@/lib/intervals/wellness")>(
    "@/lib/intervals/wellness"
  );
  return {
    ...actual,
    getWellness: (...args: unknown[]) => getWellnessMock(...args),
  };
});

const { getRunningProgress, getRunningProgressParamsSchema } = await import("./progress");

// Fixed "now" so recent/previous window boundaries are deterministic:
// 2026-09-14T10:00:00Z = 2026-09-14T12:00 in the default athlete timezone
// (Europe/Stockholm, UTC+2 in September) — pinned to an explicit UTC
// instant (rather than a zone-less local string) so this test doesn't
// depend on the test-running machine's own local timezone. 2026-09-14 is
// a Monday.
const NOW = new Date("2026-09-14T10:00:00Z");

function makeRun(overrides: Partial<RunningActivity> = {}): RunningActivity {
  return {
    id: "r1",
    date: "2026-09-14T08:00:00",
    name: null,
    distanceKm: 10,
    movingTimeSeconds: 3000,
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
    date: "2026-09-14",
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

function emptyWellnessResult(daysRequested: number, days: DailyWellness[] = []): WellnessResult {
  return {
    daysRequested,
    entriesReturned: days.length,
    latest: days[0] ?? null,
    latestNonNull: {
      restingHeartRate: null,
      hrv: null,
      sleepSeconds: null,
      sleepScore: null,
      sleepQuality: null,
      weightKg: null,
      vo2Max: null,
    },
    days,
  };
}

beforeEach(() => {
  // Ensure boundaries are computed against the default athlete timezone
  // (Europe/Stockholm), regardless of the ambient test environment.
  delete process.env.ATHLETE_TIME_ZONE;

  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  getRunningActivitiesInRangeMock.mockReset();
  getWellnessMock.mockReset();
  getRunningActivitiesInRangeMock.mockResolvedValue([]);
  getWellnessMock.mockResolvedValue(emptyWellnessResult(90));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getRunningProgressParamsSchema", () => {
  it("defaults days to 90 and comparisonDays to 14", () => {
    const parsed = getRunningProgressParamsSchema.parse({});
    expect(parsed.days).toBe(90);
    expect(parsed.comparisonDays).toBe(14);
  });

  it("rejects days below 14 or above 365", () => {
    expect(() => getRunningProgressParamsSchema.parse({ days: 13 })).toThrow();
    expect(() => getRunningProgressParamsSchema.parse({ days: 366 })).toThrow();
  });

  it("accepts days at the boundaries", () => {
    expect(getRunningProgressParamsSchema.parse({ days: 14 }).days).toBe(14);
    expect(getRunningProgressParamsSchema.parse({ days: 365 }).days).toBe(365);
  });

  it("rejects comparisonDays below 7 or above 56", () => {
    expect(() => getRunningProgressParamsSchema.parse({ comparisonDays: 6 })).toThrow();
    expect(() => getRunningProgressParamsSchema.parse({ comparisonDays: 57 })).toThrow();
  });

  it("accepts comparisonDays at the boundaries", () => {
    expect(getRunningProgressParamsSchema.parse({ comparisonDays: 7 }).comparisonDays).toBe(7);
    expect(getRunningProgressParamsSchema.parse({ comparisonDays: 56 }).comparisonDays).toBe(56);
  });

  it("rejects non-integer values", () => {
    expect(() => getRunningProgressParamsSchema.parse({ days: 90.5 })).toThrow();
    expect(() => getRunningProgressParamsSchema.parse({ comparisonDays: 14.5 })).toThrow();
  });
});

describe("getRunningProgress", () => {
  it("returns a well-formed, empty-but-valid result when there is no activity or wellness data", async () => {
    const result = await getRunningProgress({ days: 90, comparisonDays: 14 });

    expect(result.daysRequested).toBe(90);
    expect(result.comparisonDays).toBe(14);
    expect(result.period.runCount).toBe(0);
    expect(result.period.distanceKm).toBe(0);
    expect(result.period.averagePaceSecondsPerKm).toBeNull();
    expect(result.recentPeriod.runCount).toBe(0);
    expect(result.previousPeriod.runCount).toBe(0);
    expect(result.comparison.distanceChangePercent).toBeNull();
    expect(result.weekly).toEqual([]);
    expect(result.paceByAverageHeartRateBand).toEqual([]);
    expect(result.vo2MaxTrend).toEqual({ latest: null, earliest: null, change: null, observations: [] });
    expect(result.dataQuality.enoughRunsForComparison).toBe(false);
  });

  it("splits runs correctly into recentPeriod (last comparisonDays) vs previousPeriod (the comparisonDays before that)", async () => {
    // now = 2026-09-14. comparisonDays=14 => recent: 2026-09-01..2026-09-14.
    // previous: 2026-08-18..2026-08-31.
    const recentRun = makeRun({ id: "recent", date: "2026-09-05T08:00:00" });
    const previousRun = makeRun({ id: "previous", date: "2026-08-20T08:00:00" });
    const outOfRangeOldRun = makeRun({ id: "old", date: "2026-07-01T08:00:00" });

    getRunningActivitiesInRangeMock.mockResolvedValue([recentRun, previousRun, outOfRangeOldRun]);

    const result = await getRunningProgress({ days: 90, comparisonDays: 14 });

    expect(result.recentPeriod.runCount).toBe(1);
    expect(result.recentPeriod.startDate).toBe("2026-09-01");
    expect(result.recentPeriod.endDate).toBe("2026-09-14");

    expect(result.previousPeriod.runCount).toBe(1);
    expect(result.previousPeriod.startDate).toBe("2026-08-18");
    expect(result.previousPeriod.endDate).toBe("2026-08-31");

    // The full `period` (90 days) includes all three runs.
    expect(result.period.runCount).toBe(3);
  });

  it("excludes a run on the boundary day before previousPeriod from both comparison windows", async () => {
    // previousPeriod starts 2026-08-18 for comparisonDays=14; a run on
    // 2026-08-17 should be excluded from previousPeriod (but still counted
    // in the overall `period`).
    const boundaryRun = makeRun({ id: "boundary", date: "2026-08-17T08:00:00" });
    getRunningActivitiesInRangeMock.mockResolvedValue([boundaryRun]);

    const result = await getRunningProgress({ days: 90, comparisonDays: 14 });

    expect(result.previousPeriod.runCount).toBe(0);
    expect(result.recentPeriod.runCount).toBe(0);
    expect(result.period.runCount).toBe(1);
  });

  it("flags insufficient comparison data when either window has fewer than 2 runs", async () => {
    getRunningActivitiesInRangeMock.mockResolvedValue([
      makeRun({ id: "recent-1", date: "2026-09-05T08:00:00" }),
    ]);

    const result = await getRunningProgress({ days: 90, comparisonDays: 14 });

    expect(result.dataQuality.enoughRunsForComparison).toBe(false);
    expect(result.dataQuality.recentRunCount).toBe(1);
    expect(result.dataQuality.notes.length).toBeGreaterThan(0);
  });

  it("reports enough comparison data when both windows have at least 2 runs", async () => {
    getRunningActivitiesInRangeMock.mockResolvedValue([
      makeRun({ id: "r1", date: "2026-09-05T08:00:00" }),
      makeRun({ id: "r2", date: "2026-09-08T08:00:00" }),
      makeRun({ id: "p1", date: "2026-08-20T08:00:00" }),
      makeRun({ id: "p2", date: "2026-08-25T08:00:00" }),
    ]);

    const result = await getRunningProgress({ days: 90, comparisonDays: 14 });

    expect(result.dataQuality.enoughRunsForComparison).toBe(true);
    expect(result.dataQuality.notes).toEqual([]);
  });

  it("widens the fetch window beyond `days` when comparisonDays would otherwise exceed it", async () => {
    // days=14 (minimum), comparisonDays=56 (maximum): 2*56=112 > 14.
    await getRunningProgress({ days: 14, comparisonDays: 56 });

    expect(getRunningActivitiesInRangeMock).toHaveBeenCalledWith(
      expect.objectContaining({ days: 112 })
    );
    expect(getWellnessMock).toHaveBeenCalledWith(expect.objectContaining({ days: 112 }));
  });

  it("uses `days` as the fetch window when it already covers 2 * comparisonDays", async () => {
    await getRunningProgress({ days: 90, comparisonDays: 14 });

    expect(getRunningActivitiesInRangeMock).toHaveBeenCalledWith(expect.objectContaining({ days: 90 }));
  });

  it("builds the VO2 max trend from wellness data within the requested period only", async () => {
    getWellnessMock.mockResolvedValue(
      emptyWellnessResult(90, [
        makeWellnessDay({ date: "2026-09-14", vo2Max: 47 }),
        makeWellnessDay({ date: "2026-06-01", vo2Max: 46 }),
        // Outside the 90-day period window (before periodStart).
        makeWellnessDay({ date: "2025-01-01", vo2Max: 40 }),
      ])
    );

    const result = await getRunningProgress({ days: 90, comparisonDays: 14 });

    expect(result.vo2MaxTrend.latest).toEqual({ value: 47, date: "2026-09-14" });
    expect(result.vo2MaxTrend.observations.map((o) => o.date)).not.toContain("2025-01-01");
  });

  it("groups the full period's runs into weekly buckets and HR bands", async () => {
    getRunningActivitiesInRangeMock.mockResolvedValue([
      makeRun({ id: "a", date: "2026-09-08T08:00:00", averageHeartRate: 150 }),
      makeRun({ id: "b", date: "2026-09-01T08:00:00", averageHeartRate: 160 }),
    ]);

    const result = await getRunningProgress({ days: 90, comparisonDays: 14 });

    expect(result.weekly.length).toBeGreaterThan(0);
    expect(result.paceByAverageHeartRateBand.length).toBeGreaterThan(0);
  });
});
