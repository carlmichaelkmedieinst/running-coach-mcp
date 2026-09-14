import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IntervalsEvent } from "@/types/calendarEvent";

const intervalsGetMock = vi.fn();
const intervalsPostMock = vi.fn();
const intervalsPutMock = vi.fn();
const intervalsDeleteMock = vi.fn();

vi.mock("@/lib/intervals/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/intervals/client")>("@/lib/intervals/client");
  return {
    ...actual,
    intervalsGet: (...args: unknown[]) => intervalsGetMock(...args),
    intervalsPost: (...args: unknown[]) => intervalsPostMock(...args),
    intervalsPut: (...args: unknown[]) => intervalsPutMock(...args),
    intervalsDelete: (...args: unknown[]) => intervalsDeleteMock(...args),
  };
});

const { createRunningWorkout, deleteRunningWorkout, describeWorkoutError, updateRunningWorkout } = await import(
  "./workouts"
);
const { IntervalsApiError } = await import("@/lib/intervals/client");

function rawEvent(overrides: Partial<IntervalsEvent> = {}): IntervalsEvent {
  return {
    id: 133599091,
    start_date_local: "2026-09-16T00:00:00",
    end_date_local: "2026-09-17T00:00:00",
    name: "6 x 90s intervals",
    type: "Run",
    category: "WORKOUT",
    description: "6x\n- 90s intensity=active\n- 90s intensity=rest",
    moving_time: null,
    distance: null,
    show_as_note: false,
    paired_activity_id: null,
    workout_doc: null,
    ...overrides,
  };
}

/**
 * Queues the two sequential `intervalsGet` calls `updateRunningWorkout`/
 * `deleteRunningWorkout` are expected to make when their safety checks
 * proceed past the category/sport check: first the single-event GET,
 * then the same-date list GET used for the RELIABLE pairing check.
 */
function mockGetSequence(single: IntervalsEvent, list: IntervalsEvent[]) {
  intervalsGetMock.mockResolvedValueOnce(single);
  intervalsGetMock.mockResolvedValueOnce(list);
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-09-16",
    name: "6 x 90s intervals",
    warmupSeconds: 720,
    repetitions: 6,
    workSeconds: 90,
    recoverySeconds: 90,
    paceTarget: { minSecondsPerKm: 275, maxSecondsPerKm: 285 },
    cooldownSeconds: 720,
    ...overrides,
  };
}

beforeEach(() => {
  intervalsGetMock.mockReset();
  intervalsPostMock.mockReset();
  intervalsPutMock.mockReset();
  intervalsDeleteMock.mockReset();
});

