# running-coach-mcp

A small, read-only [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects an AI client to a personal [Intervals.icu](https://intervals.icu) account.

- **Milestone 1** exposed a single tool, `get_recent_runs`, returning the athlete's most recent running activities as clean, normalized JSON.
- **Milestone 2B** protected `/api/mcp` with standards-compliant OAuth via [WorkOS AuthKit](https://workos.com/authkit), so the endpoint can be safely exposed on the public internet (e.g. on Vercel) while remaining accessible to exactly one person.
- **Milestone 3A** adds two more read-only tools, `get_run_details` and `get_run_streams`, so an AI client can drill into a single run's detected intervals and time-series data (pace, heart rate, cadence, power, elevation) for real analysis — "did I fade in the last interval?", "how did my heart rate develop?", etc.
- **Milestone 3B** (this milestone) adds `get_wellness`, exposing daily recovery/physiological data (resting heart rate, HRV, sleep, weight, VO2 max, CTL/ATL training load) — athlete-level, not tied to any single activity.

The server remains strictly **read-only**.

## Architecture

```
Garmin  →  Garmin Connect  →  Intervals.icu  →  running-coach-mcp  →  WorkOS OAuth protected MCP  →  ChatGPT
```

- **Garmin / Garmin Connect** — the athlete's watch and activity sync source.
- **Intervals.icu** — source of truth for activity data, synced from Garmin. Accessed read-only via HTTP Basic Auth with a personal API key.
- **running-coach-mcp** (this app, `src/lib/intervals/*`) — a small server-only client and domain layer that fetches raw activities, activity detail + intervals, time-series streams, and daily wellness data, and converts each into our own normalized models (`src/types/activity.ts`, `src/types/interval.ts`, `src/types/stream.ts`, `src/types/wellness.ts`). MCP code never touches the raw Intervals.icu response shape directly.
- **WorkOS OAuth protected MCP** (`src/app/api/mcp/route.ts` + `src/lib/auth/*`) — exposes the domain layer as MCP tools over Streamable HTTP via [`mcp-handler`](https://www.npmjs.com/package/mcp-handler), gated behind OAuth bearer-token verification.
- **ChatGPT** (or any MCP-compatible client — Claude Desktop, Cursor, MCP Inspector, etc.) — calls `get_recent_runs`, `get_run_details`, `get_run_streams`, and `get_wellness` after completing the OAuth flow against WorkOS.

### OAuth roles

- **WorkOS AuthKit is the OAuth *Authorization Server***. It authenticates the user and issues access tokens. This app never issues tokens itself and never runs its own authorization server.
- **running-coach-mcp is the OAuth *Resource Server***. It cryptographically verifies WorkOS-issued access tokens (signature + issuer + audience, via JWKS) before allowing a request to reach any tool (`get_recent_runs`, `get_run_details`, `get_run_streams`, `get_wellness`). The check wraps the whole `/api/mcp` handler, so every tool registered on it — including future ones — inherits the same protection automatically.
- **Intervals.icu credentials remain completely separate and server-only.** The Intervals.icu API key is never sent to, derived from, or exposed via WorkOS/MCP — the two auth systems never mix, and WorkOS tokens are never forwarded to Intervals.icu.
- **Access is currently limited to a single WorkOS user.** After a token is verified, its `sub` claim is compared against `MCP_ALLOWED_USER_ID`. Any other (even otherwise valid) user is rejected with `403`. If `MCP_ALLOWED_USER_ID` isn't configured, the server fails closed and allows no one.

```
src/
  app/
    .well-known/
      oauth-protected-resource/route.ts     # RFC 9728 metadata for /api/mcp (resource, authorization_servers, ...)
      oauth-authorization-server/route.ts   # RFC 8414 metadata, proxied from WorkOS for clients that probe the MCP host directly
    api/
      health/route.ts    # GET /api/health — PUBLIC liveness + config check (no secrets, no upstream calls)
      mcp/route.ts        # MCP endpoint (Streamable HTTP), OAuth-protected — registers all four tools
    page.tsx              # minimal info page (no UI framework needed)

  lib/
    auth/
      config.ts             # reads/validates WORKOS_AUTHKIT_DOMAIN / MCP_RESOURCE_URL / MCP_ALLOWED_USER_ID
      verifyAccessToken.ts   # cryptographic JWT verification against WorkOS JWKS (jose), issuer + audience checks
      mcpAuth.ts             # withMcpAuth wiring + single-user (sub) authorization -> 401 / 403
    intervals/
      auth.ts               # reads INTERVALS_API_KEY / INTERVALS_ATHLETE_ID, builds Basic Auth header
      client.ts             # server-only fetch wrapper (GET only, timeout, no-store, error mapping)
      activities.ts         # domain layer: getRecentRuns() — fetch, filter, sort, limit
      activityDetails.ts    # domain layer: getRunDetails() — activity + intervals, running-type check
      streams.ts            # domain layer: getRunStreams() — full stream fetch + downsampling
      wellness.ts            # domain layer: getWellness() — daily wellness fetch + latest/latest-non-null summary
      normalizers.ts        # raw Intervals.icu activity shapes -> RunningActivity / RunningInterval / stream point models
      wellnessNormalizers.ts # raw Intervals.icu wellness shape -> DailyWellness model
    running/
      pace.ts             # pure pace/speed calculation + formatting helpers
      downsample.ts       # pure, deterministic bucket-sampling helper (no randomness)

  types/
    activity.ts          # IntervalsActivity (raw) and RunningActivity / RunningActivityDetail (our models)
    interval.ts           # IntervalsInterval (raw) and RunningInterval (our model)
    stream.ts             # IntervalsStream (raw) and RunningStreamPoint / RunningStreamsResult (our models)
    wellness.ts            # IntervalsWellnessEntry (raw) and DailyWellness / WellnessResult (our models)
```

The `IntervalsClient` layer is structured so future methods (`getCalendar`, and eventually write operations) can be added without reshaping what's already here — see the comments in `src/lib/intervals/client.ts`. None of those are implemented yet.

## Environment variables

| Variable | Description |
| --- | --- |
| `INTERVALS_API_KEY` | Your personal Intervals.icu API key. Required. Never sent to the browser or logged. |
| `INTERVALS_ATHLETE_ID` | Your Intervals.icu athlete id. Defaults to `"0"` (the authenticated athlete) if omitted. |
| `WORKOS_AUTHKIT_DOMAIN` | Your WorkOS AuthKit domain, e.g. `https://neat-comic-70-staging.authkit.app`. Acts as the OAuth Authorization Server and JWKS source (`<domain>/oauth2/jwks`). |
| `MCP_RESOURCE_URL` | The full MCP resource URL, e.g. `https://running-coach-mcp.vercel.app/api/mcp`. Must exactly match the Resource Indicator configured in WorkOS — it's both the expected token `audience` and the `resource` value in the protected resource metadata. |
| `MCP_ALLOWED_USER_ID` | The single WorkOS user id (`sub` claim, starts with `user_`) allowed to use this server. If unset, **no one** is authorized (fail closed). |

See `.env.example` for a template with empty values — never commit real secrets or the real allowed user id.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` (see `.env.example`):

   ```bash
   INTERVALS_API_KEY=<your personal Intervals API key>
   INTERVALS_ATHLETE_ID=0
   WORKOS_AUTHKIT_DOMAIN=https://neat-comic-70-staging.authkit.app
   MCP_RESOURCE_URL=http://localhost:3000/api/mcp
   MCP_ALLOWED_USER_ID=<your WorkOS user id>
   ```

   Get your Intervals.icu API key under **Settings → Developer Settings**. For local testing, `MCP_RESOURCE_URL` should point at your local server; in production it must match the deployed `/api/mcp` URL exactly (see below).

3. Run the dev server:

   ```bash
   npm run dev
   ```

- MCP endpoint: `http://localhost:3000/api/mcp`
- Health check (public, no auth): `http://localhost:3000/api/health`
- Protected resource metadata: `http://localhost:3000/.well-known/oauth-protected-resource`
- Authorization server metadata (proxied): `http://localhost:3000/.well-known/oauth-authorization-server`

## Production endpoints

- MCP endpoint: `https://running-coach-mcp.vercel.app/api/mcp`
- Protected resource metadata: `https://running-coach-mcp.vercel.app/.well-known/oauth-protected-resource`
- Authorization server metadata: `https://running-coach-mcp.vercel.app/.well-known/oauth-authorization-server`

## Testing with MCP Inspector

Calling `/api/mcp` now requires a valid WorkOS access token (see [Auth architecture](#oauth-roles) above), so a plain `npx @modelcontextprotocol/inspector <url>` connection will get a `401` until it completes the OAuth flow.

With the dev server running, in another terminal:

```bash
npx @modelcontextprotocol/inspector
```

This opens the Inspector UI in your browser. Connect with:

- **Transport**: `Streamable HTTP`
- **URL**: `http://localhost:3000/api/mcp` (or the production URL above)

Inspector supports the standard OAuth discovery flow: it will read `/.well-known/oauth-protected-resource`, follow the `authorization_servers` entry to WorkOS, and prompt you to sign in. Once authenticated as the allow-listed user, open the **Tools** tab, select a tool, and call it to see the result as JSON.

## Tools

All four tools are read-only, require the same WorkOS OAuth bearer token, and never expose Intervals.icu credentials or raw upstream payloads.

### `get_recent_runs`

Unchanged since Milestone 1:

- **limit** (optional integer, 1–20, default 5) — max number of runs to return.
- **days** (optional integer, 7–365, default 90) — how far back to search.

It fetches up to 100 recent activities from Intervals.icu within the date window, filters to running types (`Run`, `TrailRun`, `VirtualRun`), sorts newest first, and returns up to `limit` normalized runs. If fewer runs exist in the window, it returns whatever is available.

> Example prompt: *"Show my five latest runs."*

### `get_run_details`

Fetches one activity (`GET /activity/{id}`) plus its detected intervals/laps (`GET /activity/{id}/intervals`), and returns a single normalized object: summary metrics (distance, pace, heart rate, cadence, power, elevation, training load/intensity/fitness/fatigue, RPE/feel, decoupling), which streams are available (`availableStreams`), and every detected interval (each with its own pace, heart rate, cadence, power, elevation gain, grade-adjusted pace, and decoupling). It never includes raw time-series streams, to keep the response small.

- **activityId** (required string) — an Intervals.icu activity id, e.g. `"i186254951"` (as returned by `get_recent_runs`).

Only `Run`, `TrailRun`, and `VirtualRun` activities are accepted; anything else is rejected with `"Activity is not a running activity."`. An unknown id is rejected with `"Running activity not found."`.

> Example prompt: *"Analyze my latest run."*

### `get_run_streams`

Fetches the full time-series stream set for one activity (`GET /activity/{id}/streams.json`) and returns a normalized, size-bounded sample: elapsed time, distance, pace, heart rate, cadence, power, and altitude per point, plus which stream types were actually available.

- **activityId** (required string) — an Intervals.icu activity id.
- **maxPoints** (optional integer, 100–1000, default 600) — maximum number of points to return.

**Raw activity streams are always normalized and downsampled before being sent through MCP.** Intervals.icu records at up to 1Hz, so a one-hour run can have 3,000+ raw samples per stream — far too much to return through an MCP tool response. `getRunStreams` fetches the full raw dataset server-side, converts it into one array of per-instant points in our own shape (deriving pace from the `velocity_smooth`/`speed` stream, since Intervals.icu has no dedicated pace stream), and — only if the activity has more than `maxPoints` samples — reduces it to exactly `maxPoints` points using deterministic "nearest index" bucket sampling (`src/lib/running/downsample.ts`). This always keeps the first and last recorded instant and evenly spans the rest, so overall shape and short efforts are preserved reasonably well without any randomness. Activities with `<= maxPoints` samples are returned in full, unsampled. The response also reports `originalPointCount`, `returnedPointCount`, and the effective `samplingIntervalSeconds` so a client knows how much detail survived.

Speed-to-pace conversion (`paceSecondsPerKmFromSpeed` in `src/lib/running/pace.ts`) guards against zero/negative/non-finite speed, near-stationary samples (pauses/GPS drift while stopped), and unrealistically high speed (GPS spikes) — all of those return `null` pace for that point rather than a nonsensical value.

> Example prompts:
> - *"How did my heart rate develop during my latest interval session?"*
> - *"Did I fade during the final intervals?"*

### `get_wellness`

Fetches daily wellness/recovery data (`GET /athlete/{id}/wellness.json`) for a date range and returns it newest-first, along with the most recent value of each sparse metric. Wellness is **athlete-level, per calendar day** — it is never attached to a specific activity.

- **days** (optional integer, 7–365, default 30) — how many days back to fetch.

Response shape:

```json
{
  "daysRequested": 30,
  "entriesReturned": 15,
  "latest": { "date": "...", "restingHeartRate": 56, "hrv": 49, "sleepSeconds": 24300, "sleepScore": 49, "sleepQuality": 4, "weightKg": null, "vo2Max": null, "fitnessCtl": 4.66, "fatigueAtl": 14.26 },
  "latestNonNull": {
    "restingHeartRate": { "value": 56, "date": "..." },
    "hrv": { "value": 49, "date": "..." },
    "sleepSeconds": { "value": 24300, "date": "..." },
    "sleepScore": { "value": 49, "date": "..." },
    "sleepQuality": { "value": 4, "date": "..." },
    "weightKg": { "value": 88, "date": "..." },
    "vo2Max": { "value": 47, "date": "..." }
  },
  "days": [ /* newest first, one entry per day Intervals.icu has data for */ ]
}
```

`entriesReturned` is often smaller than `daysRequested`: Intervals.icu only returns a row for days it actually has *some* wellness data for, and most individual fields are sparse on top of that (they depend entirely on what Garmin happened to sync that day). `latest` is the most recent day exactly as recorded (its fields may be `null`); `latestNonNull` separately answers "what was the last known value of X", which is almost always the more useful question for a sparse metric like VO2 max or weight — e.g. the newest day might have `vo2Max: null` while `latestNonNull.vo2Max` correctly points to an actual value from a few days earlier.

**Fields, units, and provenance (all confirmed via live read-only discovery against a real account — nothing here is guessed or invented):**

| Field | Unit | Notes |
| --- | --- | --- |
| `restingHeartRate` | beats per minute | Raw field `restingHR`. |
| `hrv` | milliseconds | Raw field `hrv`, as reported by Intervals.icu. |
| `sleepSeconds` | seconds | Raw field `sleepSecs`. |
| `sleepScore` | ~0–100 | Raw field `sleepScore` (Garmin sleep score). |
| `sleepQuality` | provider-defined numeric value | Raw field `sleepQuality`. Intervals.icu does not publicly document its scale, so this is passed through as-is rather than assumed to be e.g. "1-5" or "1-10". |
| `weightKg` | kilograms | Raw field `weight`. Assumed kg based on the athlete's metric unit preference (`weight_pref_lb: false`); very sparse (rarely synced). |
| `vo2Max` | ml/kg/min | Raw field `vo2max`. **An estimated physiological metric synced from Garmin via Intervals.icu wellness data — not a lab-measured VO2 max.** Sparse: only updates periodically, `null` on most days. |
| `fitnessCtl` | unitless (CTL) | Raw field `ctl` (Chronic Training Load) — a training-load model value, tracked per calendar day. Same underlying CTL concept as `RunningActivity.fitness`, just at daily rather than per-activity granularity. Named `fitnessCtl` rather than plain `fitness` for clarity and consistency with `fatigueAtl` below. |
| `fatigueAtl` | unitless (ATL) | Raw field `atl` (Acute Training Load) — a training-load model value, tracked per calendar day. **Deliberately not named plain `fatigue`**: Intervals.icu's wellness data has a *separate* subjective `fatigue` field (a self-reported rating, always `null` for this account) that is unrelated to ATL — reusing "fatigue" for both would be ambiguous. |

Fields Intervals.icu's wellness schema exposes but that were confirmed **always `null`** for a Garmin-only account (and are therefore *not* modeled): `readiness`, `fatigue` (the subjective self-report, distinct from `atl`/`fatigueAtl`), `hrvSDNN`, `mood`, `motivation`, `soreness`, `stress`, `spO2`, `respiration`, `bodyFat`, `hydration`, `baevskySI`, `bloodGlucose`, `menstrualPhase`, `avgSleepingHR`, `kcalConsumed`. If a future Garmin device or data source starts populating any of these, they can be added the same way.

VO2 max is never attached to individual runs — it only appears here, in `get_wellness`.

> Example prompts:
> - *"Show my latest VO2 max."*
> - *"How has my VO2 max changed over the last month?"*
> - *"How is my recovery looking?"*
> - *"Compare my recent sleep and HRV with my running load."*

## Quality checks

```bash
npm run lint     # ESLint
npx tsc --noEmit # TypeScript type checking
npm run test     # unit tests (vitest)
npm run build    # production build
```

## Milestone status

**Milestone 1** was strictly read-only with no auth. **Milestone 2B** added WorkOS OAuth protection in front of the same read-only tool. **Milestone 3A** added two more read-only tools — `get_run_details` and `get_run_streams` — for per-activity analysis. **Milestone 3B** (this milestone) adds `get_wellness` for daily recovery/physiological data (including VO2 max), inheriting the same OAuth protection unchanged. Still no database, no calendar, no automatic coaching logic, and no write operations (no `POST`/`PUT`/`PATCH`/`DELETE` calls to Intervals.icu). VO2 max is never calculated by this project — it's read verbatim from Intervals.icu's `vo2max` wellness field, which itself comes from Garmin.

Future milestones will build on this foundation to add:

- Calendar / planned workouts (`getCalendar`)
- Deeper training analytics (e.g. cross-activity trends, correlating wellness trends with training load)
- Eventually, workout creation/editing (`createWorkout`, `updateWorkout`, `deleteWorkout`) — write access, with stronger safeguards

## Notes / assumptions

- Never commit `.env.local` or any file containing a real API key, WorkOS domain secret, or your real WorkOS user id (`.env*` is git-ignored; `.env.example` is explicitly un-ignored so the template can be committed).
- `/api/health` is intentionally public and never requires OAuth; it only reports whether config *exists*, never secret values.

### Design assumptions (Milestone 3A)

- Intervals.icu's raw `pace`, `gap`, and `average_speed` fields (activity- and interval-level) are all meters/second-scaled, not seconds/km — confirmed against real data. We never treat them as pace directly; pace is always computed from distance ÷ moving time, and `gap` is separately converted from its raw speed value.
- A stream sample is only converted to a pace when its speed is between 0.3 m/s (~55 min/km — below this we assume "stopped/paused") and 8.5 m/s (~2:00/km — above this we assume a GPS/sensor spike). Outside that range, `pace` is `null` for that point rather than a nonsensical value.
- `getRunStreams`'s point count is driven by whichever available stream is longest (not strictly the `time` stream), so a missing `time` stream doesn't discard other available data.
- A 404 from Intervals.icu's `/activity/{id}/intervals` endpoint is treated as "no intervals detected" (empty array) rather than an error, since not every activity has analyzed intervals.
- Downsampling (`src/lib/running/downsample.ts`) uses simple deterministic "nearest index" bucket sampling, as explicitly permitted for this milestone — not a min/max-preserving or interval-aware algorithm.

### Design assumptions (Milestone 3B)

- VO2 max (`vo2max`) was confirmed, via live read-only discovery against a real account, to exist **only** in Intervals.icu's wellness data (`/athlete/{id}/wellness.json`) — it is **not** present in activity list or activity detail responses, at all. That's why it lives exclusively on `get_wellness` and is never attached to `get_recent_runs`/`get_run_details`.
- `weightKg` is assumed to already be in kilograms because the athlete's profile has `weight_pref_lb: false` (metric preference); this project does not perform any unit conversion on it.
- `entriesReturned` can be well below `daysRequested` because Intervals.icu only returns a wellness row for a day at all if it has *some* data for that day — sparsity happens at both the day level and the individual-field level.
