import { describe, expect, it } from "vitest";

import { addDaysToDateOnly, isDateOnlyInRange, todayDateOnly } from "./dates";

describe("todayDateOnly", () => {
  it("returns the correct Europe/Stockholm local date shortly after local midnight, even though UTC is still the previous day", () => {
    // 2026-09-14T22:30:00Z = 2026-09-15T00:30 in Europe/Stockholm (UTC+2, DST in September).
    const instant = new Date("2026-09-14T22:30:00Z");

    expect(todayDateOnly("Europe/Stockholm", instant)).toBe("2026-09-15");
    // Sanity check: a naive UTC conversion (the bug we're fixing) gets this wrong.
    expect(instant.toISOString().slice(0, 10)).toBe("2026-09-14");
  });

  it("returns the correct local date for a negative-UTC-offset timezone, even though UTC has already rolled over", () => {
    // 2026-09-15T04:30:00Z = 2026-09-14T21:30 in America/Los_Angeles (UTC-7, PDT in September).
    const instant = new Date("2026-09-15T04:30:00Z");

    expect(todayDateOnly("America/Los_Angeles", instant)).toBe("2026-09-14");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-09-15");
  });

  it("matches the UTC calendar date when the timezone is UTC itself", () => {
    const instant = new Date("2026-09-14T22:30:00Z");

    expect(todayDateOnly("UTC", instant)).toBe("2026-09-14");
  });

  it("defaults to the current instant when no date argument is passed", () => {
    const result = todayDateOnly("UTC");

    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("throws deterministically (not silently falling back) for an invalid IANA timezone", () => {
    expect(() => todayDateOnly("Not/AZone")).toThrow();
    expect(() => todayDateOnly("Not/AZone")).toThrow();
  });
});

describe("addDaysToDateOnly", () => {
  it("subtracts days correctly", () => {
    expect(addDaysToDateOnly("2026-09-14", -14)).toBe("2026-08-31");
  });

  it("adds days correctly", () => {
    expect(addDaysToDateOnly("2026-08-31", 14)).toBe("2026-09-14");
  });

  it("handles month and year boundaries", () => {
    expect(addDaysToDateOnly("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysToDateOnly("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("is a no-op for deltaDays = 0", () => {
    expect(addDaysToDateOnly("2026-09-14", 0)).toBe("2026-09-14");
  });
});

describe("isDateOnlyInRange", () => {
  it("returns true for dates within the inclusive range, including both boundaries", () => {
    expect(isDateOnlyInRange("2026-09-05", "2026-09-01", "2026-09-14")).toBe(true);
    expect(isDateOnlyInRange("2026-09-01", "2026-09-01", "2026-09-14")).toBe(true);
    expect(isDateOnlyInRange("2026-09-14", "2026-09-01", "2026-09-14")).toBe(true);
  });

  it("returns false for dates outside the range", () => {
    expect(isDateOnlyInRange("2026-08-31", "2026-09-01", "2026-09-14")).toBe(false);
    expect(isDateOnlyInRange("2026-09-15", "2026-09-01", "2026-09-14")).toBe(false);
  });
});
