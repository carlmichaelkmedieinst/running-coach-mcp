/**
 * Server-only credential handling for the Intervals.icu API.
 *
 * IMPORTANT: nothing in this file may be imported from client components.
 * It reads secrets from `process.env` and must never log or return the raw
 * API key or the resulting Authorization header value.
 */

const DEFAULT_ATHLETE_ID = "0";

/**
 * Reads the Intervals.icu API key from the server environment.
 *
 * Throws a helpful, credential-free error if it is not configured.
 */
export function getIntervalsApiKey(): string {
  const apiKey = process.env.INTERVALS_API_KEY;

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("Intervals.icu API key is not configured.");
  }

  return apiKey;
}

/**
 * Reads the configured Intervals.icu athlete id, defaulting to "0" (which
 * Intervals.icu treats as "the authenticated athlete") when unset.
 */
export function getIntervalsAthleteId(): string {
  const athleteId = process.env.INTERVALS_ATHLETE_ID;

  if (!athleteId || athleteId.trim().length === 0) {
    return DEFAULT_ATHLETE_ID;
  }

  return athleteId;
}

/**
 * Whether an Intervals.icu API key is present in the server environment.
 *
 * Safe to expose (as a boolean only) via non-secret endpoints like
 * `/api/health`.
 */
export function isIntervalsConfigured(): boolean {
  const apiKey = process.env.INTERVALS_API_KEY;
  return Boolean(apiKey && apiKey.trim().length > 0);
}

/**
 * Builds the `Authorization` header value for Intervals.icu's HTTP Basic
 * Auth scheme (username `API_KEY`, password = the personal API key).
 *
 * The returned value must never be logged.
 */
export function buildIntervalsAuthHeader(): string {
  const apiKey = getIntervalsApiKey();
  const credentials = Buffer.from(`API_KEY:${apiKey}`, "utf-8").toString("base64");
  return `Basic ${credentials}`;
}
