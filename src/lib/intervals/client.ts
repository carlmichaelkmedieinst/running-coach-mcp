/**
 * Minimal, server-only HTTP client for the Intervals.icu API.
 *
 * Milestone 1 only needed GET support. Milestone 3E adds `intervalsPost` /
 * `intervalsPut` / `intervalsDelete` (the sibling write methods this
 * module's original doc comment anticipated) for planned-workout
 * create/update/delete. The client remains intentionally small: it knows
 * how to build authenticated, timed-out requests against the Intervals.icu
 * base URL and turn non-2xx responses (or a malformed JSON body) into
 * clean, credential-free errors. Higher-level modules (e.g.
 * `activities.ts`, `workouts.ts`) build on top of this instead of calling
 * `fetch` directly.
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
 * Parses a response body as JSON, tolerating an empty body (some
 * Intervals.icu write responses return `200`/`204` with nothing to parse)
 * and turning genuinely malformed JSON into a clean `IntervalsApiError`
 * instead of letting a raw `SyntaxError` escape to callers/MCP clients.
 */
async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (text.length === 0) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new IntervalsApiError("Intervals.icu returned a malformed response.");
  }
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

  return parseJsonResponse<T>(response);
}

/**
 * Performs an authenticated `POST`/`PUT` request with a JSON body against
 * the Intervals.icu API and returns the parsed JSON response. Shared by
 * {@link intervalsPost} and {@link intervalsPut} — the only difference
 * between the two is the HTTP method.
 */
async function sendJson<T>(
  method: "POST" | "PUT",
  path: string,
  body: unknown,
  options?: { timeoutMs?: number }
): Promise<T> {
  const url = buildUrl(path);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Resolved outside the try/catch below, same reasoning as `intervalsGet`.
  const authHeader = buildIntervalsAuthHeader();

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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

  return parseJsonResponse<T>(response);
}

/**
 * Performs an authenticated `POST` request with a JSON body against the
 * Intervals.icu API and returns the parsed JSON response (e.g. the created
 * event). Added in Milestone 3E for planned-workout creation.
 */
export async function intervalsPost<T>(
  path: string,
  body: unknown,
  options?: { timeoutMs?: number }
): Promise<T> {
  return sendJson<T>("POST", path, body, options);
}

/**
 * Performs an authenticated `PUT` request with a JSON body against the
 * Intervals.icu API and returns the parsed JSON response (e.g. the updated
 * event). Added in Milestone 3E for planned-workout updates.
 */
export async function intervalsPut<T>(
  path: string,
  body: unknown,
  options?: { timeoutMs?: number }
): Promise<T> {
  return sendJson<T>("PUT", path, body, options);
}

/**
 * Performs an authenticated `DELETE` request against the Intervals.icu
 * API. Added in Milestone 3E for planned-workout deletion.
 *
 * Deliberately returns `void` rather than a parsed body: Intervals.icu may
 * respond `204 No Content` (no body to parse at all) or `200` with a body
 * callers of `intervalsDelete` don't need — the caller already knows which
 * event it asked to delete.
 */
export async function intervalsDelete(path: string, options?: { timeoutMs?: number }): Promise<void> {
  const url = buildUrl(path);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const authHeader = buildIntervalsAuthHeader();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "DELETE",
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

  // 204/empty responses are the expected success case; nothing to parse.
}
