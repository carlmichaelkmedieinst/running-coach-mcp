import { describe, expect, it } from "vitest";

import { calculatePaceSecondsPerKm, formatPace, metersToKm } from "./pace";

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