describe("createRunningWorkout", () => {
  it("POSTs to the correct endpoint", async () => {
    intervalsPostMock.mockResolvedValueOnce(rawEvent());

    await createRunningWorkout(validInput());

    expect(intervalsPostMock).toHaveBeenCalledWith(
      "/athlete/0/events",
      expect.any(Object)
    );
  });

  it("sends exactly category/type/start_date_local/name/description — never workout_doc or computed fields", async () => {
    intervalsPostMock.mockResolvedValueOnce(rawEvent());

    await createRunningWorkout(validInput());

    const [, payload] = intervalsPostMock.mock.calls[0];
    expect(payload).toEqual({
      category: "WORKOUT",
      type: "Run",
      start_date_local: "2026-09-16T00:00:00",
      name: "6 x 90s intervals",
      description: expect.stringContaining("intensity=active"),
    });
    expect(payload).not.toHaveProperty("workout_doc");
    expect(payload).not.toHaveProperty("distance");
    expect(payload).not.toHaveProperty("moving_time");
    expect(payload).not.toHaveProperty("icu_training_load");
  });

  it("never sends workout_doc even when checked exhaustively against the raw payload keys", async () => {
    intervalsPostMock.mockResolvedValueOnce(rawEvent());

    await createRunningWorkout(validInput());

    const [, payload] = intervalsPostMock.mock.calls[0];
    expect(Object.keys(payload as object).sort()).toEqual(
      ["category", "description", "name", "start_date_local", "type"].sort()
    );
  });

  it("returns a normalized CalendarEvent built from the API response", async () => {
    intervalsPostMock.mockResolvedValueOnce(rawEvent());

    const result = await createRunningWorkout(validInput());

    expect(result.id).toBe("133599091");
    expect(result.category).toBe("WORKOUT");
    expect(result.sportType).toBe("Run");
    expect(result.isPlannedWorkout).toBe(true);
    expect(result.isCompleted).toBe(false);
  });

  it("propagates an Intervals.icu API failure unchanged", async () => {
    intervalsPostMock.mockRejectedValueOnce(new IntervalsApiError("Intervals.icu authentication failed.", 401));

    await expect(createRunningWorkout(validInput())).rejects.toThrow("Intervals.icu authentication failed.");
  });

  it("rejects invalid input before making any network request", async () => {
    await expect(createRunningWorkout(validInput({ repetitions: 0 }))).rejects.toThrow();
    expect(intervalsPostMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed API response (not even an object)", async () => {
    intervalsPostMock.mockResolvedValueOnce("not an event");

    await expect(createRunningWorkout(validInput())).rejects.toThrow(/malformed/i);
  });

  it("rejects when the created event's category/sport/date/name don't match what was requested", async () => {
    intervalsPostMock.mockResolvedValueOnce(rawEvent({ category: "NOTE" }));
    await expect(createRunningWorkout(validInput())).rejects.toThrow(/category/i);

    intervalsPostMock.mockResolvedValueOnce(rawEvent({ type: "Ride" }));
    await expect(createRunningWorkout(validInput())).rejects.toThrow(/sport/i);

    intervalsPostMock.mockResolvedValueOnce(rawEvent({ start_date_local: "2026-09-17T00:00:00" }));
    await expect(createRunningWorkout(validInput())).rejects.toThrow(/date/i);

    intervalsPostMock.mockResolvedValueOnce(rawEvent({ name: "Something else" }));
    await expect(createRunningWorkout(validInput())).rejects.toThrow(/name/i);
  });
});

describe("updateRunningWorkout", () => {
  it("performs the single-event GET, then the same-date list GET, before the PUT (fetch-before-update safety)", async () => {
    mockGetSequence(rawEvent(), [rawEvent()]);
    intervalsPutMock.mockResolvedValueOnce(rawEvent());

    await updateRunningWorkout({ eventId: "133599091", ...validInput() });

    expect(intervalsGetMock).toHaveBeenNthCalledWith(1, "/athlete/0/events/133599091");
    expect(intervalsGetMock).toHaveBeenNthCalledWith(2, "/athlete/0/events", {
      oldest: "2026-09-16",
      newest: "2026-09-16",
    });
    expect(intervalsGetMock.mock.invocationCallOrder[1]).toBeLessThan(
      intervalsPutMock.mock.invocationCallOrder[0]
    );
  });

  it("rejects a missing event with a clean not-found error, without ever calling the list endpoint or PUT", async () => {
    intervalsGetMock.mockRejectedValueOnce(new IntervalsApiError("Intervals.icu request failed with status 404.", 404));

    await expect(updateRunningWorkout({ eventId: "999", ...validInput() })).rejects.toThrow("Workout event not found.");
    expect(intervalsGetMock).toHaveBeenCalledTimes(1);
    expect(intervalsPutMock).not.toHaveBeenCalled();
  });

  it("rejects a non-WORKOUT event without ever calling the list endpoint or PUT", async () => {
    intervalsGetMock.mockResolvedValueOnce(rawEvent({ category: "NOTE" }));

    await expect(updateRunningWorkout({ eventId: "133599091", ...validInput() })).rejects.toThrow(/WORKOUT/);
    expect(intervalsGetMock).toHaveBeenCalledTimes(1);
    expect(intervalsPutMock).not.toHaveBeenCalled();
  });

  it("rejects a non-Run sport without ever calling the list endpoint or PUT", async () => {
    intervalsGetMock.mockResolvedValueOnce(rawEvent({ type: "Ride" }));

    await expect(updateRunningWorkout({ eventId: "133599091", ...validInput() })).rejects.toThrow(/running/i);
    expect(intervalsGetMock).toHaveBeenCalledTimes(1);
    expect(intervalsPutMock).not.toHaveBeenCalled();
  });

  it("rejects an already-completed/paired event — using the LIST endpoint's paired_activity_id, not the single-event GET's", async () => {
    // The single-event GET (realistically) omits paired_activity_id; only the list endpoint reports it.
    mockGetSequence(rawEvent({ paired_activity_id: null }), [rawEvent({ paired_activity_id: "i183474786" })]);

    await expect(updateRunningWorkout({ eventId: "133599091", ...validInput() })).rejects.toThrow(/completed/i);
    expect(intervalsPutMock).not.toHaveBeenCalled();
  });

  it("fails closed and rejects when the matching event cannot be found in the list response", async () => {
    // List response for that date exists but doesn't contain a matching id — e.g. endpoints disagreeing, or a race.
    mockGetSequence(rawEvent(), [rawEvent({ id: 999999999 })]);

    await expect(updateRunningWorkout({ eventId: "133599091", ...validInput() })).rejects.toThrow(
      /could not be re-verified/i
    );
    expect(intervalsPutMock).not.toHaveBeenCalled();
  });

  it("fails closed and rejects when the list response for that date is empty", async () => {
    mockGetSequence(rawEvent(), []);

    await expect(updateRunningWorkout({ eventId: "133599091", ...validInput() })).rejects.toThrow(
      /could not be re-verified/i
    );
    expect(intervalsPutMock).not.toHaveBeenCalled();
  });

  it("PUTs to the correct endpoint once the unpaired workout is verified via the list endpoint", async () => {
    mockGetSequence(rawEvent(), [rawEvent()]);
    intervalsPutMock.mockResolvedValueOnce(rawEvent());

    await updateRunningWorkout({ eventId: "133599091", ...validInput() });

    expect(intervalsPutMock).toHaveBeenCalledWith("/athlete/0/events/133599091", expect.any(Object));
  });

  it("sends a fresh, complete payload — never echoing stale calculated fields from the GET", async () => {
    mockGetSequence(
      rawEvent({
        moving_time: 2400,
        distance: 8000,
        workout_doc: { steps: [1, 2], description: "old", distance: 8000, duration: 2400 },
      }),
      [rawEvent()]
    );
    intervalsPutMock.mockResolvedValueOnce(rawEvent({ name: "Updated name" }));

    await updateRunningWorkout({ eventId: "133599091", ...validInput({ name: "Updated name" }) });

    const [, payload] = intervalsPutMock.mock.calls[0];
    expect(payload).toEqual({
      category: "WORKOUT",
      type: "Run",
      start_date_local: "2026-09-16T00:00:00",
      name: "Updated name",
      description: expect.any(String),
    });
    expect(payload).not.toHaveProperty("workout_doc");
    expect(payload).not.toHaveProperty("moving_time");
    expect(payload).not.toHaveProperty("distance");
  });

  it("returns the normalized updated event for an unpaired valid running workout (update still works normally)", async () => {
    mockGetSequence(rawEvent(), [rawEvent()]);
    intervalsPutMock.mockResolvedValueOnce(rawEvent({ name: "Updated name" }));

    const result = await updateRunningWorkout({ eventId: "133599091", ...validInput({ name: "Updated name" }) });

    expect(result.name).toBe("Updated name");
  });

  it("rejects invalid input before fetching the existing event", async () => {
    await expect(updateRunningWorkout({ eventId: "133599091", ...validInput({ repetitions: 0 }) })).rejects.toThrow();
    expect(intervalsGetMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed eventId", async () => {
    await expect(updateRunningWorkout({ eventId: "not-a-number", ...validInput() })).rejects.toThrow();
    expect(intervalsGetMock).not.toHaveBeenCalled();
  });
});

describe("deleteRunningWorkout", () => {
  it("performs the single-event GET, then the same-date list GET, before the DELETE (fetch-before-delete safety)", async () => {
    mockGetSequence(rawEvent(), [rawEvent()]);
    intervalsDeleteMock.mockResolvedValueOnce(undefined);

    await deleteRunningWorkout({ eventId: "133599091" });

    expect(intervalsGetMock).toHaveBeenNthCalledWith(1, "/athlete/0/events/133599091");
    expect(intervalsGetMock).toHaveBeenNthCalledWith(2, "/athlete/0/events", {
      oldest: "2026-09-16",
      newest: "2026-09-16",
    });
    expect(intervalsGetMock.mock.invocationCallOrder[1]).toBeLessThan(
      intervalsDeleteMock.mock.invocationCallOrder[0]
    );
  });

  it("rejects a non-workout event without ever calling the list endpoint or DELETE", async () => {
    intervalsGetMock.mockResolvedValueOnce(rawEvent({ category: "NOTE" }));

    await expect(deleteRunningWorkout({ eventId: "133599091" })).rejects.toThrow(/WORKOUT/);
    expect(intervalsGetMock).toHaveBeenCalledTimes(1);
    expect(intervalsDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects a non-run event without ever calling the list endpoint or DELETE", async () => {
    intervalsGetMock.mockResolvedValueOnce(rawEvent({ type: "Ride" }));

    await expect(deleteRunningWorkout({ eventId: "133599091" })).rejects.toThrow(/running/i);
    expect(intervalsGetMock).toHaveBeenCalledTimes(1);
    expect(intervalsDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects an already-completed/paired event — using the LIST endpoint's paired_activity_id, not the single-event GET's", async () => {
    // The single-event GET (realistically) omits paired_activity_id; only the list endpoint reports it.
    mockGetSequence(rawEvent({ paired_activity_id: null }), [rawEvent({ paired_activity_id: "i183474786" })]);

    await expect(deleteRunningWorkout({ eventId: "133599091" })).rejects.toThrow(/completed/i);
    expect(intervalsDeleteMock).not.toHaveBeenCalled();
  });

  it("fails closed and rejects when the matching event cannot be found in the list response", async () => {
    mockGetSequence(rawEvent(), [rawEvent({ id: 999999999 })]);

    await expect(deleteRunningWorkout({ eventId: "133599091" })).rejects.toThrow(/could not be re-verified/i);
    expect(intervalsDeleteMock).not.toHaveBeenCalled();
  });

  it("fails closed and rejects when the list response for that date is empty", async () => {
    mockGetSequence(rawEvent(), []);

    await expect(deleteRunningWorkout({ eventId: "133599091" })).rejects.toThrow(/could not be re-verified/i);
    expect(intervalsDeleteMock).not.toHaveBeenCalled();
  });

  it("DELETEs the correct endpoint once the unpaired workout is verified via the list endpoint", async () => {
    mockGetSequence(rawEvent(), [rawEvent()]);
    intervalsDeleteMock.mockResolvedValueOnce(undefined);

    await deleteRunningWorkout({ eventId: "133599091" });

    expect(intervalsDeleteMock).toHaveBeenCalledWith("/athlete/0/events/133599091");
  });

  it("handles a 204/void response from intervalsDelete correctly for an unpaired valid running workout (delete still works normally)", async () => {
    mockGetSequence(rawEvent(), [rawEvent()]);
    intervalsDeleteMock.mockResolvedValueOnce(undefined);

    const result = await deleteRunningWorkout({ eventId: "133599091" });

    expect(result).toEqual({
      deleted: true,
      eventId: "133599091",
      name: "6 x 90s intervals",
      date: "2026-09-16",
    });
  });

  it("rejects a missing event with a clean not-found error, without ever calling the list endpoint or DELETE", async () => {
    intervalsGetMock.mockRejectedValueOnce(new IntervalsApiError("Intervals.icu request failed with status 404.", 404));

    await expect(deleteRunningWorkout({ eventId: "999" })).rejects.toThrow("Workout event not found.");
    expect(intervalsGetMock).toHaveBeenCalledTimes(1);
    expect(intervalsDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed eventId before any network request", async () => {
    await expect(deleteRunningWorkout({ eventId: "abc" })).rejects.toThrow();
    expect(intervalsGetMock).not.toHaveBeenCalled();
  });
});

describe("describeWorkoutError", () => {
  it("formats a ZodError into a readable single-line message", async () => {
    try {
      await createRunningWorkout(validInput({ repetitions: 0 }));
      throw new Error("expected createRunningWorkout to throw");
    } catch (error) {
      const message = describeWorkoutError(error);
      expect(message).toContain("repetitions");
      expect(message).not.toContain("[");
    }
  });

  it("passes through a plain Error message", () => {
    expect(describeWorkoutError(new Error("Workout event not found."))).toBe("Workout event not found.");
  });

  it("never throws for a non-Error value", () => {
    expect(describeWorkoutError("some string")).toBe("Intervals.icu request failed unexpectedly.");
  });
});
