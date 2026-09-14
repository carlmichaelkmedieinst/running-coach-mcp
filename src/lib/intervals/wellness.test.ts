import { beforeEach, describe, expect, it, vi } from "vitest";

const intervalsGetMock = vi.fn();

vi.mock("@/lib/intervals/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/intervals/client")>(
    "@/lib/intervals/client"
  );
  return {
    ...actual,
    intervalsGet: (...args: unknown[]) => intervalsGetMock(...args),
  };
});

const { getWellness, getWellnessParamsSchema } = await import("./wellness");
const { IntervalsApiError } = await import("@/lib/intervals/client");

function rawEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "2026-09-13",
    restingHR: 53,
    hrv: 50,
    sleepSecs: 14220,
    sleepScore: 44,
    sleepQuality: 4,
    weight: null,
    vo2max: 47,
    ctl: 4.77,
    atl: 16.45,
    ...overrides,
  };
}

beforeEach(() => {
  intervalsGetMock.mockReset();
});

describe("getWellnessParamsSchema (MCP input validation)", () => {
  it("defaults days to 30", () => {
    expect(getWellnessParamsSchema.parse({}).days).toBe(30);
  });

  it("rejects days below the minimum or above the maximum", () => {
    expect(() => getWellnessParamsSchema.parse({ days: 6 })).toThrow();
    expect(() => getWellnessParamsSchema.parse({ days: 366 })).toThrow();
  });

  it("accepts days at the boundaries", () => {
    expect(getWellnessParamsSchema.parse({ days: 7 }).days).toBe(7);
    expect(getWellnessParamsSchema.parse({ days: 365 }).days).toBe(365);
  });

  it("rejects a non-integer days value", () => {
    expect(() => getWellnessParamsSchema.parse({ days: 30.5 })).toThrow();
  });
});

describe("getWellness", () => {
  it("returns a valid, empty-but-well-formed response when there is no wellness data", async () => {
    intervalsGetMock.mockResolvedValueOnce([]);

    const result = await getWellness({ days: 30 });

    expect(result.daysRequested).toBe(30);
    expect(result.entriesReturned).toBe(0);
    expect(result.latest).toBeNull();
    expect(result.days).toEqual([]);
    for (const metric of Object.values(result.latestNonNull)) {
      expect(metric).toBeNull();
    }
  });

  it("sorts days newest first", async () => {
    intervalsGetMock.mockResolvedValueOnce([
      rawEntry({ id: "2026-09-10" }),
      rawEntry({ id: "2026-09-13" }),
      rawEntry({ id: "2026-09-12" }),
    ]);

    const result = await getWellness({ days: 30 });

    expect(result.days.map((d) => d.date)).toEqual(["2026-09-13", "2026-09-12", "2026-09-10"]);
    expect(result.latest?.date).toBe("2026-09-13");
  });

  it("normalizes resting heart rate, HRV, sleep, and weight correctly", async () => {
    intervalsGetMock.mockResolvedValueOnce([
      rawEntry({
        restingHR: 49,
        hrv: 59,
        sleepSecs: 19140,
        sleepScore: 57,
        sleepQuality: 4,
        weight: 88,
      }),
    ]);

    const result = await getWellness({ days: 30 });

    expect(result.latest).toMatchObject({
      restingHeartRate: 49,
      hrv: 59,
      sleepSeconds: 19140,
      sleepScore: 57,
      sleepQuality: 4,
      weightKg: 88,
    });
  });

  it("finds the latest non-null VO2 max across sparse history, independent of the latest day", async () => {
    // Newest day has a null vo2max; an earlier day has a real value.
    intervalsGetMock.mockResolvedValueOnce([
      rawEntry({ id: "2026-09-14", vo2max: null }),
      rawEntry({ id: "2026-09-13", vo2max: 47 }),
      rawEntry({ id: "2026-09-12", vo2max: null }),
      rawEntry({ id: "2026-09-10", vo2max: 46 }),
    ]);

    const result = await getWellness({ days: 30 });

    expect(result.latest?.vo2Max).toBeNull();
    expect(result.latestNonNull.vo2Max).toEqual({ value: 47, date: "2026-09-13" });
  });

  it("applies the same latest-non-null logic to other sparse metrics", async () => {
    intervalsGetMock.mockResolvedValueOnce([
      rawEntry({ id: "2026-09-14", sleepSecs: null, sleepScore: null, weight: null }),
      rawEntry({ id: "2026-09-13", sleepSecs: 14220, sleepScore: 44, weight: 88 }),
    ]);

    const result = await getWellness({ days: 30 });

    expect(result.latestNonNull.sleepSeconds).toEqual({ value: 14220, date: "2026-09-13" });
    expect(result.latestNonNull.sleepScore).toEqual({ value: 44, date: "2026-09-13" });
    expect(result.latestNonNull.weightKg).toEqual({ value: 88, date: "2026-09-13" });
  });

  it("returns null for latestNonNull metrics that are null on every day in range", async () => {
    intervalsGetMock.mockResolvedValueOnce([
      rawEntry({ id: "2026-09-13", vo2max: null, weight: null }),
      rawEntry({ id: "2026-09-12", vo2max: null, weight: null }),
    ]);

    const result = await getWellness({ days: 30 });

    expect(result.latestNonNull.vo2Max).toBeNull();
    expect(result.latestNonNull.weightKg).toBeNull();
  });

  it("reports entriesReturned separately from daysRequested when Intervals has fewer rows than requested", async () => {
    intervalsGetMock.mockResolvedValueOnce([rawEntry({ id: "2026-09-13" }), rawEntry({ id: "2026-09-10" })]);

    const result = await getWellness({ days: 90 });

    expect(result.daysRequested).toBe(90);
    expect(result.entriesReturned).toBe(2);
    expect(result.days).toHaveLength(2);
  });

  it("propagates Intervals.icu errors (e.g. auth failures) unchanged", async () => {
    intervalsGetMock.mockRejectedValueOnce(
      new IntervalsApiError("Intervals.icu authentication failed.", 401)
    );

    await expect(getWellness({ days: 30 })).rejects.toThrow("Intervals.icu authentication failed.");
  });

  it("rejects invalid params before making a network request", async () => {
    await expect(getWellness({ days: 3 })).rejects.toThrow();
    await expect(getWellness({ days: 400 })).rejects.toThrow();
    expect(intervalsGetMock).not.toHaveBeenCalled();
  });

  it("defaults to 30 days when no params are given", async () => {
    intervalsGetMock.mockResolvedValueOnce([]);
    await getWellness();
    expect(intervalsGetMock).toHaveBeenCalledTimes(1);
  });
});
