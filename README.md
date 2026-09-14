# running-coach-mcp

A small [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects an AI client to a personal [Intervals.icu](https://intervals.icu) account.

- **Milestone 1** exposed a single tool, `get_recent_runs`, returning the athlete's most recent running activities as clean, normalized JSON.
- **Milestone 2B** protected `/api/mcp` with standards-compliant OAuth via [WorkOS AuthKit](https://workos.com/authkit), so the endpoint can be safely exposed on the public internet (e.g. on Vercel) while remaining accessible to exactly one person.
- **Milestone 3A** adds two more read-only tools, `get_run_details` and `get_run_streams`, so an AI client can drill into a single run's detected intervals and time-series data (pace, heart rate, cadence, power, elevation) for real analysis — "did I fade in the last interval?", "how did my heart rate develop?", etc.
- **Milestone 3B** adds `get_wellness`, exposing daily recovery/physiological data (resting heart rate, HRV, sleep, weight, VO2 max, CTL/ATL training load) — athlete-level, not tied to any single activity.
- **Milestone 3C** adds `get_running_progress`, descriptive weekly-volume/pace/heart-rate/training-load/VO2 max trend analysis with recent-vs-previous period comparisons — built cheaply from the existing activity list and wellness data, with no per-run detail or stream fetches.
- **Milestone 3D** adds `get_calendar`, exposing recent and upcoming calendar events / planned workouts from Intervals.icu — including the next planned running workout — so an AI client can answer "what's on my schedule?" questions. Still strictly read-only.
- **Milestone 3E** (this milestone) adds the server's first **write** tools — `create_running_workout`, `update_running_workout`, `delete_running_workout` — so an AI client can schedule, change, or remove a planned running workout on the athlete's Intervals.icu calendar, when the user explicitly asks it to. Writes use Intervals.icu's own native workout-builder **text** syntax (placed in the event `description`); Intervals.icu itself compiles that text into a structured, device-syncable workout. This project **never** constructs or sends `workout_doc` directly — see [Writing workouts: why text, not `workout_doc`](#writing-workouts-why-text-not-workout_doc) below.

Six tools (`get_recent_runs`, `get_run_details`, `get_run_streams`, `get_wellness`, `get_running_progress`, `get_calendar`) remain strictly **read-only**. Three tools (`create_running_workout`, `update_running_workout`, `delete_running_workout`) are **write** tools that modify the athlete's Intervals.icu calendar — see [Write tools](#write-tools) below for exactly what they do and the safeguards around them.

## Architecture

```
Garmin  →  Garmin Connect  →  Intervals.icu  →  running-coach-mcp  →  WorkOS OAuth protected MCP  →  ChatGPT
```

- **Garmin / Garmin Connect** — the athlete's watch and activity sync source.
- **Intervals.icu** — source of truth for activity data, synced from Garmin. Accessed read-only via HTTP Basic Auth with a personal API key.
- **running-coach-mcp** (this app, `src/lib/intervals/*`) — a small server-only client and domain layer that fetches raw activities, activity detail + intervals, time-series streams, daily wellness data, and calendar events / planned workouts, and converts each into our own normalized models (`src/types/activity.ts`, `src/types/interval.ts`, `src/types/stream.ts`, `src/types/wellness.ts`, `src/types/calendarEvent.ts`). `src/lib/intervals/progress.ts` builds descriptive trend analysis (`src/types/progress.ts`) on top of the same activity list + wellness data — no extra upstream endpoints, no per-run detail/stream fetches. `src/lib/intervals/workouts.ts` (Milestone 3E) adds the write side: create/update/delete a planned running workout, generating native Intervals.icu workout-builder text (`src/lib/running/workoutText.ts`) from a validated input model (`src/lib/running/workoutInput.ts`) rather than ever building `workout_doc` itself. MCP code never touches the raw Intervals.icu response shape directly.
- **WorkOS OAuth protected MCP** (`src/app/api/mcp/route.ts` + `src/lib/auth/*`) — exposes the domain layer as MCP tools over Streamable HTTP via [`mcp-handler`](https://www.npmjs.com/package/mcp-handler), gated behind OAuth bearer-token verification.
- **ChatGPT** (or any MCP-compatible client — Claude Desktop, Cursor, MCP Inspector, etc.) — calls the six read tools plus, when the user explicitly authorizes it, the three write tools (`create_running_workout`, `update_running_workout`, `delete_running_workout`) — after completing the OAuth flow against WorkOS.

### OAuth roles

- **WorkOS AuthKit is the OAuth *Authorization Server***. It authenticates the user and issues access tokens. This app never issues tokens itself and never runs its own authorization server.
- **running-coach-mcp is the OAuth *Resource Server***. It cryptographically verifies WorkOS-issued access tokens (signature + issuer + audience, via JWKS) before allowing a request to reach any tool — all nine of them, read and write alike. The check wraps the whole `/api/mcp` handler, so every tool registered on it — including future ones — inherits the same protection automatically. OAuth authenticates *who* is calling; it is not what decides whether a given write is authorized — see [Write tools](#write-tools) for that.
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
      mcp/route.ts        # MCP endpoint (Streamable HTTP), OAuth-protected — registers all nine tools (6 read + 3 write)
    page.tsx              # minimal info page (no UI framework needed)

  lib/
    auth/
      config.ts             # reads/validates WORKOS_AUTHKIT_DOMAIN / MCP_RESOURCE_URL / MCP_ALLOWED_USER_ID
      verifyAccessToken.ts   # cryptographic JWT verification against WorkOS JWKS (jose), issuer + audience checks
      mcpAuth.ts             # withMcpAuth wiring + single-user (sub) authorization -> 401 / 403
    intervals/
      auth.ts               # reads INTERVALS_API_KEY / INTERVALS_ATHLETE_ID, builds Basic Auth header
      client.ts             # server-only fetch wrapper (GET + POST/PUT/DELETE, timeout, no-store, error + malformed-response mapping)
      activities.ts         # domain layer: getRunningActivitiesInRange() + getRecentRuns() — fetch, filter, sort, (optionally) limit
      activityDetails.ts    # domain layer: getRunDetails() — activity + intervals, running-type check
      streams.ts            # domain layer: getRunStreams() — full stream fetch + downsampling
      wellness.ts            # domain layer: getWellness() — daily wellness fetch + latest/latest-non-null summary
      progress.ts            # domain layer: getRunningProgress() — trend analysis, built on activities.ts + wellness.ts (no new upstream calls)
      calendar.ts            # domain layer: getCalendar() — calendar events/planned workouts fetch, normalize, classify, sort, next-planned-workout selection
      workouts.ts            # domain layer (Milestone 3E, WRITE): createRunningWorkout() / updateRunningWorkout() / deleteRunningWorkout() — text generation, fetch-before-write safety checks, POST/PUT/DELETE
      normalizers.ts        # raw Intervals.icu activity shapes -> RunningActivity / RunningInterval / stream point models
      wellnessNormalizers.ts # raw Intervals.icu wellness shape -> DailyWellness model
      calendarEventNormalizers.ts # raw Intervals.icu event shape -> CalendarEvent model, incl. planned-workout classification
    running/
      pace.ts             # pure pace/speed calculation + formatting helpers
      downsample.ts       # pure, deterministic bucket-sampling helper (no randomness)
      dates.ts            # pure, timezone-aware date-only helpers (todayDateOnly, addDaysToDateOnly, isDateOnlyInRange, isValidDateOnly), shared by activities/wellness/progress/calendar/workouts
      athleteTimeZone.ts  # reads + validates ATHLETE_TIME_ZONE (defaults to Europe/Stockholm)
      progressAggregation.ts # pure aggregation rules for progress analysis (pace/HR weighting, weekly buckets, HR bands, VO2 trend, comparisons)
      workoutInput.ts      # Milestone 3E: RunningWorkoutInput zod schema + bounds — single source of truth, reused as both domain validation AND the MCP tool inputSchema
      workoutText.ts       # Milestone 3E: pure RunningWorkoutInput -> native Intervals.icu workout-builder TEXT generator (never workout_doc)

  types/
    activity.ts          # IntervalsActivity (raw) and RunningActivity / RunningActivityDetail (our models)
    interval.ts           # IntervalsInterval (raw) and RunningInterval (our model)
    stream.ts             # IntervalsStream (raw) and RunningStreamPoint / RunningStreamsResult (our models)
    wellness.ts            # IntervalsWellnessEntry (raw) and DailyWellness / WellnessResult (our models)
    progress.ts            # normalized RunningProgressResult and its nested types (no raw upstream shape here)
    calendarEvent.ts        # IntervalsEvent/IntervalsWorkoutDoc (raw) and CalendarEvent / CalendarResult / CalendarEventWorkout (our models)
```

## Environment variables

| Variable | Description |
| --- | --- |
| `INTERVALS_API_KEY` | Your personal Intervals.icu API key. Required. Never sent to the browser or logged. |
| `INTERVALS_ATHLETE_ID` | Your Intervals.icu athlete id. Defaults to `"0"` (the authenticated athlete) if omitted. |
| `WORKOS_AUTHKIT_DOMAIN` | Your WorkOS AuthKit domain, e.g. `https://neat-comic-70-staging.authkit.app`. Acts as the OAuth Authorization Server and JWKS source (`<domain>/oauth2/jwks`). |
| `MCP_RESOURCE_URL` | The full MCP resource URL, e.g. `https://running-coach-mcp.vercel.app/api/mcp`. Must exactly match the Resource Indicator configured in WorkOS — it's both the expected token `audience` and the `resource` value in the protected resource metadata. |
| `MCP_ALLOWED_USER_ID` | The single WorkOS user id (`sub` claim, starts with `user_`) allowed to use this server. If unset, **no one** is authorized (fail closed). |
| `ATHLETE_TIME_ZONE` | IANA timezone (e.g. `Europe/Stockholm`, `America/Los_Angeles`, `UTC`) used **only** to compute the athlete's local calendar-day boundaries for `get_recent_runs`, `get_wellness`, and `get_running_progress` — i.e. what counts as "today" and how many days back a window spans. Defaults to `Europe/Stockholm` if unset. An invalid value throws a clear configuration error rather than silently falling back to UTC or the server's own timezone. This project is currently single-user; a future multi-user architecture will need this to become a per-athlete setting instead of one process-wide value. |

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

All nine tools require the same WorkOS OAuth bearer token and never expose Intervals.icu credentials or raw upstream payloads.

### Read tools

`get_recent_runs`, `get_run_details`, `get_run_streams`, `get_wellness`, `get_running_progress`, and `get_calendar` are strictly **read-only** — none of them can create, modify, or delete anything in Intervals.icu.

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

### `get_running_progress`

Analyzes running progress and trends over time: weekly volume, aggregate pace, heart rate, training load, VO2 max, and a recent-vs-previous period comparison. **This tool is descriptive, not predictive** — it returns numbers derived directly from your activity list and wellness data; it does not calculate VO2 max itself, does not estimate lactate threshold or cardiac drift, does not claim physiological training zones, does not compute a proprietary "fitness score", and does not predict race times. Interpreting what the numbers mean is left to the AI client.

It is also deliberately **cheap**: it reuses the same activity-list fetch as `get_recent_runs` (via a shared `getRunningActivitiesInRange` helper) and the same wellness fetch as `get_wellness` — exactly one activities request and one wellness request per call, never a per-run detail or stream fetch.

- **days** (optional integer, 14–365, default 90) — overall analysis window.
- **comparisonDays** (optional integer, 7–56, default 14) — length of the recent/previous comparison windows. `recentPeriod` is the last `comparisonDays` calendar days; `previousPeriod` is the `comparisonDays` days immediately before that.

Response shape:

```json
{
  "daysRequested": 90,
  "comparisonDays": 14,
  "period": { "startDate": "...", "endDate": "...", "runCount": 6, "distanceKm": 47.25, "movingTimeSeconds": 16935, "trainingLoad": 297, "averagePaceSecondsPerKm": 358.4, "averagePace": "5:58/km", "averageHeartRate": 152.0 },
  "recentPeriod": { "...": "same shape, last 14 days" },
  "previousPeriod": { "...": "same shape, the 14 days before that" },
  "comparison": {
    "distanceChangeKm": 28.3,
    "distanceChangePercent": 300.0,
    "runCountChange": 4,
    "movingTimeChangeSeconds": 10563,
    "trainingLoadChange": 163,
    "paceChangeSecondsPerKm": 26.6,
    "averageHeartRateChange": -9.8
  },
  "weekly": [ { "weekStart": "2026-09-07", "runCount": 3, "distanceKm": 22.5, "movingTimeSeconds": 8389, "trainingLoad": 136, "averagePaceSecondsPerKm": 372.7, "averagePace": "6:13/km", "averageHeartRate": 148.8 } ],
  "paceByAverageHeartRateBand": [ { "minHeartRate": 150, "maxHeartRate": 154, "runCount": 2, "distanceKm": 15.7, "averagePaceSecondsPerKm": 360.1, "averagePace": "6:00/km" } ],
  "vo2MaxTrend": { "latest": { "value": 47, "date": "2026-09-13" }, "earliest": { "value": 46, "date": "2026-08-31" }, "change": 1, "observations": [ { "date": "2026-08-31", "value": 46 } ] },
  "dataQuality": { "enoughRunsForComparison": false, "recentRunCount": 5, "previousRunCount": 1, "notes": ["Trend confidence is limited: ..."] }
}
```

**Aggregation rules:**

- **Aggregate pace** (`period`/`recentPeriod`/`previousPeriod`/`weekly`/HR bands) is always `total moving time ÷ total distance` for the group — never an average of each run's individual pace — so longer runs correctly count more. Both `averagePaceSecondsPerKm` and a formatted `averagePace` are returned.
- **Average heart rate** is weighted by moving time across only the runs that have a valid average HR; runs missing HR are excluded entirely, never treated as `0`. It's `null` if no run in the group has HR data.
- **Training load** is the sum of each run's `trainingLoad`; a run missing it simply doesn't contribute to the sum.
- **`weekly`** buckets runs Monday-to-Sunday (Monday is the week start), sorted oldest → newest. Only weeks that actually contain at least one run are included — empty weeks are deliberately not manufactured, to keep the response focused on real training signal rather than padding.
- **`paceByAverageHeartRateBand`** groups runs into deterministic 5 bpm bands (e.g. `145–149`, `150–154`) based on each run's own recorded average heart rate — **this is a descriptive grouping, not a physiological training zone**, and it does **not** claim to measure cardiac drift or prove aerobic fitness by itself. It exists so a client can compare pace across runs performed at roughly similar average cardiovascular load (e.g. "am I running faster now at ~150 bpm than I was two months ago?"). Runs without a valid average HR are excluded.
- **`comparison.paceChangeSecondsPerKm`** follows the convention **negative = recent pace is faster, positive = recent pace is slower** (e.g. `-12` means the recent aggregate pace is 12 sec/km faster than the previous period). All other `*Change*` fields are `recentPeriod − previousPeriod`. `distanceChangePercent` is `null` whenever `previousPeriod.distanceKm` is `0` (never a divide-by-zero or `Infinity`).
- **`vo2MaxTrend`** is built entirely from `get_wellness`'s `vo2Max` field — never calculated by this project. Null wellness days are ignored, never interpolated; `observations` lists every non-null value in the period, oldest first.
- **`dataQuality.enoughRunsForComparison`** is `true` only when both `recentPeriod` and `previousPeriod` have at least 2 runs. When `false`, `notes` includes a plain-text caveat that trend confidence is limited — the numbers are still returned as computed, this project just doesn't draw a coaching conclusion from thin data. That's left to the AI client.

> Example prompts:
> - *"Am I getting faster?"*
> - *"How has my running changed over the last two months?"*
> - *"Compare my last two weeks with the two weeks before."*
> - *"Is my pace improving at similar heart rates?"*
> - *"How has my VO2 max changed?"*
> - *"Am I progressing toward my 10K goal?"* (the tool returns descriptive trend data only — it does not predict race times)

### `get_calendar`

Fetches recent and upcoming calendar events / planned workouts (`GET /athlete/{id}/events`, confirmed via live read-only discovery against a real account) for an athlete-local date window, normalizes and classifies each event, and surfaces the next planned running workout for convenience. **Strictly read-only** — this tool never creates, updates, or deletes anything in Intervals.icu.

- **daysBefore** (optional integer, 0–90, default 7) — how many days before today to include.
- **daysAfter** (optional integer, 1–180, default 21) — how many days after today to include.

The date window is computed in `ATHLETE_TIME_ZONE` (see [Environment variables](#environment-variables)) via the same `todayDateOnly`/`addDaysToDateOnly` helpers used by `get_recent_runs`/`get_wellness`/`get_running_progress` — never the server's own UTC date.

Response shape:

```json
{
  "startDate": "2026-09-07",
  "endDate": "2026-10-14",
  "eventsReturned": 1,
  "plannedWorkoutCount": 1,
  "nextPlannedWorkout": null,
  "events": [
    {
      "id": "133599091",
      "date": "2026-09-05T00:00:00",
      "name": "6 × 1 min intervals",
      "category": "WORKOUT",
      "sportType": "Run",
      "eventType": "planned_running_workout",
      "isPlannedWorkout": true,
      "isCompleted": true,
      "completedActivityId": "i183474786",
      "plannedDurationSeconds": 2400,
      "plannedDistanceMeters": 0,
      "description": "2km lugnt. 6x1min tryck / 1min jogg / 15+10 lugnt",
      "workout": {
        "structureAvailable": false,
        "stepCount": 0,
        "description": "2km lugnt. 6x1min tryck / 1min jogg / 15+10 lugnt"
      }
    }
  ]
}
```

(The example above is real, live output from this project's own Milestone 3D smoke test — this account's only calendar event so far is a past, already-completed, free-text-only planned workout.)

**Event classification** (`eventType`) is deliberately conservative, based only on raw signals actually confirmed via live discovery — see the doc comments in `src/lib/intervals/calendarEventNormalizers.ts` for the exact reasoning:

- `"planned_running_workout"` — `category === "WORKOUT"` and the sport is a running type (`Run`/`TrailRun`/`VirtualRun`).
- `"planned_workout_other_sport"` — `category === "WORKOUT"` but a non-running sport (e.g. `Ride`).
- `"note"` — the real `show_as_note` flag is `true`.
- `"other"` — anything else (including any `category` value other than `"WORKOUT"`, none of which this account has ever produced live). The raw `category` string is always passed through unmodified on `CalendarEvent.category` regardless, so a client can still see it even when `eventType` doesn't have a confident opinion about it.

**Completion / linking**: `isCompleted` and `completedActivityId` are derived from Intervals.icu's real `paired_activity_id` field (confirmed live) — never inferred from date alone. A planned workout that's already happened and been matched to a real activity is `isCompleted: true`.

**Workout structure**: kept deliberately conservative. `workout` is `{ structureAvailable, stepCount, description }` — `structureAvailable` is `true` only when the raw `workout_doc.steps` array is genuinely non-empty, `stepCount` is that array's length, and `description` is the plan's free text (`workout_doc.description`, falling back to the event's own `description`). **Structured workout step interpretation is intentionally deferred until a real populated Intervals `workout_doc.steps` response has been inspected** — no per-step fields (duration, distance, target pace/HR/power, repetitions, ...) are parsed or exposed yet, and free text is never parsed into fabricated steps. This account's only real event had `workout_doc.steps: []` (a free-text-only plan), so there has never been a populated example to normalize against; once one exists, this response can be safely extended without a breaking change (`structureAvailable`/`stepCount` will simply start reflecting real data).

**`nextPlannedWorkout`** is the earliest today-or-future `"planned_running_workout"` that isn't already completed — `null` if none qualifies. It deliberately never falls back to a non-running planned workout or a random event.

> Example prompts:
> - *"What do I have planned this week?"*
> - *"What is my next running workout?"*
> - *"Show me Tuesday's workout."*
> - *"Do I have a quality session planned in the next few days?"*
> - *"Compare my upcoming training with my recent recovery."*

### Write tools

`create_running_workout`, `update_running_workout`, and `delete_running_workout` **modify the athlete's Intervals.icu calendar**. Unlike the six read tools above, these have real side effects — see [Safety model for the write tools](#safety-model-for-the-write-tools) for exactly when an AI client should (and shouldn't) call them, and [Writing workouts: why text, not `workout_doc`](#writing-workouts-why-text-not-workout_doc) for the architectural decision behind how they write.

All three share the same **V1 workout model** (deliberately narrow, per this milestone's spec): a running workout made of an optional warmup, `repetitions` × (a work interval + an optional recovery interval), and an optional cooldown — **all steps time-based**, with an optional **absolute pace range** target on the work interval only. Not yet supported: distance-based steps, HR targets, power targets, pace zones, threshold percentages, ramps, cadence, nested structures, multisport, or cycling workouts. The full validated shape (`RunningWorkoutInput`, `src/lib/running/workoutInput.ts`) is:

| Field | Type | Validation |
| --- | --- | --- |
| `date` | string | Required. `"YYYY-MM-DD"`, a genuinely valid calendar date (e.g. `"2026-02-30"` is rejected, not rolled over). |
| `name` | string | Required, 1-200 characters. |
| `warmupSeconds` | integer | 0-10800 (3h). Default `0` — `0` omits the warmup entirely. |
| `repetitions` | integer | Required, 1-30. |
| `workSeconds` | integer | Required, > 0, max 3600 (1h). |
| `recoverySeconds` | integer | 0-3600. Default `0` — `0` omits the recovery step entirely. |
| `paceTarget` | `{ minSecondsPerKm, maxSecondsPerKm }` | Optional. Each bound an integer 120-600 (≈2:00/km-10:00/km); `minSecondsPerKm` (the faster bound) must be **strictly less than** `maxSecondsPerKm` — an inverted or equal range is rejected with a clear error, never silently swapped. |
| `cooldownSeconds` | integer | 0-10800 (3h). Default `0` — `0` omits the cooldown entirely. |
| `notes` | string | Optional, max 1000 characters. **Accepted but currently NOT included in the generated workout text** — see the note below. |

This schema (with per-field descriptions) is the single source of truth: it's used both for domain-layer validation and, reused as-is, as the MCP `inputSchema` for `create_running_workout`/`update_running_workout` — the limits an AI client sees always exactly match the limits actually enforced.

#### `create_running_workout`

Creates a new planned running workout (`POST /athlete/{id}/events`) from a `RunningWorkoutInput`. Builds the Intervals.icu workout-builder text via `generateWorkoutText`, sends a minimal event payload, and validates the response before returning it:

```json
{
  "category": "WORKOUT",
  "type": "Run",
  "start_date_local": "2026-09-16T00:00:00",
  "name": "6 x 90s intervals",
  "description": "Warmup\n- 12m intensity=warmup\n\n6x\n- 90s 4:35/km-4:45/km Pace intensity=active\n- 90s intensity=rest\n\nCooldown\n- 12m intensity=cooldown"
}
```

No `workout_doc`, computed distance, computed duration, or computed training load is ever sent — Intervals.icu derives all of that itself from `description`. After the `POST`, the response is normalized (via the same `normalizeCalendarEvent` `get_calendar` uses) and checked: the returned event's `category` must be `"WORKOUT"`, its sport must be `"Run"`, and its date/name must match what was requested — any mismatch raises a clear error rather than silently returning something unexpected. No extra `GET` is performed.

> Example prompt: *"Create my 6 × 90 second interval workout for Tuesday."*

#### `update_running_workout`

Replaces an existing planned running workout (`PUT /athlete/{id}/events/{eventId}`) — same fields as `create_running_workout`, plus a required `eventId`. This is a **complete replacement**, not a partial patch: the full workout must be re-specified every time.

Before writing, it fetches the existing event (`GET /athlete/{id}/events/{eventId}`) and refuses to proceed unless it is a not-yet-completed planned running workout:

- rejects if `category !== "WORKOUT"`,
- rejects if the sport isn't a running type,
- rejects if the event is already completed/linked to a real activity (`paired_activity_id` is set) — checked **reliably**, not on a best-effort basis: the single-event endpoint (`GET /athlete/{id}/events/{eventId}`) was confirmed (Milestone 3D) to sometimes omit `paired_activity_id` entirely, so this guard never trusts that response for pairing. Instead, it re-fetches the event's own calendar day from the LIST endpoint (`GET /athlete/{id}/events?oldest=<date>&newest=<date>`, confirmed to reliably include `paired_activity_id`), finds the matching event by numeric id, and inspects `paired_activity_id` on *that* object. If the event can't be found again in that list response, the update **fails closed** (refused) rather than proceeding without a reliable pairing check.

The `PUT` payload is always built fresh from the new input only — never from the fetched event — so no stale calculated field (duration, distance, training load, the old `workout_doc`, ...) is ever echoed back.

> Example prompt: *"Move Tuesday's workout to Wednesday and make it 8 reps instead of 6."*

#### `delete_running_workout`

Permanently deletes a planned running workout (`DELETE /athlete/{id}/events/{eventId}`) — takes only `eventId`. Applies the exact same fetch-first safety checks as `update_running_workout` (must be a not-yet-completed planned running workout, verified reliably via the events-list re-check described above) before deleting. Handles a `204 No Content` response correctly (no body to parse) and returns a compact confirmation rather than a full event:

```json
{ "deleted": true, "eventId": "133599091", "name": "6 x 90s intervals", "date": "2026-09-16" }
```

> Example prompt: *"Delete workout 133599091."*

#### Safety model for the write tools

These tools have real side effects, so their MCP tool descriptions are explicit about it and about when calling them is authorized:

- **`create_running_workout`** should only be called when the user has **explicitly** asked to schedule/create/add a workout to their calendar (e.g. *"Create Tuesday's workout in my calendar"*). A request like *"What should I run Tuesday?"* is a request for **coaching advice**, not authorization to write to the calendar — the tool description tells the calling model this directly.
- **`update_running_workout`** should only be called when the user has explicitly asked to change/move/modify a specific scheduled workout.
- **`delete_running_workout`** should only be called when the user has explicitly asked to delete/remove/cancel a specific scheduled workout (e.g. *"Delete workout 123"* is itself sufficient authorization).

There is deliberately **no artificial `confirm: true` parameter** — that would just be another field the calling LLM fills in itself, adding a step without adding real safety. The real safeguards are: (1) tool descriptions that clearly instruct the calling model about when a write is authorized, (2) the fetch-before-write validation in `update_running_workout`/`delete_running_workout` (never blindly trusts an `eventId`), and (3) this milestone's own manual-write policy — see [No live write test](#no-live-write-test-during-this-milestone) below.

#### Writing workouts: why text, not `workout_doc`

**This project never constructs or sends `workout_doc` directly, for any of the three write tools.** Instead, `description` is populated with Intervals.icu's own native workout-builder **text** syntax (`src/lib/running/workoutText.ts`'s `generateWorkoutText`), and Intervals.icu's server parses that text into `workout_doc` itself. This is deliberate, not incidental:

- It's the officially supported way to create/update structured workouts via the Intervals.icu API (confirmed via the API's own documentation and forum guidance — direct `workout_doc` submission is explicitly not supported for creating a workout from scratch).
- Current Intervals.icu guidance recommends workout-builder text for API-created events.
- Direct `workout_doc` writes have been reported to cause problems with Garmin/device export — writing text and letting Intervals.icu compile it avoids that entire class of bug.

Syntax specifics confirmed for V1 (not guessed):

- Durations: `m` = minutes, `s` = seconds (e.g. `12m`, `90s`, `5m30s`). Compact formatting: an exact multiple of 60 seconds becomes `Nm` (`720` → `"12m"`); a duration under 120 seconds that isn't a whole number of minutes becomes `Ns` (`90` → `"90s"`); anything else becomes `AmBs` (`330` → `"5m30s"`).
- An absolute pace **range** target repeats the unit on both sides with a required trailing `Pace` word: `275`/`285` (seconds/km) → `"4:35/km-4:45/km Pace"`. A bare `4:35/km` with no `Pace` word is silently dropped by Intervals.icu's own parser — confirmed via its workout-builder syntax documentation.
- `intensity=` accepts exactly `warmup`, `active`, `rest`, `cooldown` — there is **no** `interval`/`recovery` value. Work intervals are tagged `intensity=active`; recovery steps are tagged `intensity=rest` (the tag that actually exports as a real rest step on-device).
- Repeats use a bare `Nx` line (no section title required) directly before the repeated steps.

Example — a 6 × 90s interval session with a 12-minute warmup/cooldown and a 4:35-4:45/km pace target on the work interval — generated exactly as sent in `description`:

```
Warmup
- 12m intensity=warmup

6x
- 90s 4:35/km-4:45/km Pace intensity=active
- 90s intensity=rest

Cooldown
- 12m intensity=cooldown
```

`notes` (an optional free-text field on `RunningWorkoutInput`) is accepted for forward compatibility but **deliberately not yet included** in the generated text — arbitrary free text risks interfering with the workout-builder parser's own rules (e.g. text placement affects device step-cue text), and there's no confirmed-safe placement syntax to rely on without live-testing it, which this milestone explicitly does not do. `notes` can be safely wired in once that's verified.

## Quality checks

```bash
npm run lint     # ESLint
npx tsc --noEmit # TypeScript type checking
npm run test     # unit tests (vitest)
npm run build    # production build
```

## Milestone status

**Milestone 1** was strictly read-only with no auth. **Milestone 2B** added WorkOS OAuth protection in front of the same read-only tool. **Milestone 3A** added two more read-only tools — `get_run_details` and `get_run_streams` — for per-activity analysis. **Milestone 3B** added `get_wellness` for daily recovery/physiological data (including VO2 max). **Milestone 3C** added `get_running_progress` for descriptive weekly-volume/pace/HR/training-load/VO2 max trend analysis and recent-vs-previous period comparisons. **Milestone 3D** added `get_calendar` for read-only calendar events / planned workouts, including the next planned running workout. **Milestone 3E** (this milestone) adds this project's first **write** capability: `create_running_workout`, `update_running_workout`, and `delete_running_workout` — see [Write tools](#write-tools) for the full behavior and safeguards. All nine tools inherit the same OAuth protection unchanged. Still no database and no automatic coaching logic. VO2 max is never calculated by this project — it's read verbatim from Intervals.icu's `vo2max` wellness field, which itself comes from Garmin. `get_running_progress` never predicts race times, estimates lactate threshold, calculates cardiac drift, claims training zones, or computes a proprietary fitness score. The write tools never construct `workout_doc` themselves — see [Writing workouts: why text, not `workout_doc`](#writing-workouts-why-text-not-workout_doc).

### No live write test during this milestone

Per this milestone's explicit policy, **no real `POST`/`PUT`/`DELETE` request was made against the developer's real Intervals.icu account while building this feature** — only mocked unit tests and read-only `GET` verification calls. The first live write is a deliberate manual step the developer performs after: code review → commit → deploy → MCP client rescans the tool list → the developer explicitly asks for a real write through Running Coach in their AI client.

### Future public app note

This project is currently **single-user**, authenticated with one personal Intervals.icu API key (`INTERVALS_API_KEY`) shared by both read and write tools. A future multi-user version of this app would need real Intervals.icu OAuth (not a shared personal API key) so each user authorizes their own account — and that OAuth grant would need to explicitly include calendar write permission (`CALENDAR:WRITE`) for the three write tools to keep working per-user. **Intervals.icu OAuth is explicitly out of scope for this milestone** — this note exists only to flag the gap for whenever a multi-user version is actually planned.

Future milestones will build on this foundation to add:

- Deeper training analytics (e.g. properly-designed performance/race-time modeling, if ever added, would be its own carefully-scoped milestone — not part of this one)
- A broader workout model (distance-based steps, HR/power targets, pace zones, ramps, cadence, multisport) once there's real demand and each addition can be verified against confirmed workout-builder syntax the same way Milestone 3E's narrow V1 was.
- Real Intervals.icu OAuth for a genuinely multi-user deployment (see the note above) — including `CALENDAR:WRITE` scope for the write tools.

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

### Design assumptions (Milestone 3C)

- `get_running_progress` makes exactly one activities request and one wellness request, both via the existing `getRunningActivitiesInRange` (extracted from, and still used by, `get_recent_runs`) and `getWellness` domain functions — no new upstream endpoints, no per-run detail/stream fetches (no N+1).
- `recentPeriod` + `previousPeriod` together can span up to `2 × comparisonDays` days, which may exceed the requested `days` window for small `days` + large `comparisonDays` combinations (e.g. `days=14`, `comparisonDays=56`). In that case the tool transparently widens its single upstream fetch to `max(days, 2 × comparisonDays)` days so the comparison is never silently truncated; the top-level `period` object still only aggregates over the originally requested `days`.
- Weekly buckets and `paceByAverageHeartRateBand` are scoped to the `daysRequested` window, not the (possibly wider) internal fetch window.
- `weekly` does not manufacture zero-run weeks for gaps in training history — only weeks that actually contain at least one run appear. This was a deliberate simplicity/compactness choice (see the milestone's own design note) and is covered by a dedicated test.
- All aggregation math (pace/HR weighting, weekly bucketing, HR banding, VO2 trend, recent-vs-previous comparison, data-sufficiency) lives in pure, independently unit-tested functions in `src/lib/running/progressAggregation.ts` — `src/lib/intervals/progress.ts` itself only handles fetching and date-window slicing.
- **"Today" is computed in the athlete's local timezone (`ATHLETE_TIME_ZONE`, `src/lib/running/athleteTimeZone.ts`), never via a plain `new Date().toISOString()` UTC conversion.** A naive UTC conversion reports the wrong calendar date for part of every day in any non-UTC timezone (e.g. shortly after local midnight in a positive-UTC-offset zone like `Europe/Stockholm`, or shortly before local midnight in a negative-UTC-offset zone) — which would silently shift `get_recent_runs`/`get_wellness`/`get_running_progress`'s date windows by a day. `todayDateOnly(timeZone, date)` (`src/lib/running/dates.ts`) resolves this via `Intl.DateTimeFormat`; all other date-only arithmetic in this project (`addDaysToDateOnly`, weekly bucketing's Monday calculation) is pure UTC-component math on already-resolved `"YYYY-MM-DD"` strings, so it can never reintroduce this class of bug.

### Design assumptions (Milestone 3D)

- The calendar/planned-workout endpoint was found via live discovery, not assumed: `GET /api/v1/athlete/{id}/events?oldest=YYYY-MM-DD&newest=YYYY-MM-DD` (same base client, same auth as every other endpoint). A `/calendar` path was tried first and returned `404` — `/events` is the correct one. A single-event detail endpoint also exists (`GET /athlete/{id}/events/{id}`), but notably its response **omits** `paired_activity_id`, which the list endpoint includes — so `getCalendar` only ever uses the list endpoint.
- This account had exactly **one** real calendar event across a 2-year discovery window (1 year back to 1 year forward): a past, already-completed, free-text-only planned running workout. `category="WORKOUT"` and the confirmed `show_as_note` boolean are the only classification signals with real evidence behind them; querying `category=NOTE` and `category=RACE_A` both returned `200 []` (accepted by the API, but with zero real examples to confirm what they actually look like for this account). Rather than hardcode meaning for category values never observed, `classifyEventType` (`src/lib/intervals/calendarEventNormalizers.ts`) only derives `"planned_running_workout"` / `"planned_workout_other_sport"` / `"note"` from confirmed signals and falls back to a neutral `"other"` — while still always passing the raw `category` string through unmodified.
- **Completion linking is real, not inferred**: the one real event's `paired_activity_id` (`"i183474786"`) pointed at an actual completed activity with a matching name — confirming Intervals.icu really does link planned events to completed activities this way. `isCompleted`/`completedActivityId` are derived from that field only; a past event with no `paired_activity_id` is still `isCompleted: false` (never inferred from its date being in the past).
- **`plannedDurationSeconds`/`plannedDistanceMeters` (raw `moving_time`/`distance`) have an observed dual nature**: on the one real (completed, paired) event, these matched the linked activity's actual moving time — so for an already-completed event they may reflect what happened rather than a pre-workout target. This account has no genuinely future, not-yet-completed event to confirm the field's meaning before completion; documented here rather than asserted as certain.
- **Structured workout step interpretation is intentionally deferred until a real populated Intervals `workout_doc.steps` response has been inspected.** This account's only real event had `workout_doc.steps: []` (a free-text-only plan), and neither its calendar nor its workout library folder (`GET /athlete/{id}/folders`, confirmed to exist but empty) contained a single populated example. Rather than ship speculative per-step parsing built on an unconfirmed schema, `CalendarEventWorkout` only reports `structureAvailable` (is `steps` non-empty?), `stepCount` (`steps.length`), and `description` (free text) — no per-step fields (duration, distance, target pace/HR/power, repetitions, nested steps, ...) are modeled or exposed at all. This is a safe, additive gap: once a real populated example exists, per-step fields can be added to the response without a breaking change.
- `nextPlannedWorkout` only ever considers `"planned_running_workout"` events, per the milestone's explicit spec — a planned strength/cycling workout never becomes `nextPlannedWorkout`, even if it's the only planned workout on the calendar (`plannedWorkoutCount` still counts it, just not as "next").
- Calendar event ids are plain numbers in Intervals.icu's raw schema (e.g. `133599091`), unlike activity ids (`"i186254951"`); `CalendarEvent.id` stringifies them for consistency with how every other tool in this project exposes ids.

### Design assumptions (Milestone 3E)

- **Workout-builder text syntax was confirmed via Intervals.icu's own community-maintained syntax references** (the forum "Workout Builder Syntax Quick Guide", cross-checked against the independently-maintained `intervals-icu-workout-parser` spec) rather than live-tested against a real account — this milestone's explicit policy prohibits any real `POST`/`PUT`/`DELETE` write during development. Two syntax details are worth calling out because they deliberately diverge from this milestone's own illustrative example text: `intensity=` only accepts `warmup`/`active`/`rest`/`cooldown` (there is no `interval`/`recovery` value, so work steps use `intensity=active` and recovery steps use `intensity=rest`), and an absolute pace range repeats the distance unit on both sides of the dash with a required trailing `Pace` word (`"4:35/km-4:45/km Pace"`, not `"4:35-4:45/km Pace"`) — both confirmed by the same syntax references. If Intervals.icu's parser turns out to be more lenient than documented once a real write is finally tested, this is the first place to revisit.
- **The single-event detail endpoint's `paired_activity_id` omission (discovered in Milestone 3D) directly shapes `update_running_workout`/`delete_running_workout`'s safety check — and was hardened after an initial best-effort version.** Both tools first fetch the target event via `GET /athlete/{id}/events/{eventId}`, but never trust that response for pairing. Instead, they extract the event's athlete-local date from `start_date_local`, re-fetch that exact single day via the LIST endpoint (`GET /athlete/{id}/events?oldest=<date>&newest=<date>`, confirmed to reliably include `paired_activity_id`), find the matching event by numeric id, and check `paired_activity_id` on that object. If the event can't be found again in that list response (e.g. deleted concurrently, or a date parsing edge case), the action **fails closed** — refused, never silently allowed through. This is implemented as one shared helper (`assertNotPairedViaListEndpoint` in `src/lib/intervals/workouts.ts`) used by both `updateRunningWorkout` and `deleteRunningWorkout`.
- **`createRunningWorkout`/`updateRunningWorkout` validate the API's response before trusting it**, rather than only checking the HTTP status: the returned event's `category` must be `"WORKOUT"`, its sport must be `"Run"`, and its date/name must match what was requested. Any mismatch (or a response that isn't even a plausible event object) raises a clear `IntervalsApiError` rather than silently normalizing and returning something unexpected.
- **The `PUT` payload is always rebuilt from scratch from the new input**, never from the event fetched for the safety check — this is what guarantees `update_running_workout` can't accidentally echo back stale calculated fields (old duration, distance, training load, or `workout_doc`) alongside the new text.
- **`RunningWorkoutInput`'s validation schema (`src/lib/running/workoutInput.ts`) is reused, unmodified, as the MCP `inputSchema` for `create_running_workout`/`update_running_workout`** (via `.extend({ eventId })` for update) — a deliberate single-source-of-truth choice so the bounds an AI client sees in the tool's JSON schema can never silently drift from the bounds actually enforced server-side.
- **`notes` is accepted but not yet wired into the generated text**, per the milestone's explicit "defer rather than guess" instruction — see [Writing workouts: why text, not `workout_doc`](#writing-workouts-why-text-not-workout_doc) for why.
- **Pace target sanity bounds (120-600 seconds/km, i.e. ~2:00/km-10:00/km) are deliberately narrower than `src/lib/running/pace.ts`'s existing stream-analysis bounds** (0.3-8.5 m/s, i.e. roughly 2:00/km-55:00/km) — those exist to distinguish "a real recorded pace sample" from "GPS noise/a paused watch" in already-happened data, which is a very different question from "is this a plausible *target* pace to assign to a future work interval." Reusing the wider stream bounds here would let a validation call through for e.g. `9:00/km` on a "work" interval — technically a real running pace, but never something a structured interval session would target.
- No live write test was performed at any point during this milestone (see [No live write test during this milestone](#no-live-write-test-during-this-milestone)) — all 3E behavior is verified exclusively via mocked unit tests against `intervalsPost`/`intervalsPut`/`intervalsDelete`, never a real Intervals.icu request.
- **Read-only discovery against real Run sport settings (`GET /athlete/{id}/sport-settings/Run`) found `threshold_pace: null` and `pace_zones: null`** for this account (`pace_units` is `"MINS_KM"`). This is exactly why V1 only supports an **absolute** pace range target (`4:35/km-4:45/km Pace`) rather than percent-of-threshold (`X% pace`) or pace-zone (`ZX pace`) targets — those would silently fail to resolve to a meaningful value with no threshold pace configured. `threshold_pace` should be set in Intervals.icu's Run sport settings before relying on any future threshold-relative pace target.
