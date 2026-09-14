import { afterEach, describe, expect, it } from "vitest";

import { getAthleteTimeZone } from "./athleteTimeZone";

const ORIGINAL_ATHLETE_TIME_ZONE = process.env.ATHLETE_TIME_ZONE;

afterEach(() => {
  if (ORIGINAL_ATHLETE_TIME_ZONE === undefined) {
    delete process.env.ATHLETE_TIME_ZONE;
  } else {
    process.env.ATHLETE_TIME_ZONE = ORIGINAL_ATHLETE_TIME_ZONE;
  }
});

describe("getAthleteTimeZone", () => {
  it("defaults to Europe/Stockholm when unset", () => {
    delete process.env.ATHLETE_TIME_ZONE;

    expect(getAthleteTimeZone()).toBe("Europe/Stockholm");
  });

  it("defaults to Europe/Stockholm when set to an empty/whitespace string", () => {
    process.env.ATHLETE_TIME_ZONE = "   ";

    expect(getAthleteTimeZone()).toBe("Europe/Stockholm");
  });

  it("returns a configured valid IANA timezone", () => {
    process.env.ATHLETE_TIME_ZONE = "America/Los_Angeles";

    expect(getAthleteTimeZone()).toBe("America/Los_Angeles");
  });

  it("returns UTC when configured", () => {
    process.env.ATHLETE_TIME_ZONE = "UTC";

    expect(getAthleteTimeZone()).toBe("UTC");
  });

  it("trims surrounding whitespace around a configured timezone", () => {
    process.env.ATHLETE_TIME_ZONE = "  Europe/Stockholm  ";

    expect(getAthleteTimeZone()).toBe("Europe/Stockholm");
  });

  it("throws a clear, deterministic error for an invalid IANA timezone rather than silently falling back", () => {
    process.env.ATHLETE_TIME_ZONE = "Not/AZone";

    expect(() => getAthleteTimeZone()).toThrow(/Invalid ATHLETE_TIME_ZONE/);
    // Deterministic: repeated calls with the same bad config throw the same way.
    expect(() => getAthleteTimeZone()).toThrow(/Invalid ATHLETE_TIME_ZONE/);
  });
});
