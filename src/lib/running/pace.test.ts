import { describe, expect, it } from "vitest";

import { calculatePaceSecondsPerKm, formatPace, metersToKm, paceSecondsPerKmFromSpeed } from "./pace";

describe("calculatePaceSecondsPerKm", () => {
  it("calculates pace from moving time and distance", () => {
    // 5km in 25 minutes (1500s) => 300s/km => 5:00/km
    expect(calculatePaceSecondsPerKm(1500, 5)).toBe(300);
  });

  it("returns null when distance is missing", () => {
    expect(calculatePaceSecondsPerKm(1500, null)).toBeNull();
  });

  it("returns null when moving time is missing", () => {
    expect(calculatePaceSecondsPerKm(undefined, 5)).toBeNull();
  });

  it("returns null when distance is zero", () => {
    expect(calculatePaceSecondsPerKm(1500, 0)).toBeNull();
  });

  it("returns null when moving time is zero", () => {
    expect(calculatePaceSecondsPerKm(0, 5)).toBeNull();
  });
});

describe("formatPace", () => {
  it("formats whole minutes correctly", () => {
    expect(formatPace(300)).toBe("5:00/km");
  });

  it("pads seconds under 10", () => {
    expect(formatPace(305)).toBe("5:05/km");
  });

  it("formats a realistic pace like 5:48/km", () => {
    expect(formatPace(348)).toBe("5:48/km");
  });

  it("rounds fractional seconds", () => {
    expect(formatPace(300.6)).toBe("5:01/km");
  });

  it("returns null for null input", () => {
    expect(formatPace(null)).toBeNull();
  });

  it("returns null for zero or negative pace", () => {
    expect(formatPace(0)).toBeNull();
    expect(formatPace(-10)).toBeNull();
  });
});

describe("metersToKm", () => {
  it("converts meters to kilometers", () => {
    expect(metersToKm(5000)).toBe(5);
  });

  it("returns null for missing input", () => {
    expect(metersToKm(null)).toBeNull();
    expect(metersToKm(undefined)).toBeNull();
  });
});

describe("paceSecondsPerKmFromSpeed", () => {
  it("converts a realistic running speed to pace", () => {
    // 1000 / 2.87 ≈ 348.4 s/km (~5:48/km)
    expect(paceSecondsPerKmFromSpeed(2.87)).toBeCloseTo(348.43, 1);
  });

  it("returns null for null/undefined input", () => {
    expect(paceSecondsPerKmFromSpeed(null)).toBeNull();
    expect(paceSecondsPerKmFromSpeed(undefined)).toBeNull();
  });

  it("returns null for zero or negative speed", () => {
    expect(paceSecondsPerKmFromSpeed(0)).toBeNull();
    expect(paceSecondsPerKmFromSpeed(-1.5)).toBeNull();
  });

  it("returns null for NaN or Infinity", () => {
    expect(paceSecondsPerKmFromSpeed(Number.NaN)).toBeNull();
    expect(paceSecondsPerKmFromSpeed(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("treats a near-stationary/paused sample (very low speed) as unknown pace", () => {
    // 0.05 m/s is a GPS-drift-while-stopped speed, not a real walking pace.
    expect(paceSecondsPerKmFromSpeed(0.05)).toBeNull();
  });

  it("treats an implausibly high speed (GPS spike) as unknown pace", () => {
    // 15 m/s (~2:13/km sustained) is not a realistic running speed.
    expect(paceSecondsPerKmFromSpeed(15)).toBeNull();
  });

  it("accepts speeds at the realistic boundary", () => {
    expect(paceSecondsPerKmFromSpeed(0.3)).not.toBeNull();
    expect(paceSecondsPerKmFromSpeed(8.5)).not.toBeNull();
  });
});
