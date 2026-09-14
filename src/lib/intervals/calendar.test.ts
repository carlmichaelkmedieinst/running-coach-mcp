import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IntervalsEvent } from "@/types/calendarEvent";

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

const { getCalendar, getCalendarParamsSchema } = await import("./calendar");
const { IntervalsApiError } = await import("@/lib/intervals/client");

// 2026-09-14T10:00:00Z = 2026-09-14T12:00 in the default athlete timezone
// (Europe/Stockholm, UTC+2 in September) — pinned to an explicit UTC
// instant so this test doesn't depend on the test-running machine's own
// local timezone. 2026-09-14 is a Monday.
const NOW = new Date("2026-09-14T10:00:00Z");

function rawEvent(overrides: Partial<IntervalsEvent> = {}): IntervalsEvent {
  return {
    id: 1,
    start_date_local: "2026-09-14T00:00:00",
    end_date_local: "2026-09-15T00:00:00",
    name: "Easy run",
    type: "Run",
    category: "WORKOUT",
    description: "Easy 5k",
    moving_time: 1800,
    distance: 5000,
    show_as_note: false,
    paired_activity_id: null,
    workout_doc: { steps: [], description: "Easy 5k", distance: 5000, duration: 1800 },
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.ATHLETE_TIME_ZONE;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  intervalsGetMock.mockReset();
  intervalsGetMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCalendarParamsSchema", () => {
  it("defaults daysBefore to 7 and daysAfter to 21", () => {
    const parsed = getCalendarParamsSchema.parse({});
    expect(parsed.daysBefore).toBe(7);
    expect(parsed.daysAfter).toBe(21);
  });

  it("rejects daysBefore below 0 or above 90", () => {
    expect(() => getCalendarParamsSchema.parse({ daysBefore: -1 })).toThrow();
    expect(() => getCalendarParamsSchema.parse({ daysBefore: 91 })).toThrow();
  });

  it("accepts daysBefore at the boundaries", () => {
    expect(getCalendarParamsSchema.parse({ daysBefore: 0 }).daysBefore).toBe(0);
    expect(getCalendarParamsSchema.parse({ daysBefore: 90 }).daysBefore).toBe(90);
  });

  it("rejects daysAfter below 1 or above 180", () => {
    expect(() => getCalendarParamsSchema.parse({ daysAfter: 0 })).toThrow();
    expect(() => getCalendarParamsSchema.parse({ daysAfter: 181 })).toThrow();
  });

  it("accepts daysAfter at the boundaries", () => {
    expect(getCalendarParamsSchema.parse({ daysAfter: 1 }).daysAfter).toBe(1);
    expect(getCalendarParamsSchema.parse({ daysAfter: 180 }).daysAfter).toBe(180);
  });

  it("rejects non-integer values", () => {
    expect(() => getCalendarParamsSchema.parse({ daysBefore: 7.5 })).toThrow();
    expect(() => getCalendarParamsSchema.parse({ daysAfter: 21.5 })).toThrow();
  });
});

