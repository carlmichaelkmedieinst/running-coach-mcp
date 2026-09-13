import { describe, expect, it } from "vitest";

import {
  buildStreamPoints,
  isRunningActivityType,
  normalizeActivity,
  normalizeActivityDetail,
  normalizeInterval,
} from "./normalizers";
import type { IntervalsActivity } from "@/types/activity";
import type { IntervalsInterval } from "@/types/interval";
import type { IntervalsStream } from "@/types/stream";

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

function makeRawInterval(overrides: Partial<IntervalsInterval> = {}): IntervalsInterval {
  return {
    id: 4857895,
    type: "WORK",
    label: null,
    start_index: 0,
    end_index: 330,
    start_time: 0,
    end_time: 330,
    distance: 1000,
    moving_time: 330,
    elapsed_time: 330,
    average_heartrate: 141,
    max_heartrate: 158,
    average_cadence: 75.3,
    // Real-world Intervals.icu units: meters/second, not seconds/km.
    average_speed: 3.03,
    average_watts: null,
    total_elevation_gain: 4.2,
    gap: 3.04,
    decoupling: null,
    ...overrides,
  };
}

describe("normalizeInterval", () => {
  it("computes pace from distance + moving time, not from average_speed", () => {
    const result = normalizeInterval(makeRawInterval({ distance: 1000, moving_time: 330 }));

    // 330s / 1km = 330s/km = 5:30/km — independent of the raw average_speed value.
    expect(result.paceSecondsPerKm).toBe(330);
    expect(result.pace).toBe("5:30/km");
  });

  it("stringifies the numeric interval id", () => {
    const result = normalizeInterval(makeRawInterval({ id: 4857895 }));
    expect(result.id).toBe("4857895");
  });

  it("converts the raw gap (meters/second) into a formatted pace string", () => {
    // 1000 / 3.04 ≈ 328.9s/km ≈ 5:29/km
    const result = normalizeInterval(makeRawInterval({ gap: 3.04 }));
    expect(result.gap).toBe("5:29/km");
  });

  it("passes through heart rate, cadence, power, elevation, and decoupling", () => {
    const result = normalizeInterval(
      makeRawInterval({
        average_heartrate: 152,
        max_heartrate: 160,
        average_cadence: 74.5,
        average_watts: 250,
        total_elevation_gain: 11.8,
        decoupling: 3.1,
      })
    );

    expect(result.averageHeartRate).toBe(152);
    expect(result.maxHeartRate).toBe(160);
    expect(result.averageCadence).toBe(74.5);
    expect(result.averagePower).toBe(250);
    expect(result.elevationGainMeters).toBe(11.8);
    expect(result.decoupling).toBe(3.1);
  });

  it("returns null for pace/gap when the required raw fields are missing", () => {
    const result = normalizeInterval(
      makeRawInterval({ distance: null, moving_time: null, elapsed_time: null, gap: null })
    );

    expect(result.paceSecondsPerKm).toBeNull();
    expect(result.pace).toBeNull();
    expect(result.gap).toBeNull();
  });

  it("falls back to elapsed_time when moving_time is missing", () => {
    const result = normalizeInterval(
      makeRawInterval({ distance: 1000, moving_time: null, elapsed_time: 300 })
    );

    expect(result.durationSeconds).toBe(300);
    expect(result.paceSecondsPerKm).toBe(300);
  });
});

describe("normalizeActivityDetail", () => {
  it("extends normalizeActivity with type, averagePower, availableStreams, and intervals", () => {
    const rawActivity = makeRawActivity({
      icu_average_watts: 245,
      stream_types: ["time", "heartrate", "distance"],
    });
    const rawIntervals = [makeRawInterval()];

    const result = normalizeActivityDetail(rawActivity, rawIntervals);

    // Base RunningActivity fields still present (reused from normalizeActivity).
    expect(result.id).toBe(rawActivity.id);
    expect(result.distanceKm).toBe(5);

    expect(result.type).toBe("Run");
    expect(result.averagePower).toBe(245);
    expect(result.availableStreams).toEqual(["time", "heartrate", "distance"]);
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0].id).toBe("4857895");
  });

  it("defaults averagePower and availableStreams to null/empty when absent", () => {
    const result = normalizeActivityDetail(
      makeRawActivity({ icu_average_watts: null, icu_weighted_avg_watts: null, stream_types: null }),
      []
    );

    expect(result.averagePower).toBeNull();
    expect(result.availableStreams).toEqual([]);
    expect(result.intervals).toEqual([]);
  });
});

