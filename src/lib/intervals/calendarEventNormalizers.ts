/**
 * Pure conversion from Intervals.icu's raw calendar event shape to our own
 * normalized `CalendarEvent` domain model.
 *
 * Mirrors `normalizers.ts`'s role for activities: no other module should
 * reach into `IntervalsEvent`/`IntervalsWorkoutDoc` fields directly —
 * everything downstream should depend on `CalendarEvent` instead.
 *
 * CLASSIFICATION PHILOSOPHY (see `src/types/calendarEvent.ts`'s module doc
 * comment for the live-discovery context): this account only ever showed
 * one real event (`category: "WORKOUT"`, a running type, already
 * completed/linked). `classifyEventType` below is deliberately
 * conservative — it only derives `"planned_running_workout"` /
 * `"planned_workout_other_sport"` / `"note"` from raw signals that were
 * actually confirmed present (`category === "WORKOUT"`, the sport `type`,
 * and the real `show_as_note` boolean); anything else falls back to
 * `"other"` rather than guessing what an unconfirmed `category` value
 * (e.g. a hypothetical `"RACE_A"` or `"NOTE"`) means. The raw `category`
 * string is always passed through unmodified on `CalendarEvent.category`
 * regardless, so a client can still see it even when our own `eventType`
 * doesn't have a confident opinion about it.
 */

import { isRunningActivityType, numericOrNull } from "@/lib/intervals/normalizers";
import type {
  CalendarEvent,
  CalendarEventType,
  CalendarEventWorkout,
  IntervalsEvent,
  IntervalsWorkoutDoc,
} from "@/types/calendarEvent";

/** See this module's doc comment for exactly which raw signals back each bucket. */
function classifyEventType(raw: IntervalsEvent): CalendarEventType {
  if (raw.show_as_note === true) {
    return "note";
  }

  if (raw.category === "WORKOUT") {
    return isRunningActivityType(raw.type) ? "planned_running_workout" : "planned_workout_other_sport";
  }

  return "other";
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Normalizes a raw `workout_doc` into our conservative `CalendarEventWorkout`
 * shape.
 *
 * Deliberately does NOT interpret individual step contents: no real
 * Intervals.icu event available to this account has ever had a non-empty
 * `steps` array, so there is no live-confirmed schema for a populated
 * step to normalize against. This only asks "does a non-empty `steps`
 * array exist, and how long is it?" — structured-step interpretation is
 * intentionally deferred until a real populated `workout_doc.steps`
 * response has been inspected.
 */
function normalizeWorkoutDoc(doc: IntervalsWorkoutDoc, eventDescription: string | null): CalendarEventWorkout {
  const rawSteps = Array.isArray(doc.steps) ? doc.steps : [];

  return {
    structureAvailable: rawSteps.length > 0,
    stepCount: rawSteps.length,
    // Both fields were populated with the same text on the one real event
    // inspected; falling back to the event-level description covers the
    // (also observed as possible) case where workout_doc.description is null.
    description: toStringOrNull(doc.description) ?? eventDescription,
  };
}

/**
 * Converts a raw Intervals.icu calendar event into our normalized
 * `CalendarEvent` shape.
 */
export function normalizeCalendarEvent(raw: IntervalsEvent): CalendarEvent {
  const eventType = classifyEventType(raw);
  const completedActivityId = toStringOrNull(raw.paired_activity_id);
  const description = raw.description ?? null;

  return {
    id: String(raw.id),
    date: raw.start_date_local ?? raw.end_date_local ?? "",
    name: raw.name ?? null,

    category: raw.category ?? null,
    sportType: raw.type ?? null,
    eventType,

    isPlannedWorkout: eventType === "planned_running_workout" || eventType === "planned_workout_other_sport",
    isCompleted: completedActivityId !== null,
    completedActivityId,

    plannedDurationSeconds: numericOrNull(raw.moving_time),
    plannedDistanceMeters: numericOrNull(raw.distance),

    description,

    workout: raw.workout_doc ? normalizeWorkoutDoc(raw.workout_doc, description) : null,
  };
}
