/**
 * Domain-level write access to Intervals.icu planned running workouts
 * (Milestone 3E).
 *
 * Like `calendar.ts`, this is the layer MCP tools should call. Unlike
 * every other module in `src/lib/intervals/*`, this one performs real
 * side-effecting API calls (`POST`/`PUT`/`DELETE`) — see the safety
 * checks in `assertMutableRunningWorkoutEvent` before treating any of
 * this as safe to call blindly. Notably, `updateRunningWorkout`/
 * `deleteRunningWorkout`'s completed/paired check is NOT best-effort: it
 * re-verifies via the events LIST endpoint (which reliably includes
 * `paired_activity_id`, unlike the single-event endpoint) and fails
 * closed if the event can't be re-found there — see
 * `assertNotPairedViaListEndpoint`.
 *
 * IMPORTANT ARCHITECTURE DECISION: this module NEVER constructs or sends
 * `workout_doc` itself. It only ever sends native Intervals.icu
 * workout-builder TEXT (via `generateWorkoutText`, `src/lib/running/workoutText.ts`)
 * in the event's `description` field; Intervals.icu's own server parses
 * that text into `workout_doc`. This is deliberate — see this project's
 * README and the module doc comment on `workoutText.ts` for why.
 */

import { z, ZodError } from "zod";

import { getIntervalsAthleteId } from "@/lib/intervals/auth";
import { normalizeCalendarEvent } from "@/lib/intervals/calendarEventNormalizers";
import { intervalsDelete, intervalsGet, intervalsPost, intervalsPut, IntervalsApiError } from "@/lib/intervals/client";
import { isRunningActivityType } from "@/lib/intervals/normalizers";
import { isValidDateOnly } from "@/lib/running/dates";
import { generateWorkoutText } from "@/lib/running/workoutText";
import { runningWorkoutInputSchema, type RunningWorkoutInput } from "@/lib/running/workoutInput";
import type { CalendarEvent, IntervalsEvent } from "@/types/calendarEvent";

/**
 * An Intervals.icu event id, as accepted by all three write tools. Plain
 * numeric Intervals.icu event ids are always non-negative integers (see
 * `src/types/calendarEvent.ts`'s doc comment); accepting it as a
 * `string` here (rather than `number`) matches how every other
 * id-accepting tool in this project works (e.g. `get_run_details`'s
 * `activityId`) and avoids floating-point foot-guns for large ids.
 */
export const eventIdSchema = z
  .string()
  .trim()
  .min(1, "eventId is required.")
  .regex(/^\d+$/, "eventId must be a numeric Intervals.icu event id.")
  .describe('The Intervals.icu event id, e.g. "133599091" (as returned by get_calendar or create_running_workout).');

/** Compact result returned by `deleteRunningWorkout` — deliberately not a full `CalendarEvent`. */
export interface DeleteRunningWorkoutResult {
  deleted: true;
  eventId: string;
  name: string | null;
  date: string | null;
}

/**
 * Turns any error thrown by this module's exported functions into a
 * single, clean, credential-free message suitable for an MCP tool
 * response — including `ZodError`s from invalid input, which otherwise
 * stringify as a hard-to-read JSON blob.
 */
export function describeWorkoutError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join(" ");
  }

  if (error instanceof IntervalsApiError || error instanceof Error) {
    return error.message;
  }

  return "Intervals.icu request failed unexpectedly.";
}

/**
 * The event payload this project ever sends to Intervals.icu's
 * create/update endpoints. Deliberately minimal — see this module's doc
 * comment: no `workout_doc`, no computed distance/duration/training
 * load. Intervals.icu derives all of that itself from `description`.
 */
interface IntervalsEventWritePayload {
  category: "WORKOUT";
  type: "Run";
  start_date_local: string;
  name: string;
  description: string;
}

function buildEventPayload(input: RunningWorkoutInput): IntervalsEventWritePayload {
  return {
    category: "WORKOUT",
    type: "Run",
    start_date_local: `${input.date}T00:00:00`,
    name: input.name,
    description: generateWorkoutText(input),
  };
}

/** Whether `value` looks like a usable raw Intervals.icu event object (has at least an `id`). */
function isPlausibleRawEvent(value: unknown): value is IntervalsEvent {
  return typeof value === "object" && value !== null && "id" in value;
}

/**
 * Validates a freshly created/updated raw event against what we asked
 * for, normalizes it, and returns the result — shared by
 * `createRunningWorkout`/`updateRunningWorkout` so both apply the exact
 * same "don't just trust the API response" checks.
 */
