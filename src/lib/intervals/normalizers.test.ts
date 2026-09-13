import { describe, expect, it } from "vitest";

import { isRunningActivityType, normalizeActivity } from "./normalizers";
import type { IntervalsActivity } from "@/types/activity";

function makeRawActivity(overrides: Partial<IntervalsActivity> = {}): IntervalsActivity {
  return {
    id: "i123",
    name: "Morning Run",
    type: "Run",
    start_date_local: "2026-09-10T07:00:00",
    start_date: "2026-09-10T05:00:00Z",
    distance: 5000,
    moving_time: 1740,
    elapsed_time: 1800,
    total_elevation_gain: 42,
    average_speed: 2.87,
    average_heartrate: 150,
    max_heartrate: 172,
    average_cadence: 168,
    icu_training_load: 55,
    icu_intensity: 70,
    icu_ctl: 40,
    icu_atl: 45,
    icu_rpe: 5,
    perceived_exertion: null,
    feel: 3,
    source: "GARMIN",
    decoupling: 4.2,
    ...overrides,
  };
}

describe("isRunningActivityType", () => {
  it("accepts Run, TrailRun, and VirtualRun", () => {
    expect(isRunningActivityType("Run")).toBe(true);
    expect(isRunningActivityType("TrailRun")).toBe(true);
    expect(isRunningActivityType("VirtualRun")).toBe(true);
  });

  it("rejects other activity types", () => {
    expect(isRunningActivityType("Ride")).toBe(false);
    expect(isRunningActivityType("Swim")).toBe(false);
  });

  it("rejects null/undefined", () => {
    expect(isRunningActivityType(null)).toBe(false);
    expect(isRunningActivityType(undefined)).toBe(false);
  });
});

describe("normalizeActivity", () => {
  it("normalizes a fully populated activity, computing distance and pace", () => {
    const result = normalizeActivity(makeRawActivity());

    expect(result.id).toBe("i123");
    expect(result.date).toBe("2026-09-10T07:00:00");
    expect(result.name).toBe("Morning Run");
    expect(result.distanceKm).toBe(5);
    expect(result.movingTimeSeconds).toBe(1740);
    expect(result.elapsedTimeSeconds).toBe(1800);
    // 1740s / 5km = 348s/km = 5:48/km
    expect(result.paceSecondsPerKm).toBe(348);
    expect(result.pace).toBe("5:48/km");
    expect(result.averageHeartRate).toBe(150);
    expect(result.maxHeartRate).toBe(172);
    expect(result.elevationGainMeters).toBe(42);
    expect(result.averageCadence).toBe(168);
    expect(result.trainingLoad).toBe(55);
    expect(result.intensity).toBe(70);
    expect(result.fitness).toBe(40);
    expect(result.fatigue).toBe(45);
    expect(result.rpe).toBe(5);
    expect(result.feel).toBe(3);
    expect(result.decoupling).toBe(4.2);
    expect(result.source).toBe("GARMIN");
  });

  it("falls back to start_date when start_date_local is missing", () => {
    const result = normalizeActivity(makeRawActivity({ start_date_local: null }));
    expect(result.date).toBe("2026-09-10T05:00:00Z");
  });

  it("does not compute pace when distance is missing", () => {
    const result = normalizeActivity(makeRawActivity({ distance: null }));
    expect(result.distanceKm).toBe(0);
    expect(result.paceSecondsPerKm).toBeNull();
    expect(result.pace).toBeNull();
  });

  it("falls back to perceived_exertion when icu_rpe is missing", () => {
    const result = normalizeActivity(makeRawActivity({ icu_rpe: null, perceived_exertion: 7 }));
    expect(result.rpe).toBe(7);
  });

  it("handles a mostly-empty activity without throwing", () => {
    const result = normalizeActivity(
      makeRawActivity({
        distance: null,
        moving_time: null,
        elapsed_time: null,
        average_heartrate: null,
        max_heartrate: null,
        total_elevation_gain: null,
        average_cadence: null,
        icu_training_load: null,
        icu_intensity: null,
        icu_ctl: null,
        icu_atl: null,
        icu_rpe: null,
        perceived_exertion: null,
        feel: null,
        decoupling: null,
        source: null,
      })
    );

    expect(result.distanceKm).toBe(0);
    expect(result.movingTimeSeconds).toBe(0);
    expect(result.paceSecondsPerKm).toBeNull();
    expect(result.pace).toBeNull();
  });
});
