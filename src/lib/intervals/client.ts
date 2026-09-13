/**
 * Minimal, server-only HTTP client for the Intervals.icu API.
 *
 * Milestone 1 only needs GET support. The client is intentionally small: it
 * knows how to build authenticated, timed-out GET requests against the
 * Intervals.icu base URL and turn non-2xx responses into clean, credential
 * free errors. Higher-level modules (e.g. `activities.ts`) build on top of
 * this instead of calling `fetch` directly.
 *
 * V2 note: when write support is eventually needed (createWorkout,
 * updateWorkout, deleteWorkout), add sibling `postJson` / `putJson` /
 * `deleteResource` methods here rather than reworking this file's shape.
 * This client deliberately does not implement them yet.
 */

import { buildIntervalsAuthHeader } from "./auth";

export const INTERVALS_BASE_URL = "https://intervals.icu/api/v1";

/** Default request timeout, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Error thrown for any non-2xx response (or network/timeout failure) from
 * Intervals.icu. Messages are safe to surface to callers/MCP clients; they
 * never contain credentials.
 */
export class IntervalsApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "IntervalsApiError";
    this.status = status;
  }
}

function toErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Intervals.icu authentication failed.";
  }

  if (status === 429) {
    return "Intervals.icu rate limit reached. Please try again later.";
  }

  return `Intervals.icu request failed with status ${status}.`;
}

/**
 * Query parameter values accepted by {@link intervalsGet}. `undefined`
 * values are omitted from the request.
 */
export type IntervalsQueryParams = Record<string, string | number | boolean | undefined>;

function buildUrl(path: string, params?: IntervalsQueryParams): string {
  const url = new URL(`${INTERVALS_BASE_URL}${path}`);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

/**
 * Performs an authenticated GET request against the Intervals.icu API and
 * returns the parsed JSON body.
 *
 * - Adds HTTP Basic Auth (never logged).
 * - Disables caching (`cache: "no-store"`), since this data changes often
 *   and is per-athlete.
 * - Aborts the request after `timeoutMs` to avoid hanging MCP tool calls.
 * - Only GET is implemented in Milestone 1.
 */
export async function intervalsGet<T>(
  path: string,
  params?: IntervalsQueryParams,
  options?: { timeoutMs?: number }
): Promise<T> {
  const url = buildUrl(path, params);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Resolved outside the try/catch below so a missing-API-key error
  // surfaces with its own helpful message instead of being masked as a
  // generic network failure.
  const authHeader = buildIntervalsAuthHeader();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new IntervalsApiError("Intervals.icu request timed out.");
    }

    throw new IntervalsApiError("Intervals.icu request failed due to a network error.");
  }

  if (!response.ok) {
    throw new IntervalsApiError(toErrorMessage(response.status), response.status);
  }

  return (await response.json()) as T;
}
