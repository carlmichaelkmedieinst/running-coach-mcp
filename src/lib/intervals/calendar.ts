/**
 * Domain-level access to Intervals.icu calendar events / planned workouts.
 *
 * Like `activities.ts`/`wellness.ts`, this is the layer MCP tools should
 * call. It fetches raw events via the Intervals client, normalizes them,
 * and derives the athlete's next planned running workout. MCP code must
 * not depend on `IntervalsEvent` or call `intervalsGet` directly.
 */

import { z } from "zod";

import { normalizeCalendarEvent } from "@/lib/intervals/calendarEventNormalizers";
import { getIntervalsAthleteId } from "@/lib/intervals/auth";
import { intervalsGet } from "@/lib/intervals/client";
import { getAthleteTimeZone } from "@/lib/running/athleteTimeZone";
import { addDaysToDateOnly, todayDateOnly } from "@/lib/running/dates";
import type { CalendarEvent, CalendarResult, IntervalsEvent } from "@/types/calendarEvent";

export const getCalendarParamsSchema = z.object({
  daysBefore: z.number().int().min(0).max(90).default(7),
  daysAfter: z.number().int().min(1).max(180).default(21),
});

export type GetCalendarParams = z.input<typeof getCalendarParamsSchema>;

/**
 * Fetches raw calendar events for the configured athlete within a date
 * range (confirmed via live discovery: `GET /athlete/{id}/events`,
 * `oldest`/`newest` query params, `"YYYY-MM-DD"`).
 */
async function fetchRawEvents(oldest: string, newest: string): Promise<IntervalsEvent[]> {
  const athleteId = getIntervalsAthleteId();

  const events = await intervalsGet<IntervalsEvent[]>(`/athlete/${athleteId}/events`, {
    oldest,
    newest,
  });

  return Array.isArray(events) ? events : [];
}

function eventDateOnly(event: CalendarEvent): string {
  return event.date.slice(0, 10);
}

/**
 * Selects the earliest today-or-future planned **running** workout that
 * hasn't already been completed — never a non-running workout (return
 * `null` instead, per Milestone 3D's spec, rather than substituting a
 * random event), and never a past one.
 */
function selectNextPlannedWorkout(events: CalendarEvent[], todayStr: string): CalendarEvent | null {
  const candidates = events.filter(
    (event) =>
      event.eventType === "planned_running_workout" && !event.isCompleted && eventDateOnly(event) >= todayStr
  );

  if (candidates.length === 0) {
    return null;
  }

  // `events` is already sorted oldest -> newest by the caller, but sort
  // defensively here too so this function's correctness doesn't depend on
  // that ordering being preserved.
  return candidates.slice().sort((a, b) => (eventDateOnly(a) < eventDateOnly(b) ? -1 : 1))[0];
}

/**
 * Fetches, normalizes, sorts, and summarizes calendar events / planned
 * workouts for the athlete-local date window
 * `[today - daysBefore, today + daysAfter]`.
 *
 * @param daysBefore - How many days before today to include. Integer 0-90, default 7.
 * @param daysAfter - How many days after today to include. Integer 1-180, default 21.
 */
export async function getCalendar(params: GetCalendarParams = {}): Promise<CalendarResult> {
  const { daysBefore, daysAfter } = getCalendarParamsSchema.parse(params);

  // The date window must be the athlete's local calendar date, never the
  // server's timezone or UTC — see `todayDateOnly`'s doc comment.
  const todayStr = todayDateOnly(getAthleteTimeZone());
  const startDate = addDaysToDateOnly(todayStr, -daysBefore);
  const endDate = addDaysToDateOnly(todayStr, daysAfter);

  const rawEvents = await fetchRawEvents(startDate, endDate);

  const events = rawEvents
    .map(normalizeCalendarEvent)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const plannedWorkoutCount = events.filter((event) => event.isPlannedWorkout).length;
  const nextPlannedWorkout = selectNextPlannedWorkout(events, todayStr);

  return {
    startDate,
    endDate,
    eventsReturned: events.length,
    plannedWorkoutCount,
    nextPlannedWorkout,
    events,
  };
}