function normalizeAndVerifyWrittenEvent(raw: unknown, input: RunningWorkoutInput): CalendarEvent {
  if (!isPlausibleRawEvent(raw)) {
    throw new IntervalsApiError("Intervals.icu returned a malformed response.");
  }

  const normalized = normalizeCalendarEvent(raw);

  if (normalized.category !== "WORKOUT") {
    throw new IntervalsApiError(
      `Intervals.icu accepted the write but the resulting event has category "${normalized.category ?? "null"}", not "WORKOUT".`
    );
  }

  if (normalized.sportType !== "Run") {
    throw new IntervalsApiError(
      `Intervals.icu accepted the write but the resulting event's sport is "${normalized.sportType ?? "null"}", not "Run".`
    );
  }

  if (normalized.date.slice(0, 10) !== input.date) {
    throw new IntervalsApiError(
      `Intervals.icu accepted the write but the resulting event's date ("${normalized.date}") doesn't match the requested date ("${input.date}").`
    );
  }

  if (normalized.name !== input.name) {
    throw new IntervalsApiError(
      `Intervals.icu accepted the write but the resulting event's name ("${normalized.name ?? "null"}") doesn't match the requested name ("${input.name}").`
    );
  }

  return normalized;
}

/**
 * Fetches one raw event by id (`GET /athlete/{id}/events/{eventId}`),
 * translating a 404 into our own clean "not found" error.
 *
 * NOTE (confirmed via Milestone 3D's live discovery): this single-event
 * endpoint has been observed to OMIT `paired_activity_id`, unlike the
 * list endpoint. This module never relies on `paired_activity_id` from
 * this response for that reason — see `assertNotPairedViaListEndpoint`
 * for the reliable check used instead.
 */
async function fetchExistingWorkoutEvent(eventId: string): Promise<IntervalsEvent> {
  const athleteId = getIntervalsAthleteId();

  try {
    return await intervalsGet<IntervalsEvent>(`/athlete/${athleteId}/events/${eventId}`);
  } catch (error) {
    if (error instanceof IntervalsApiError && error.status === 404) {
      throw new Error("Workout event not found.");
    }

    throw error;
  }
}

/**
 * Extracts a validated `"YYYY-MM-DD"` date from `raw.start_date_local`,
 * for use as the exact single-day window queried against the list
 * endpoint in `assertNotPairedViaListEndpoint`. Fails loudly (never
 * silently proceeds without a pairing check) if the date is missing or
 * malformed.
 */
function extractEventDateOnly(raw: IntervalsEvent, action: "update" | "delete"): string {
  const startDateLocal = raw.start_date_local;

  if (!startDateLocal || startDateLocal.length < 10) {
    throw new Error(
      `Cannot ${action} event ${raw.id}: it has no start_date_local, so its completion/pairing status cannot be reliably verified.`
    );
  }

  const dateOnly = startDateLocal.slice(0, 10);

  if (!isValidDateOnly(dateOnly)) {
    throw new Error(
      `Cannot ${action} event ${raw.id}: its start_date_local ("${startDateLocal}") does not contain a valid date, so its completion/pairing status cannot be reliably verified.`
    );
  }

  return dateOnly;
}

/**
 * Reliably determines whether `raw` is already completed/linked to a real
 * activity, and refuses (throws) if so.
 *
 * WHY THIS EXISTS: `GET /athlete/{id}/events/{eventId}` (the single-event
 * endpoint used by `fetchExistingWorkoutEvent`) has been confirmed, via
 * live discovery, to OMIT `paired_activity_id` — so it can never be
 * trusted to answer "is this already completed?". `GET
 * /athlete/{id}/events?oldest=...&newest=...` (the list endpoint,
 * confirmed via the same discovery) DOES include `paired_activity_id`.
 * This function re-fetches the event's own calendar day via the list
 * endpoint, finds the matching event by numeric id, and inspects
 * `paired_activity_id` on THAT object instead.
 *
 * FAILS CLOSED: if the event can't be found again in the list response
 * for its own date (e.g. it was deleted concurrently, or Intervals.icu's
 * two endpoints disagree for some other reason), this refuses the
 * update/delete rather than proceeding without a reliable pairing check.
 */
async function assertNotPairedViaListEndpoint(raw: IntervalsEvent, action: "update" | "delete"): Promise<void> {
  const dateOnly = extractEventDateOnly(raw, action);
  const athleteId = getIntervalsAthleteId();

  const listEvents = await intervalsGet<IntervalsEvent[]>(`/athlete/${athleteId}/events`, {
    oldest: dateOnly,
    newest: dateOnly,
  });

  const events = Array.isArray(listEvents) ? listEvents : [];
  const matching = events.find((event) => String(event.id) === String(raw.id));

  if (!matching) {
    throw new Error(
      `Cannot ${action} event ${raw.id}: it could not be re-verified via the events list endpoint (failing closed rather than proceeding without a reliable completion/pairing check).`
    );
  }

  if (matching.paired_activity_id) {
    throw new Error(
      `Cannot ${action} event ${raw.id}: it is already completed and linked to activity ${matching.paired_activity_id}.`
    );
  }
}

