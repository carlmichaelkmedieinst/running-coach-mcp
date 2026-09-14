/**
 * Type definitions for calendar events / planned workouts, as returned by
 * Intervals.icu's `/athlete/{id}/events` endpoint.
 *
 * Confirmed via live read-only discovery against a real account
 * (Milestone 3D): the endpoint returns a flat array of events across a
 * date window (`oldest`/`newest` query params, `"YYYY-MM-DD"`), covering
 * both planned workouts and other calendar entries (notes, etc.) in one
 * list. Only ONE real event existed in this account at discovery time — a
 * past, free-text-only planned running workout, already completed and
 * linked to a real activity (`category: "WORKOUT"`, `type: "Run"`,
 * `paired_activity_id` pointing at the completed activity,
 * `workout_doc.steps: []`). Every field modeled below was directly
 * observed on that real event; nothing here is guessed.
 *
 * IMPORTANT CAVEAT: this account has no populated `workout_doc.steps`
 * example (no structured/step-builder workout exists to inspect), and no
 * example of any `category` value other than `"WORKOUT"` (querying
 * `category=NOTE` / `category=RACE_A` both returned `200 []` — accepted
 * by the API, but unconfirmed as actually meaningful for this account).
 * See `src/lib/intervals/calendarEventNormalizers.ts` for how that
 * uncertainty is handled (conservatively — see its module doc comment).
 */

/**
 * Minimal shape of one raw Intervals.icu calendar event.
 *
 * Intervals.icu's real event schema has 60+ fields (power/HR targets,
 * plan/folder linkage, push/sync bookkeeping, ...); we only model the
 * subset that (a) exists and (b) is useful for read-only coaching
 * questions. `id` is a plain number here (unlike activity ids, which are
 * strings like `"i186254951"`).
 */
export interface IntervalsEvent {
  id: number;
  /** Local wall-clock start, e.g. `"2026-09-05T00:00:00"` — already athlete-local, same convention as `IntervalsActivity.start_date_local`. */
  start_date_local: string | null;
  end_date_local: string | null;

  name: string | null;
  /** Sport, e.g. `"Run"`, `"Ride"`. Only present/meaningful for workout-type events. */
  type: string | null;
  /**
   * Event category. Only `"WORKOUT"` has been confirmed via live data for
   * this account. Passed through verbatim rather than assumed to mean
   * anything beyond that one confirmed value.
   */
  category: string | null;
  description: string | null;

  /**
   * For a `"WORKOUT"` event, the planned duration in seconds. On the one
   * real (completed, paired) event observed, this matched the linked
   * activity's actual moving time — so for an event that's already been
   * completed, this may reflect what actually happened rather than a
   * pre-workout target. Unconfirmed which value it holds for a genuinely
   * future, not-yet-completed event (this account has none to check).
   */
  moving_time: number | null;
  /** Same caveat as `moving_time`, but for distance (meters). */
  distance: number | null;

  /** Confirmed real field: true when the event is meant to display as a plain note rather than a workout. */
  show_as_note: boolean | null;

  /**
   * Confirmed real field (present on the list endpoint's event objects,
   * notably absent from the single-event detail endpoint's response for
   * the same event): the linked completed activity's id, when this
   * planned event has been paired with a real activity. `null`/absent
   * when not completed/linked.
   */
  paired_activity_id: string | null;

  workout_doc: IntervalsWorkoutDoc | null;
}

/**
 * The "plan document" attached to a workout-type event. Confirmed present
 * (with these exact keys) on the one real event inspected — `steps` was
 * an empty array there (a free-text-only plan).
 *
 * INTENTIONALLY NOT MODELED: the shape of an individual populated step.
 * No event available to this account has ever had a non-empty `steps`
 * array, so there is no live-confirmed schema to normalize against.
 * `steps` is deliberately typed as `unknown[]` here — normalization only
 * ever asks "does this array exist, and how long is it?" (see
 * `normalizeWorkoutDoc` in `calendarEventNormalizers.ts`); it never reads
 * into an individual step's fields. Structured-step interpretation is
 * intentionally deferred until a real populated `workout_doc.steps`
 * response has been inspected.
 */
export interface IntervalsWorkoutDoc {
  steps: unknown[] | null;
  description: string | null;
  distance: number | null;
  duration: number | null;
}

// ---------------------------------------------------------------------------
// Normalized domain model
// ---------------------------------------------------------------------------

/**
 * Conservative, derived classification of a calendar event. See
 * `classifyEventType` in `calendarEventNormalizers.ts` for exactly which
 * raw signals each bucket is based on — every bucket here is backed by a
 * confirmed real field; `"other"` is the deliberate fallback for anything
 * not confidently classifiable, rather than guessing.
 */
export type CalendarEventType = "planned_running_workout" | "planned_workout_other_sport" | "note" | "other";

/**
 * Normalized workout plan for one calendar event.
 *
 * Deliberately conservative: this only reports whether structured step
 * data exists and how many steps there are, plus the free-text
 * description. It does NOT interpret individual steps (no per-step
 * duration/distance/target/repetition fields) because no real
 * Intervals.icu event with a populated `workout_doc.steps` array has ever
 * been inspected — see `IntervalsWorkoutDoc`'s doc comment.
 */
export interface CalendarEventWorkout {
  /** `true` only when `steps` is genuinely non-empty. `false` for a free-text-only plan (never fabricated from prose). */
  structureAvailable: boolean;
  /** `steps.length`, i.e. how many structured steps exist — `0` when `structureAvailable` is `false`. */
  stepCount: number;
  /** The plan's free-text description, if any (e.g. `workout_doc.description`, falling back to the event's own `description`). */
  description: string | null;
}

/** Our own normalized representation of one calendar event. */
export interface CalendarEvent {
  /** Stringified for consistency with other tools' id fields; the raw Intervals id is a plain number. */
  id: string;
  /** Local wall-clock start, unmodified pass-through of `start_date_local` (already athlete-local, per Intervals.icu's own storage). */
  date: string;
  name: string | null;

  /** Raw `category`, passed through unmodified (e.g. `"WORKOUT"`). */
  category: string | null;
  /** Raw `type` (sport), e.g. `"Run"`. */
  sportType: string | null;
  eventType: CalendarEventType;

  /** `true` for `"planned_running_workout"` or `"planned_workout_other_sport"`. */
  isPlannedWorkout: boolean;
  /** `true` only when `completedActivityId` is non-null (never inferred from date alone). */
  isCompleted: boolean;
  /** Linked completed activity id (`paired_activity_id`), or `null` if not linked/completed. */
  completedActivityId: string | null;

  plannedDurationSeconds: number | null;
  plannedDistanceMeters: number | null;

  description: string | null;

  /** `null` when the raw event has no `workout_doc` at all; otherwise reflects whatever structure (if any) it has. */
  workout: CalendarEventWorkout | null;
}

/** Normalized response for `getCalendar`. */
export interface CalendarResult {
  /** `"YYYY-MM-DD"`, athlete-local, inclusive. */
  startDate: string;
  /** `"YYYY-MM-DD"`, athlete-local, inclusive. */
  endDate: string;

  eventsReturned: number;
  plannedWorkoutCount: number;

  /**
   * The earliest today-or-future planned **running** workout that hasn't
   * already been completed, or `null` if there is none — never a
   * non-running workout, and never a random/arbitrary event.
   */
  nextPlannedWorkout: CalendarEvent | null;

  /** Oldest → newest. */
  events: CalendarEvent[];
}
