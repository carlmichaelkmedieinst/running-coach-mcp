import { describe, expect, it } from "vitest";

import type { RunningWorkoutInput } from "@/lib/running/workoutInput";

import { formatCompactDuration, formatPaceRangeTarget, generateWorkoutText } from "./workoutText";

function baseInput(overrides: Partial<RunningWorkoutInput> = {}): RunningWorkoutInput {
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

describe("formatCompactDuration", () => {
  it("formats a whole number of minutes as Nm (12 min warmup)", () => {
    expect(formatCompactDuration(720)).toBe("12m");
  });

  it("formats a short duration under the seconds threshold as Ns (90 sec)", () => {
    expect(formatCompactDuration(90)).toBe("90s");
  });

  it("formats a mixed duration as AmBs (330 sec -> 5m30s)", () => {
    expect(formatCompactDuration(330)).toBe("5m30s");
  });
});

describe("formatPaceRangeTarget", () => {
  it("formats 275 as 4:35/km", () => {
    expect(formatPaceRangeTarget({ minSecondsPerKm: 275, maxSecondsPerKm: 285 })).toContain("4:35/km");
  });

  it("formats 285 as 4:45/km", () => {
    expect(formatPaceRangeTarget({ minSecondsPerKm: 275, maxSecondsPerKm: 285 })).toContain("4:45/km");
  });

  it("produces the full confirmed range + trailing Pace syntax, faster bound first", () => {
    expect(formatPaceRangeTarget({ minSecondsPerKm: 275, maxSecondsPerKm: 285 })).toBe("4:35/km-4:45/km Pace");
  });
});

describe("generateWorkoutText", () => {
  it("generates the verified example: warmup + 6x work/recovery with pace target + cooldown", () => {
    const text = generateWorkoutText(baseInput());

    expect(text).toBe(
      [
        "Warmup",
        "- 12m intensity=warmup",
        "",
        "6x",
        "- 90s 4:35/km-4:45/km Pace intensity=active",
        "- 90s intensity=rest",
        "",
        "Cooldown",
        "- 12m intensity=cooldown",
      ].join("\n")
    );
  });

  it("uses native Nx repeat syntax for repetitions > 1", () => {
    const text = generateWorkoutText(baseInput({ repetitions: 6 }));
    expect(text).toContain("6x\n");
  });

  it("omits the repeat header entirely when repetitions === 1", () => {
    const text = generateWorkoutText(baseInput({ repetitions: 1 }));
    expect(text).not.toMatch(/^\d+x$/m);
    expect(text).not.toContain("1x");
  });

  it("omits the pace target from the work line when none is provided", () => {
    const text = generateWorkoutText(baseInput({ paceTarget: undefined }));
    expect(text).toContain("- 90s intensity=active");
    expect(text).not.toContain("Pace");
  });

  it("omits the Warmup block entirely when warmupSeconds is 0", () => {
    const text = generateWorkoutText(baseInput({ warmupSeconds: 0 }));
    expect(text).not.toContain("Warmup");
  });

  it("omits the Cooldown block entirely when cooldownSeconds is 0", () => {
    const text = generateWorkoutText(baseInput({ cooldownSeconds: 0 }));
    expect(text).not.toContain("Cooldown");
  });

  it("omits the recovery line entirely when recoverySeconds is 0", () => {
    const text = generateWorkoutText(baseInput({ recoverySeconds: 0 }));
    expect(text).not.toContain("intensity=rest");
    expect(text).toContain("intensity=active");
  });

  it("produces a minimal single-line workout when warmup/cooldown/recovery are all 0 and repetitions is 1", () => {
    const text = generateWorkoutText(
      baseInput({ warmupSeconds: 0, cooldownSeconds: 0, recoverySeconds: 0, repetitions: 1, paceTarget: undefined })
    );

    expect(text).toBe("- 90s intensity=active");
  });

  it("never uses the unconfirmed intensity=interval/intensity=recovery tags", () => {
    const text = generateWorkoutText(baseInput());
    expect(text).not.toContain("intensity=interval");
    expect(text).not.toContain("intensity=recovery");
  });
});