/**
 * Guards `updateRunningWorkout`/`deleteRunningWorkout` against acting on
 * anything other than a not-yet-completed planned running workout — never
 * an arbitrary note, another sport's workout, or an already-completed/
 * paired one. The category/sport checks are synchronous (cheap, from the
 * already-fetched single event); the completed/paired check is async and
 * reliable — see `assertNotPairedViaListEndpoint`.
 */
async function assertMutableRunningWorkoutEvent(raw: IntervalsEvent, action: "update" | "delete"): Promise<void> {
  if (raw.category !== "WORKOUT") {
    throw new Error(
      `Cannot ${action} event ${raw.id}: it is not a WORKOUT-category event (category is "${raw.category ?? "null"}").`
    );
  }

  if (!isRunningActivityType(raw.type)) {
    throw new Error(`Cannot ${action} event ${raw.id}: it is not a running workout (sport is "${raw.type ?? "null"}").`);
  }

  await assertNotPairedViaListEndpoint(raw, action);
}

/**
 * Creates a new planned running workout on the athlete's Intervals.icu
 * calendar (`POST /athlete/{id}/events`).
 *
 * Sends only `category`/`type`/`start_date_local`/`name`/`description` —
 * `description` is native Intervals.icu workout-builder text generated by
 * `generateWorkoutText`, never a hand-built `workout_doc`. After
 * creation, validates the returned event's category/sport/date/name
 * before normalizing and returning it — no extra `GET` is performed.
 */
export async function createRunningWorkout(input: RunningWorkoutInput): Promise<CalendarEvent> {
  const parsed = runningWorkoutInputSchema.parse(input);
  const athleteId = getIntervalsAthleteId();
  const payload = buildEventPayload(parsed);

  const created = await intervalsPost<unknown>(`/athlete/${athleteId}/events`, payload);

  return normalizeAndVerifyWrittenEvent(created, parsed);
}

/**
 * Updates an existing planned running workout
 * (`PUT /athlete/{id}/events/{eventId}`) with a complete replacement
 * payload.
 *
 * Before writing: fetches the existing event, and refuses to proceed
 * unless it's a not-yet-completed planned running workout — including a
 * RELIABLE completed/paired check via the events list endpoint (see
 * `assertMutableRunningWorkoutEvent` / `assertNotPairedViaListEndpoint`).
 * The `PUT` payload is built fresh from `input` only — never from the
 * fetched event — so no stale calculated fields (duration, distance,
 * training load, `workout_doc`, ...) are ever echoed back.
 */
export async function updateRunningWorkout(
  input: { eventId: string } & RunningWorkoutInput
): Promise<CalendarEvent> {
  const eventId = eventIdSchema.parse(input.eventId);
  const parsed = runningWorkoutInputSchema.parse(input);

  const existing = await fetchExistingWorkoutEvent(eventId);
  await assertMutableRunningWorkoutEvent(existing, "update");

  const athleteId = getIntervalsAthleteId();
  const payload = buildEventPayload(parsed);

  const updated = await intervalsPut<unknown>(`/athlete/${athleteId}/events/${eventId}`, payload);

  return normalizeAndVerifyWrittenEvent(updated, parsed);
}

/**
 * Deletes an existing planned running workout
 * (`DELETE /athlete/{id}/events/{eventId}`).
 *
 * Before deleting: fetches the existing event, and refuses to proceed
 * unless it's a not-yet-completed planned running workout — including a
 * RELIABLE completed/paired check via the events list endpoint (see
 * `assertMutableRunningWorkoutEvent` / `assertNotPairedViaListEndpoint`).
 * Returns a compact confirmation object rather than a full normalized
 * event.
 */
export async function deleteRunningWorkout(input: { eventId: string }): Promise<DeleteRunningWorkoutResult> {
  const eventId = eventIdSchema.parse(input.eventId);

  const existing = await fetchExistingWorkoutEvent(eventId);
  await assertMutableRunningWorkoutEvent(existing, "delete");

  const athleteId = getIntervalsAthleteId();
  await intervalsDelete(`/athlete/${athleteId}/events/${eventId}`);

  const rawDate = existing.start_date_local ?? existing.end_date_local ?? null;

  return {
    deleted: true,
    eventId,
    name: existing.name ?? null,
    date: rawDate ? rawDate.slice(0, 10) : null,
  };
}
