import { describe, expect, it } from "vitest";

import { normalizeWellnessEntry } from "./wellnessNormalizers";
import type { IntervalsWellnessEntry } from "@/types/wellness";

function makeRawEntry(overrides: Partial<IntervalsWellnessEntry> = {}): IntervalsWellnessEntry {
  return {
    id: "2026-09-13",
    restingHR: 53,
    hrv: 50,
    sleepSecs: 14220,
    sleepScore: 44,
    sleepQuality: 4,
    weight: 88,
    vo2max: 47,
    ctl: 4.7745337,
    atl: 16.446205,
    ...overrides,
  };
}

describe("normalizeWellnessEntry", () => {
  it("normalizes a fully populated entry", () => {
    const result = normalizeWellnessEntry(makeRawEntry());

    expect(result.date).toBe("2026-09-13");
    expect(result.restingHeartRate).toBe(53);
    expect(result.hrv).toBe(50);
    expect(result.sleepSeconds).toBe(14220);
    expect(result.sleepScore).toBe(44);
    expect(result.sleepQuality).toBe(4);
    expect(result.weightKg).toBe(88);
    expect(result.vo2Max).toBe(47);
    expect(result.fitnessCtl).toBeCloseTo(4.7745337);
    expect(result.fatigueAtl).toBeCloseTo(16.446205);
  });

  it("passes through the raw id as the date, unmodified", () => {
    const result = normalizeWellnessEntry(makeRawEntry({ id: "2026-01-01" }));
    expect(result.date).toBe("2026-01-01");
  });

  it("uses null for every missing/null metric (sparse day)", () => {
    const result = normalizeWellnessEntry(
      makeRawEntry({
        restingHR: null,
        hrv: null,
        sleepSecs: null,
        sleepScore: null,
        sleepQuality: null,
        weight: null,
        vo2max: null,
        ctl: null,
        atl: null,
      })
    );

    expect(result.restingHeartRate).toBeNull();
    expect(result.hrv).toBeNull();
    expect(result.sleepSeconds).toBeNull();
    expect(result.sleepScore).toBeNull();
    expect(result.sleepQuality).toBeNull();
    expect(result.weightKg).toBeNull();
    expect(result.vo2Max).toBeNull();
    expect(result.fitnessCtl).toBeNull();
    expect(result.fatigueAtl).toBeNull();
  });

  it("normalizes a null vo2max on its own (the common sparse case)", () => {
    const result = normalizeWellnessEntry(makeRawEntry({ vo2max: null }));
    expect(result.vo2Max).toBeNull();
  });

  it("normalizes a valid vo2max value", () => {
    const result = normalizeWellnessEntry(makeRawEntry({ vo2max: 46 }));
    expect(result.vo2Max).toBe(46);
  });

  it("rejects NaN and Infinity, returning null instead", () => {
    const result = normalizeWellnessEntry(
      makeRawEntry({
        restingHR: Number.NaN,
        hrv: Number.POSITIVE_INFINITY,
        vo2max: Number.NEGATIVE_INFINITY,
      })
    );

    expect(result.restingHeartRate).toBeNull();
    expect(result.hrv).toBeNull();
    expect(result.vo2Max).toBeNull();
  });
});
