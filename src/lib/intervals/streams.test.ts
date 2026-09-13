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

const { getRunStreams, getRunStreamsParamsSchema } = await import("./streams");
const { IntervalsApiError } = await import("@/lib/intervals/client");

function makeStreams(pointCount: number) {
  const time = Array.from({ length: pointCount }, (_, i) => i);
  const heartrate = Array.from({ length: pointCount }, (_, i) => 140 + (i % 10));
  const distance = Array.from({ length: pointCount }, (_, i) => i * 2.8);
  return [
    { type: "time", data: time },
    { type: "heartrate", data: heartrate },
    { type: "distance", data: distance },
    { type: "velocity_smooth", data: Array.from({ length: pointCount }, () => 2.8) },
  ];
}

beforeEach(() => {
  intervalsGetMock.mockReset();
});

describe("getRunStreamsParamsSchema (MCP input validation)", () => {
  it("requires a non-empty activityId", () => {
    expect(() => getRunStreamsParamsSchema.parse({ activityId: "" })).toThrow();
    expect(() => getRunStreamsParamsSchema.parse({})).toThrow();
  });

  it("defaults maxPoints to 600", () => {
    const parsed = getRunStreamsParamsSchema.parse({ activityId: "i1" });
    expect(parsed.maxPoints).toBe(600);
  });

  it("rejects maxPoints below the minimum or above the maximum", () => {
    expect(() => getRunStreamsParamsSchema.parse({ activityId: "i1", maxPoints: 99 })).toThrow();
    expect(() => getRunStreamsParamsSchema.parse({ activityId: "i1", maxPoints: 1001 })).toThrow();
  });

  it("rejects a non-integer maxPoints", () => {
    expect(() => getRunStreamsParamsSchema.parse({ activityId: "i1", maxPoints: 250.5 })).toThrow();
  });

  it("accepts maxPoints at the boundaries", () => {
    expect(getRunStreamsParamsSchema.parse({ activityId: "i1", maxPoints: 100 }).maxPoints).toBe(100);
    expect(getRunStreamsParamsSchema.parse({ activityId: "i1", maxPoints: 1000 }).maxPoints).toBe(1000);
  });
});

describe("getRunStreams", () => {
  it("returns all points unsampled when originalPointCount <= maxPoints", async () => {
    intervalsGetMock.mockResolvedValueOnce(makeStreams(300));

    const result = await getRunStreams({ activityId: "i1", maxPoints: 600 });

    expect(result.originalPointCount).toBe(300);
    expect(result.returnedPointCount).toBe(300);
    expect(result.points).toHaveLength(300);
    expect(result.availableStreams).toEqual(["time", "heartrate", "distance", "velocity_smooth"]);
  });

  it("downsamples to at most maxPoints when originalPointCount > maxPoints", async () => {
    intervalsGetMock.mockResolvedValueOnce(makeStreams(3319));

    const result = await getRunStreams({ activityId: "i1", maxPoints: 600 });

    expect(result.originalPointCount).toBe(3319);
    expect(result.returnedPointCount).toBe(600);
    expect(result.points).toHaveLength(600);
    // First and last recorded instants must survive downsampling.
    expect(result.points[0].elapsedSeconds).toBe(0);
    expect(result.points[result.points.length - 1].elapsedSeconds).toBe(3318);
  });

  it("reports a sampling interval consistent with the returned points", async () => {
    intervalsGetMock.mockResolvedValueOnce(makeStreams(3319));

    const result = await getRunStreams({ activityId: "i1", maxPoints: 600 });

    expect(result.samplingIntervalSeconds).not.toBeNull();
    expect(result.samplingIntervalSeconds).toBeGreaterThan(1);
  });

  it("returns a valid, non-crashing response when the activity has no streams at all", async () => {
    intervalsGetMock.mockResolvedValueOnce([]);

    const result = await getRunStreams({ activityId: "i1", maxPoints: 600 });

    expect(result.originalPointCount).toBe(0);
    expect(result.returnedPointCount).toBe(0);
    expect(result.availableStreams).toEqual([]);
    expect(result.points).toEqual([]);
    expect(result.samplingIntervalSeconds).toBeNull();
  });

  it("handles a response missing some stream types gracefully", async () => {
    intervalsGetMock.mockResolvedValueOnce([{ type: "time", data: [0, 1, 2] }]);

    const result = await getRunStreams({ activityId: "i1", maxPoints: 600 });

    expect(result.points).toHaveLength(3);
    for (const point of result.points) {
      expect(point.heartRate).toBeNull();
      expect(point.power).toBeNull();
    }
  });

  it("throws a clean 'not found' error for a 404 from Intervals.icu", async () => {
    intervalsGetMock.mockRejectedValueOnce(
      new IntervalsApiError("Intervals.icu request failed with status 404.", 404)
    );

    await expect(getRunStreams({ activityId: "i-missing" })).rejects.toThrow(
      "Running activity not found."
    );
  });

  it("propagates non-404 Intervals.icu errors unchanged", async () => {
    intervalsGetMock.mockRejectedValueOnce(new IntervalsApiError("Intervals.icu rate limit reached. Please try again later.", 429));

    await expect(getRunStreams({ activityId: "i1" })).rejects.toThrow(
      "Intervals.icu rate limit reached. Please try again later."
    );
  });

  it("rejects invalid params before making a network request", async () => {
    await expect(getRunStreams({ activityId: "", maxPoints: 600 })).rejects.toThrow();
    await expect(getRunStreams({ activityId: "i1", maxPoints: 5000 })).rejects.toThrow();
    expect(intervalsGetMock).not.toHaveBeenCalled();
  });
});
