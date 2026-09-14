import { describe, expect, it } from "vitest";

import {
  MAX_PACE_SECONDS_PER_KM,
  MAX_REPETITIONS,
  MAX_WARMUP_OR_COOLDOWN_SECONDS,
  MAX_WORK_OR_RECOVERY_SECONDS,
  MIN_PACE_SECONDS_PER_KM,
  MIN_REPETITIONS,
  paceTargetSchema,
  runningWorkoutInputSchema,
} from "./workoutInput";

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

describe("runningWorkoutInputSchema", () => {
  it("accepts a fully valid input", () => {
    expect(() => runningWorkoutInputSchema.parse(validInput())).not.toThrow();
  });

  it("defaults warmupSeconds/recoverySeconds/cooldownSeconds to 0 when omitted", () => {
    const parsed = runningWorkoutInputSchema.parse({
      date: "2026-09-16",
      name: "Tempo",
      repetitions: 1,
      workSeconds: 1200,
    });

    expect(parsed.warmupSeconds).toBe(0);
    expect(parsed.recoverySeconds).toBe(0);
    expect(parsed.cooldownSeconds).toBe(0);
    expect(parsed.paceTarget).toBeUndefined();
  });

  describe("date validation", () => {
    it("rejects a malformed date string", () => {
      expect(() => runningWorkoutInputSchema.parse(validInput({ date: "09/16/2026" }))).toThrow();
    });

    it("rejects a syntactically-plausible but nonexistent calendar date", () => {
      expect(() => runningWorkoutInputSchema.parse(validInput({ date: "2026-02-30" }))).toThrow();
    });

    it("accepts a valid YYYY-MM-DD date", () => {
      expect(() => runningWorkoutInputSchema.parse(validInput({ date: "2026-12-25" }))).not.toThrow();
    });
  });

  describe("name validation", () => {
    it("rejects an empty name", () => {
      expect(() => runningWorkoutInputSchema.parse(validInput({ name: "" }))).toThrow();
    });

    it("rejects a name that is only whitespace", () => {
      expect(() => runningWorkoutInputSchema.parse(validInput({ name: "   " }))).toThrow();
    });

    it("rejects a name over the max length", () => {
      expect(() => runningWorkoutInputSchema.parse(validInput({ name: "x".repeat(201) }))).toThrow();
    });
  });

  describe("repetitions limits", () => {
    it(`accepts the boundaries (${MIN_REPETITIONS} and ${MAX_REPETITIONS})`, () => {
      expect(() => runningWorkoutInputSchema.parse(validInput({ repetitions: MIN_REPETITIONS }))).not.toThrow();
      expect(() => runningWorkoutInputSchema.parse(validInput({ repetitions: MAX_REPETITIONS }))).not.toThrow();
    });

    it("rejects below the minimum or above the maximum", () => {
      expect(() => runningWorkoutInputSchema.parse(validInput({ repetitions: MIN_REPETITIONS - 1 }))).toThrow();
      expect(() => runningWorkoutInputSchema.parse(validInput({ repetitions: MAX_REPETITIONS + 1 }))).toThrow();
    });

    it("rejects a non-integer", () => {
      expect(() => runningWorkoutInputSchema.parse(validInput({ repetitions: 6.5 }))).toThrow();
    });
  });

  describe("duration limits", () => {
    it("rejects workSeconds <= 0", () => {
      expect(() => runningWorkoutInputSchema.parse(validInput({ workSeconds: 0 }))).toThrow();
      expect(() => runningWorkoutInputSchema.parse(validInput({ workSeconds: -1 }))).toThrow();
    });

    it("rejects negative warmup/recovery/cooldown", () => {
      expect(() => runningWorkoutInputSchema.parse(validInput({ warmupSeconds: -1 }))).toThrow();
      expect(() => runningWorkoutInputSchema.parse(validInput({ recoverySeconds: -1 }))).toThrow();
      expect(() => runningWorkoutInputSchema.parse(validInput({ cooldownSeconds: -1 }))).toThrow();
    });

    it("accepts 0 for warmup/recovery/cooldown", () => {
      expect(() =>
        runningWorkoutInputSchema.parse(validInput({ warmupSeconds: 0, recoverySeconds: 0, cooldownSeconds: 0 }))
      ).not.toThrow();
    });

    it("rejects durations over their reasonable upper limits", () => {
      expect(() =>
        runningWorkoutInputSchema.parse(validInput({ warmupSeconds: MAX_WARMUP_OR_COOLDOWN_SECONDS + 1 }))
      ).toThrow();
      expect(() =>
        runningWorkoutInputSchema.parse(validInput({ workSeconds: MAX_WORK_OR_RECOVERY_SECONDS + 1 }))
      ).toThrow();
    });
  });

  describe("pace limits", () => {
    it(`accepts the boundaries (${MIN_PACE_SECONDS_PER_KM} and ${MAX_PACE_SECONDS_PER_KM})`, () => {
      expect(() =>
        paceTargetSchema.parse({ minSecondsPerKm: MIN_PACE_SECONDS_PER_KM, maxSecondsPerKm: MIN_PACE_SECONDS_PER_KM + 1 })
      ).not.toThrow();
      expect(() =>
        paceTargetSchema.parse({ minSecondsPerKm: MAX_PACE_SECONDS_PER_KM - 1, maxSecondsPerKm: MAX_PACE_SECONDS_PER_KM })
      ).not.toThrow();
    });

    it("rejects pace values outside sensible running bounds", () => {
      expect(() =>
        paceTargetSchema.parse({ minSecondsPerKm: MIN_PACE_SECONDS_PER_KM - 1, maxSecondsPerKm: 285 })
      ).toThrow();
      expect(() =>
        paceTargetSchema.parse({ minSecondsPerKm: 275, maxSecondsPerKm: MAX_PACE_SECONDS_PER_KM + 1 })
      ).toThrow();
    });

    it("rejects an inverted pace range (faster bound not lower) rather than swapping it", () => {
      expect(() => paceTargetSchema.parse({ minSecondsPerKm: 285, maxSecondsPerKm: 275 })).toThrow();
    });

    it("rejects an equal (zero-width) pace range", () => {
      expect(() => paceTargetSchema.parse({ minSecondsPerKm: 275, maxSecondsPerKm: 275 })).toThrow();
    });

    it("accepts a workout input with no pace target at all", () => {
      expect(() => runningWorkoutInputSchema.parse(validInput({ paceTarget: undefined }))).not.toThrow();
    });

    it("rejects a workout input with an inverted pace target", () => {
      expect(() =>
        runningWorkoutInputSchema.parse(validInput({ paceTarget: { minSecondsPerKm: 285, maxSecondsPerKm: 275 } }))
      ).toThrow();
    });
  });
});
