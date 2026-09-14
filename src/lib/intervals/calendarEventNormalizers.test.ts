import { describe, expect, it } from "vitest";

import { normalizeCalendarEvent } from "./calendarEventNormalizers";
import type { IntervalsEvent } from "@/types/calendarEvent";

function rawEvent(overrides: Partial<IntervalsEvent> = {}): IntervalsEvent {
  return {
    id: 133599091,
    start_date_local: "2026-09-05T00:00:00",
    end_date_local: "2026-09-06T00:00:00",
    name: "6 × 1 min intervals",
    type: "Run",
    category: "WORKOUT",
    description: "2km lugnt. 6x1min tryck / 1min jogg / 15+10 lugnt",
    moving_time: 2400,
    distance: 0,
    show_as_note: false,
    paired_activity_id: "i183474786",
    workout_doc: {
      steps: [],
      description: "2km lugnt. 6x1min tryck / 1min jogg / 15+10 lugnt",
      distance: 0,
      duration: 0,
    },
    ...overrides,
  };
}

describe("normalizeCalendarEvent", () => {
  it("normalizes the real confirmed event shape (planned running workout, already completed/linked)", () => {
    const event = normalizeCalendarEvent(rawEvent());

    expect(event).toMatchObject({
      id: "133599091",
      date: "2026-09-05T00:00:00",
      name: "6 × 1 min intervals",
      category: "WORKOUT",
      sportType: "Run",
      eventType: "planned_running_workout",
      isPlannedWorkout: true,
      isCompleted: true,
      completedActivityId: "i183474786",
      plannedDurationSeconds: 2400,
      plannedDistanceMeters: 0,
      description: "2km lugnt. 6x1min tryck / 1min jogg / 15+10 lugnt",
    });
  });

  it("marks a free-text-only plan as structureAvailable: false with stepCount 0 and the plan description surfaced", () => {
    const event = normalizeCalendarEvent(rawEvent());

    expect(event.workout).toEqual({
      structureAvailable: false,
      stepCount: 0,
      description: "2km lugnt. 6x1min tryck / 1min jogg / 15+10 lugnt",
    });
  });

  it("classifies a running-type WORKOUT event as planned_running_workout", () => {
    const event = normalizeCalendarEvent(rawEvent({ type: "Run" }));
    expect(event.eventType).toBe("planned_running_workout");

    const trailEvent = normalizeCalendarEvent(rawEvent({ type: "TrailRun" }));
    expect(trailEvent.eventType).toBe("planned_running_workout");
  });

  it("classifies a non-running-sport WORKOUT event as planned_workout_other_sport", () => {
    const event = normalizeCalendarEvent(rawEvent({ type: "Ride" }));

    expect(event.eventType).toBe("planned_workout_other_sport");
    expect(event.isPlannedWorkout).toBe(true);
  });

  it("classifies show_as_note events as notes, not planned workouts, even if category is WORKOUT", () => {
    const event = normalizeCalendarEvent(rawEvent({ show_as_note: true }));

    expect(event.eventType).toBe("note");
    expect(event.isPlannedWorkout).toBe(false);
  });

  it("falls back to a neutral 'other' eventType for an unknown/unconfirmed category, without inventing meaning", () => {
    const event = normalizeCalendarEvent(rawEvent({ category: "RACE_A", type: "Run" }));

    expect(event.eventType).toBe("other");
    expect(event.isPlannedWorkout).toBe(false);
    // The raw category is still passed through verbatim for the client to see.
    expect(event.category).toBe("RACE_A");
  });

  it("handles a null category safely", () => {
    const event = normalizeCalendarEvent(rawEvent({ category: null }));

    expect(event.eventType).toBe("other");
    expect(event.category).toBeNull();
  });

  it("treats a missing/null paired_activity_id as not completed", () => {
    const event = normalizeCalendarEvent(rawEvent({ paired_activity_id: null }));

    expect(event.isCompleted).toBe(false);
    expect(event.completedActivityId).toBeNull();
  });

  it("does not infer completion from date alone (a past event with no linked activity is still not completed)", () => {
    const event = normalizeCalendarEvent(
      rawEvent({ start_date_local: "2020-01-01T00:00:00", paired_activity_id: null })
    );

    expect(event.isCompleted).toBe(false);
  });

  it("handles a null/missing planned duration", () => {
    const event = normalizeCalendarEvent(rawEvent({ moving_time: null }));

    expect(event.plannedDurationSeconds).toBeNull();
  });

  it("handles a null/missing planned distance", () => {
    const event = normalizeCalendarEvent(rawEvent({ distance: null }));

    expect(event.plannedDistanceMeters).toBeNull();
  });

  it("guards against malformed (NaN/Infinity) numeric fields", () => {
    const event = normalizeCalendarEvent(rawEvent({ moving_time: Number.NaN, distance: Number.POSITIVE_INFINITY }));

    expect(event.plannedDurationSeconds).toBeNull();
    expect(event.plannedDistanceMeters).toBeNull();
  });

  it("returns workout: null when the raw event has no workout_doc at all", () => {
    const event = normalizeCalendarEvent(rawEvent({ workout_doc: null }));

    expect(event.workout).toBeNull();
  });

  it("falls back to end_date_local when start_date_local is missing", () => {
    const event = normalizeCalendarEvent(rawEvent({ start_date_local: null, end_date_local: "2026-09-06T00:00:00" }));

    expect(event.date).toBe("2026-09-06T00:00:00");
  });

  it("reports structureAvailable: true and the correct stepCount for a non-empty steps array, without interpreting step contents", () => {
    const event = normalizeCalendarEvent(
      rawEvent({
        workout_doc: {
          steps: [
            { text: "Warm-up", duration: 900 },
            { text: "6 x", reps: 6, steps: [{ text: "90 sec hard" }, { text: "90 sec easy jog" }] },
            { text: "Cool-down", duration: 600 },
          ],
          description: "Structured plan",
          distance: 0,
          duration: 3060,
        },
      })
    );

    // Deliberately conservative: only existence + count are reported.
    // Individual step contents (text/duration/reps/nested steps) are
    // intentionally NOT parsed — see this module's `normalizeWorkoutDoc`
    // doc comment. This is exactly what the shape looks like even for a
    // populated `steps` array; no per-step fields ever leak through.
    expect(event.workout).toEqual({
      structureAvailable: true,
      stepCount: 3,
      description: "Structured plan",
    });
  });

  it("does not crash on a malformed/non-array steps value, treating it as empty", () => {
    const event = normalizeCalendarEvent(
      rawEvent({
        description: null,
        workout_doc: {
          // @ts-expect-error -- deliberately malformed input to prove defensive handling
          steps: "not-an-array",
          description: null,
          distance: 0,
          duration: 0,
        },
      })
    );

    expect(event.workout).toEqual({ structureAvailable: false, stepCount: 0, description: null });
  });

  it("falls back to the event's own description when workout_doc.description is missing", () => {
    const event = normalizeCalendarEvent(
      rawEvent({
        description: "Event-level description",
        workout_doc: { steps: [], description: null, distance: 0, duration: 0 },
      })
    );

    expect(event.description).toBe("Event-level description");
    expect(event.workout?.description).toBe("Event-level description");
  });

  it("prefers workout_doc.description over the event-level description when both are present", () => {
    const event = normalizeCalendarEvent(
      rawEvent({
        description: "Event-level description",
        workout_doc: { steps: [], description: "Plan-level description", distance: 0, duration: 0 },
      })
    );

    expect(event.workout?.description).toBe("Plan-level description");
  });
});