function makeRawStream(type: string, data: Array<number | null>): IntervalsStream {
  return { type, data };
}

describe("buildStreamPoints", () => {
  it("zips index-aligned streams into per-instant points", () => {
    const rawStreams: IntervalsStream[] = [
      makeRawStream("time", [0, 1, 2]),
      makeRawStream("distance", [0, 2.75, 5.57]),
      makeRawStream("heartrate", [140, 141, 142]),
      makeRawStream("cadence", [76, 77, 77]),
      makeRawStream("watts", [320, 329, 337]),
      makeRawStream("altitude", [12, 12, 11.8]),
      makeRawStream("velocity_smooth", [2.6, 2.62, 2.65]),
    ];

    const { points, availableStreams } = buildStreamPoints(rawStreams);

    expect(availableStreams).toEqual([
      "time",
      "distance",
      "heartrate",
      "cadence",
      "watts",
      "altitude",
      "velocity_smooth",
    ]);
    expect(points).toHaveLength(3);
    expect(points[1]).toMatchObject({
      elapsedSeconds: 1,
      distanceMeters: 2.75,
      heartRate: 141,
      cadence: 77,
      power: 329,
      altitude: 12,
    });
    // 1000 / 2.62 ≈ 381.7 s/km
    expect(points[1].paceSecondsPerKm).toBeCloseTo(381.68, 1);
    expect(points[1].pace).toBe("6:22/km");
  });

  it("returns null metrics for streams that are entirely missing", () => {
    const rawStreams: IntervalsStream[] = [
      makeRawStream("time", [0, 1, 2]),
      makeRawStream("heartrate", [140, 141, 142]),
    ];

    const { points, availableStreams } = buildStreamPoints(rawStreams);

    expect(availableStreams).toEqual(["time", "heartrate"]);
    expect(points).toHaveLength(3);
    for (const point of points) {
      expect(point.distanceMeters).toBeNull();
      expect(point.cadence).toBeNull();
      expect(point.power).toBeNull();
      expect(point.altitude).toBeNull();
      expect(point.pace).toBeNull();
    }
  });

  it("falls back to fixed_altitude when altitude is absent, and speed when velocity_smooth is absent", () => {
    const rawStreams: IntervalsStream[] = [
      makeRawStream("time", [0, 1]),
      makeRawStream("fixed_altitude", [16, 16]),
      makeRawStream("speed", [3.0, 3.1]),
    ];

    const { points } = buildStreamPoints(rawStreams);

    expect(points[0].altitude).toBe(16);
    expect(points[0].pace).not.toBeNull();
  });

  it("returns an empty result for an empty stream array", () => {
    const { points, availableStreams } = buildStreamPoints([]);
    expect(points).toEqual([]);
    expect(availableStreams).toEqual([]);
  });

  it("derives the point count from the longest available stream, even without a time stream", () => {
    const rawStreams: IntervalsStream[] = [makeRawStream("heartrate", [140, 141, 142, 143])];

    const { points } = buildStreamPoints(rawStreams);

    expect(points).toHaveLength(4);
    expect(points[0].elapsedSeconds).toBeNull();
    expect(points[2].heartRate).toBe(142);
  });

  it("guards against non-finite values inside a stream's data array", () => {
    const rawStreams: IntervalsStream[] = [
      makeRawStream("time", [0, 1]),
      makeRawStream("heartrate", [140, Number.NaN]),
    ];

    const { points } = buildStreamPoints(rawStreams);
    expect(points[1].heartRate).toBeNull();
  });
});
