/**
 * Pure conversion from our validated `RunningWorkoutInput` app-level model
 * into Intervals.icu's native workout-builder text syntax (Milestone 3E).
 *
 * IMPORTANT ARCHITECTURE DECISION: this project never writes `workout_doc`
 * directly. Intervals.icu's own workout-builder text parser is the only
 * thing that ever produces `workout_doc` for a workout created/updated by
 * this project — this module just produces the text Intervals.icu itself
 * compiles (confirmed as the officially supported way to create/update
 * structured workouts via the API; direct `workout_doc` writes have been
 * reported to cause Garmin/export problems). See `src/lib/intervals/workouts.ts`
 * for where the resulting text is placed (the event's `description` field).
 *
 * Syntax confirmed via Intervals.icu's own community-maintained workout
 * builder syntax references (forum "Workout Builder Syntax Quick Guide";
 * the `intervals-icu-workout-parser` spec) — not guessed:
 * - Durations: `m` = minutes, `s` = seconds, e.g. `12m`, `90s`, `5m30s`.
 *   Plain `m` is NEVER meters (that's `mtr`) — irrelevant here since V1 is
 *   time-based only, but worth being explicit about given how easy this is
 *   to get backwards.
 * - Absolute pace targets REQUIRE the trailing word `Pace`; a bare
 *   `4:35/km` with no `Pace` word is silently dropped by Intervals.icu's
 *   parser. An absolute pace RANGE repeats the unit on both sides, e.g.
 *   `4:35/km-4:45/km Pace` (faster bound first).
 * - `intensity=` accepts exactly `warmup`, `active`, `rest`, `cooldown`.
 *   There is no `interval`/`recovery` value — work intervals use `active`,
 *   recovery steps use `rest` (the only tag that reliably exports as a
 *   real rest step on-device).
 * - Repeats use a bare `Nx` line (no section title required) immediately
 *   before the repeated steps, with a blank line before and after the
 *   block.
 * - `Warmup` / `Cooldown` section headers are themselves meaningful
 *   (treated as warmup/cooldown on device export), so warmup/cooldown
 *   steps live under those headers rather than needing `intensity=` to do
 *   the work alone — this module still tags them explicitly too, which is
 *   documented as harmless (redundant, not conflicting).
 */

import type { PaceTarget, RunningWorkoutInput } from "@/lib/running/workoutInput";

/** Below this many seconds, a duration is written in seconds even if it isn't a whole number of minutes (e.g. `90s`, not `1m30s`). */
const SECONDS_FORMAT_THRESHOLD = 120;

/**
 * Formats a whole number of seconds as compact Intervals.icu duration
 * text: an exact multiple of 60 becomes `Nm` (e.g. `720` -> `"12m"`), a
 * duration under {@link SECONDS_FORMAT_THRESHOLD} that isn't a whole
 * number of minutes becomes `Ns` (e.g. `90` -> `"90s"`), and anything
 * else becomes combined `AmBs` (e.g. `330` -> `"5m30s"`).
 */
export function formatCompactDuration(totalSeconds: number): string {
  if (totalSeconds % 60 === 0) {
    return `${totalSeconds / 60}m`;
  }

  if (totalSeconds < SECONDS_FORMAT_THRESHOLD) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds}s`;
}

/** Formats whole seconds-per-km as clock-style `"M:SS"`, e.g. `275` -> `"4:35"`. */
function formatPaceClock(secondsPerKm: number): string {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Formats an absolute pace range target as Intervals.icu workout-builder
 * text, e.g. `{ minSecondsPerKm: 275, maxSecondsPerKm: 285 }` ->
 * `"4:35/km-4:45/km Pace"`. The trailing `Pace` word is required by
 * Intervals.icu's parser (see this module's doc comment); the unit is
 * repeated on both sides of the range, per the confirmed range syntax.
 */
export function formatPaceRangeTarget(paceTarget: PaceTarget): string {
  return `${formatPaceClock(paceTarget.minSecondsPerKm)}/km-${formatPaceClock(paceTarget.maxSecondsPerKm)}/km Pace`;
}

function buildWorkLine(input: RunningWorkoutInput): string {
  const duration = formatCompactDuration(input.workSeconds);
  const target = input.paceTarget ? ` ${formatPaceRangeTarget(input.paceTarget)}` : "";
  return `- ${duration}${target} intensity=active`;
}

function buildRecoveryLine(recoverySeconds: number): string {
  return `- ${formatCompactDuration(recoverySeconds)} intensity=rest`;
}

interface WorkoutTextBlock {
  /** `null` for the unnamed main work/recovery block when `repetitions === 1` (no repeat header needed). */
  header: string | null;
  lines: string[];
}

/**
 * Converts a validated `RunningWorkoutInput` into native Intervals.icu
 * workout-builder text, suitable for the event `description` field.
 *
 * Pure function: assumes `input` has already been validated against
 * `runningWorkoutInputSchema` (this module never re-validates or clamps
 * values itself). `input.notes` is deliberately NOT included — see
 * `runningWorkoutInputSchema`'s doc comment on `notes` for why.
 */
export function generateWorkoutText(input: RunningWorkoutInput): string {
  const blocks: WorkoutTextBlock[] = [];

  if (input.warmupSeconds > 0) {
    blocks.push({
      header: "Warmup",
      lines: [`- ${formatCompactDuration(input.warmupSeconds)} intensity=warmup`],
    });
  }

  const mainLines = [buildWorkLine(input)];
  if (input.recoverySeconds > 0) {
    mainLines.push(buildRecoveryLine(input.recoverySeconds));
  }

  blocks.push({
    header: input.repetitions > 1 ? `${input.repetitions}x` : null,
    lines: mainLines,
  });

  if (input.cooldownSeconds > 0) {
    blocks.push({
      header: "Cooldown",
      lines: [`- ${formatCompactDuration(input.cooldownSeconds)} intensity=cooldown`],
    });
  }

  return blocks
    .map((block) => (block.header ? `${block.header}\n${block.lines.join("\n")}` : block.lines.join("\n")))
    .join("\n\n");
}