describe("getCalendar", () => {
  it("computes the athlete-local date window and queries Intervals.icu with it", async () => {
    const result = await getCalendar({ daysBefore: 7, daysAfter: 21 });

    expect(result.startDate).toBe("2026-09-07");
    expect(result.endDate).toBe("2026-10-05");
    expect(intervalsGetMock).toHaveBeenCalledWith(
      expect.stringContaining("/events"),
      expect.objectContaining({ oldest: "2026-09-07", newest: "2026-10-05" })
    );
  });

  it("uses the configured ATHLETE_TIME_ZONE rather than a hardcoded zone", async () => {
    // 2026-09-14T10:00:00Z is 2026-09-14 in Europe/Stockholm (UTC+2) but
    // still 2026-09-14 in UTC too during daytime — pick a boundary instant
    // instead to actually prove the zone is read: 2026-09-14T22:30:00Z is
    // 2026-09-15 in Stockholm but 2026-09-14 in UTC.
    vi.setSystemTime(new Date("2026-09-14T22:30:00Z"));

    process.env.ATHLETE_TIME_ZONE = "UTC";
    const utcResult = await getCalendar({ daysBefore: 0, daysAfter: 1 });
    expect(utcResult.startDate).toBe("2026-09-14");

    process.env.ATHLETE_TIME_ZONE = "Europe/Stockholm";
    const stockholmResult = await getCalendar({ daysBefore: 0, daysAfter: 1 });
    expect(stockholmResult.startDate).toBe("2026-09-15");
  });

  it("returns a well-formed, empty result for an empty calendar", async () => {
    const result = await getCalendar({});

    expect(result.eventsReturned).toBe(0);
    expect(result.plannedWorkoutCount).toBe(0);
    expect(result.nextPlannedWorkout).toBeNull();
    expect(result.events).toEqual([]);
  });

  it("sorts events oldest to newest", async () => {
    intervalsGetMock.mockResolvedValue([
      rawEvent({ id: 1, start_date_local: "2026-09-20T00:00:00" }),
      rawEvent({ id: 2, start_date_local: "2026-09-14T00:00:00" }),
      rawEvent({ id: 3, start_date_local: "2026-09-17T00:00:00" }),
    ]);

    const result = await getCalendar({});

    expect(result.events.map((e) => e.id)).toEqual(["2", "3", "1"]);
  });

  it("counts planned workouts across sports but selects nextPlannedWorkout from running only", async () => {
    intervalsGetMock.mockResolvedValue([
      rawEvent({ id: 1, type: "Ride", start_date_local: "2026-09-15T00:00:00" }),
      rawEvent({ id: 2, type: "Run", start_date_local: "2026-09-18T00:00:00" }),
    ]);

    const result = await getCalendar({});

    expect(result.plannedWorkoutCount).toBe(2);
    expect(result.nextPlannedWorkout?.id).toBe("2");
  });

  it("returns null nextPlannedWorkout when no planned running workout exists, even if other planned workouts do", async () => {
    intervalsGetMock.mockResolvedValue([
      rawEvent({ id: 1, type: "Ride", start_date_local: "2026-09-15T00:00:00" }),
    ]);

    const result = await getCalendar({});

    expect(result.nextPlannedWorkout).toBeNull();
  });

  it("selects the earliest qualifying planned running workout when several exist", async () => {
    intervalsGetMock.mockResolvedValue([
      rawEvent({ id: 1, start_date_local: "2026-09-25T00:00:00" }),
      rawEvent({ id: 2, start_date_local: "2026-09-16T00:00:00" }),
      rawEvent({ id: 3, start_date_local: "2026-09-20T00:00:00" }),
    ]);

    const result = await getCalendar({});

    expect(result.nextPlannedWorkout?.id).toBe("2");
  });

  it("can select a planned workout scheduled for today", async () => {
    intervalsGetMock.mockResolvedValue([rawEvent({ id: 1, start_date_local: "2026-09-14T00:00:00" })]);

    const result = await getCalendar({});

    expect(result.nextPlannedWorkout?.id).toBe("1");
  });

  it("never selects a past planned workout as nextPlannedWorkout", async () => {
    intervalsGetMock.mockResolvedValue([rawEvent({ id: 1, start_date_local: "2026-09-10T00:00:00" })]);

    const result = await getCalendar({});

    expect(result.nextPlannedWorkout).toBeNull();
  });

  it("excludes an already-completed (paired) planned workout from nextPlannedWorkout, even if scheduled today/future", async () => {
    intervalsGetMock.mockResolvedValue([
      rawEvent({ id: 1, start_date_local: "2026-09-20T00:00:00", paired_activity_id: "i999" }),
    ]);

    const result = await getCalendar({});

    expect(result.nextPlannedWorkout).toBeNull();
  });

  it("propagates Intervals.icu errors unchanged", async () => {
    intervalsGetMock.mockRejectedValueOnce(new IntervalsApiError("Intervals.icu authentication failed.", 401));

    await expect(getCalendar({})).rejects.toThrow("Intervals.icu authentication failed.");
  });

  it("rejects invalid params before making a network request", async () => {
    await expect(getCalendar({ daysBefore: -1 })).rejects.toThrow();
    await expect(getCalendar({ daysAfter: 0 })).rejects.toThrow();
    expect(intervalsGetMock).not.toHaveBeenCalled();
  });
});
