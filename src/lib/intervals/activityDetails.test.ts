import { beforeEach, describe, expect, it, vi } from "vitest";

// `intervalsGet` is the single seam between this domain layer and the
// network; mocking it lets these tests run without any real Intervals.icu
// credentials or network access.
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

const { getRunDetails } = await import("./activityDetails");
const { IntervalsApiError } = await import("@/lib/intervals/client");

function rawActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: "i186254951",
    name: "Helsingborg Löpning",
    type: "Run",
    start_date_local: "2026-09-13T13:33:49",
    start_date: "2026-09-13T11:33:49Z",
    distance: 9007.98,
    moving_time: 3317,
    elapsed_time: 3318,
    total_elevation_gain: 38.24,
    average_speed: 2.714,
    average_heartrate: 150,
    max_heartrate: 159,
    average_cadence: 74.5,
    icu_training_load: 54,
    icu_intensity: 76.56,
    icu_ctl: 4.77,
    icu_atl: 16.45,
    icu_rpe: null,
    perceived_exertion: null,
    feel: null,
    source: "GARMIN_CONNECT",
    decoupling: null,
    icu_average_watts: null,
    stream_types: ["time", "heartrate", "distance", "watts", "cadence", "altitude"],
    ...overrides,
  };
}

function rawInterval(overrides: Record<string, unknown> = {}) {
  return {
    id: 4857895,
    type: "WORK",
    label: null,
    start_index: 0,
    end_index: 330,
    start_time: 0,
    end_time: 330,
    distance: 1000.96,
    moving_time: 330,
    elapsed_time: 330,
    average_heartrate: 141,
    max_heartrate: 158,
    average_cadence: 75.34,
    average_speed: 3.03,
    average_watts: null,
    total_elevation_gain: 4.2,
    gap: 3.04,
    decoupling: null,
    ...overrides,
  };
}

beforeEach(() => {
  intervalsGetMock.mockReset();
});

describe("getRunDetails", () => {
  it("fetches, normalizes, and includes intervals for a running activity", async () => {
    intervalsGetMock
      .mockResolvedValueOnce(rawActivity())
      .mockResolvedValueOnce({ id: "i186254951", icu_intervals: [rawInterval()], icu_groups: [] });

    const result = await getRunDetails("i186254951");

    expect(result.id).toBe("i186254951");
    expect(result.type).toBe("Run");
    expect(result.distanceKm).toBeCloseTo(9.008, 2);
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0].pace).not.toBeNull();

    expect(intervalsGetMock).toHaveBeenNthCalledWith(1, "/activity/i186254951");
    expect(intervalsGetMock).toHaveBeenNthCalledWith(2, "/activity/i186254951/intervals");
  });

  it("rejects non-running activity types cleanly", async () => {
    intervalsGetMock.mockResolvedValueOnce(rawActivity({ type: "Ride" }));

    await expect(getRunDetails("i999")).rejects.toThrow("Activity is not a running activity.");
    // Should not bother fetching intervals for a rejected activity.
    expect(intervalsGetMock).toHaveBeenCalledTimes(1);
  });

  it("throws a clean 'not found' error for a 404 from Intervals.icu", async () => {
    intervalsGetMock.mockRejectedValueOnce(new IntervalsApiError("Intervals.icu request failed with status 404.", 404));

    await expect(getRunDetails("i-does-not-exist")).rejects.toThrow("Running activity not found.");
  });

  it("propagates non-404 Intervals.icu errors (e.g. auth failures) unchanged", async () => {
    intervalsGetMock.mockRejectedValueOnce(new IntervalsApiError("Intervals.icu authentication failed.", 401));

    await expect(getRunDetails("i186254951")).rejects.toThrow("Intervals.icu authentication failed.");
  });

  it("treats a 404 on the intervals sub-resource as 'no intervals' rather than failing the whole request", async () => {
    intervalsGetMock
      .mockResolvedValueOnce(rawActivity())
      .mockRejectedValueOnce(new IntervalsApiError("Intervals.icu request failed with status 404.", 404));

    const result = await getRunDetails("i186254951");
    expect(result.intervals).toEqual([]);
  });

  it("handles an intervals response with a missing/malformed icu_intervals field", async () => {
    intervalsGetMock.mockResolvedValueOnce(rawActivity()).mockResolvedValueOnce({});

    const result = await getRunDetails("i186254951");
    expect(result.intervals).toEqual([]);
  });

  it("rejects an empty activityId", async () => {
    await expect(getRunDetails("")).rejects.toThrow();
    expect(intervalsGetMock).not.toHaveBeenCalled();
  });
});
