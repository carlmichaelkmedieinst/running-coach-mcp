/**
 * Validated, application-level input model for creating/updating a planned
 * running workout (Milestone 3E).
 *
 * Deliberately narrow (V1): a running workout consisting of an optional
 * warmup, N repetitions of a work interval (with an optional absolute pace
 * range target) + recovery, and an optional cooldown — all steps
 * time-based. No distance-based steps, HR/power targets, pace zones,
 * threshold percentages, ramps, cadence, or multisport support yet.
 *
 * This schema is intentionally the single source of truth for these
 * bounds: it's used both for defensive validation inside the domain layer
 * (`src/lib/intervals/workouts.ts`) AND, reused as-is (see
 * `src/app/api/mcp/route.ts`), as the MCP tool `inputSchema` for
 * `create_running_workout`/`update_running_workout` — so the limits an AI
 * client sees are always exactly the limits actually enforced, never a
 * second, hand-copied set of numbers that could drift out of sync.
 */

import { z } from "zod";

import { isValidDateOnly } from "@/lib/running/dates";

/** Sensible upper bound on a workout name's length. */
export const MAX_WORKOUT_NAME_LENGTH = 200;

/** Sensible upper bound on optional free-text notes (see `RunningWorkoutInput.notes`). */
export const MAX_NOTES_LENGTH = 1000;

/** Sensible upper bound for a single warmup/cooldown block: 3 hours. */
export const MAX_WARMUP_OR_COOLDOWN_SECONDS = 3 * 60 * 60;

/** Sensible upper bound for a single work/recovery interval: 1 hour. */
export const MAX_WORK_OR_RECOVERY_SECONDS = 60 * 60;

export const MIN_REPETITIONS = 1;
export const MAX_REPETITIONS = 30;

/**
 * Sanity bounds for an absolute pace *target* on a work interval — i.e. a
 * pace an athlete could plausibly be asked to hold for a structured
 * interval, not the full realistic range of all human running speeds.
 * ~2:00/km (120s) is close to world-record short-interval pace; ~10:00/km
 * (600s) is far slower than any pace a "work" interval would sensibly
 * target (a genuinely easy jog wouldn't carry a pace target at all).
 */
export const MIN_PACE_SECONDS_PER_KM = 120;
export const MAX_PACE_SECONDS_PER_KM = 600;

/**
 * An absolute pace range target, in whole seconds per kilometer.
 * `minSecondsPerKm` is the FASTER bound (fewer seconds = faster); it must
 * be strictly less than `maxSecondsPerKm`, the SLOWER bound. Inverted
 * bounds are rejected with a clear error rather than silently swapped —
 * see the `.refine` below.
 */
export const paceTargetSchema = z
  .object({
    minSecondsPerKm: z
      .number()
      .int()
      .min(MIN_PACE_SECONDS_PER_KM)
      .max(MAX_PACE_SECONDS_PER_KM)
      .describe(
        `The FASTER (numerically lower) end of the pace range, in whole seconds per kilometer, e.g. 275 = 4:35/km. Must be ${MIN_PACE_SECONDS_PER_KM}-${MAX_PACE_SECONDS_PER_KM} and strictly less than maxSecondsPerKm.`
      ),
    maxSecondsPerKm: z
      .number()
      .int()
      .min(MIN_PACE_SECONDS_PER_KM)
      .max(MAX_PACE_SECONDS_PER_KM)
      .describe(
        `The SLOWER (numerically higher) end of the pace range, in whole seconds per kilometer, e.g. 285 = 4:45/km. Must be ${MIN_PACE_SECONDS_PER_KM}-${MAX_PACE_SECONDS_PER_KM} and strictly greater than minSecondsPerKm.`
      ),
  })
  .refine((pace) => pace.minSecondsPerKm < pace.maxSecondsPerKm, {
    message:
      "paceTarget.minSecondsPerKm (the faster bound) must be strictly less than maxSecondsPerKm (the slower bound) — inverted pace ranges are rejected rather than silently swapped.",
  });

export type PaceTarget = z.infer<typeof paceTargetSchema>;

/**
 * Full validated input for `createRunningWorkout`/`updateRunningWorkout`.
 * See this module's doc comment for the V1 scope this deliberately covers
 * (and does not cover).
 */
export const runningWorkoutInputSchema = z.object({
  date: z
    .string()
    .refine(isValidDateOnly, {
      message: 'date must be a valid "YYYY-MM-DD" athlete-local calendar date (e.g. "2026-09-16").',
    })
    .describe('The athlete-local calendar date to schedule the workout on, as "YYYY-MM-DD" (e.g. "2026-09-16").'),

  name: z
    .string()
    .trim()
    .min(1, "name is required.")
    .max(MAX_WORKOUT_NAME_LENGTH, `name must be at most ${MAX_WORKOUT_NAME_LENGTH} characters.`)
    .describe("Workout title, e.g. \"6 x 90s intervals\"."),

  warmupSeconds: z
    .number()
    .int()
    .min(0)
    .max(MAX_WARMUP_OR_COOLDOWN_SECONDS)
    .default(0)
    .describe("Warmup duration in seconds. 0 (default) omits the warmup entirely."),

  repetitions: z
    .number()
    .int()
    .min(MIN_REPETITIONS)
    .max(MAX_REPETITIONS)
    .describe(`Number of work/recovery repetitions, ${MIN_REPETITIONS}-${MAX_REPETITIONS}.`),

  workSeconds: z
    .number()
    .int()
    .min(1, "workSeconds must be greater than 0.")
    .max(MAX_WORK_OR_RECOVERY_SECONDS)
    .describe("Duration of each work interval, in seconds (must be > 0)."),

  recoverySeconds: z
    .number()
    .int()
    .min(0)
    .max(MAX_WORK_OR_RECOVERY_SECONDS)
    .default(0)
    .describe("Duration of each recovery interval, in seconds. 0 (default) omits recovery between reps entirely."),

  paceTarget: paceTargetSchema
    .optional()
    .describe(
      "Optional absolute pace range target applied to each work interval. Omit entirely for no pace target."
    ),

  cooldownSeconds: z
    .number()
    .int()
    .min(0)
    .max(MAX_WARMUP_OR_COOLDOWN_SECONDS)
    .default(0)
    .describe("Cooldown duration in seconds. 0 (default) omits the cooldown entirely."),

  notes: z
    .string()
    .trim()
    .max(MAX_NOTES_LENGTH)
    .optional()
    .describe(
      "Optional free-text notes. NOT YET included in the generated Intervals.icu workout text (deferred until a confirmed-safe placement is verified) — accepted for forward compatibility only."
    ),
});

export type RunningWorkoutInput = z.infer<typeof runningWorkoutInputSchema>;
