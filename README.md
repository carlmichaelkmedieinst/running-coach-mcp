# running-coach-mcp

A small, read-only [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects an AI client to a personal [Intervals.icu](https://intervals.icu) account.

- **Milestone 1** exposed a single tool, `get_recent_runs`, returning the athlete's most recent running activities as clean, normalized JSON.
- **Milestone 2B** protected `/api/mcp` with standards-compliant OAuth via [WorkOS AuthKit](https://workos.com/authkit), so the endpoint can be safely exposed on the public internet (e.g. on Vercel) while remaining accessible to exactly one person.
- **Milestone 3A** adds two more read-only tools, `get_run_details` and `get_run_streams`, so an AI client can drill into a single run's detected intervals and time-series data (pace, heart rate, cadence, power, elevation) for real analysis — "did I fade in the last interval?", "how did my heart rate develop?", etc.
- **Milestone 3B** adds `get_wellness`, exposing daily recovery/physiological data (resting heart rate, HRV, sleep, weight, VO2 max, CTL/ATL training load) — athlete-level, not tied to any single activity.
- **Milestone 3C** (this milestone) adds `get_running_progress`, descriptive weekly-volume/pace/heart-rate/training-load/VO2 max trend analysis with recent-vs-previous period comparisons — built cheaply from the existing activity list and wellness data, with no per-run detail or stream fetches.

The server remains strictly **read-only**.

## Architecture

```
Garmin  →  Garmin Connect  →  Intervals.icu  →  running-coach-mcp  →  WorkOS OAuth protected MCP  →  ChatGPT
```

- **Garmin / Garmin Connect** — the athlete's watch and activity sync source.
- **Intervals.icu** — source of truth for activity data, synced from Garmin. Accessed read-only via HTTP Basic Auth with a personal API key.
- **running-coach-mcp** (this app, `src/lib/intervals/*`) — a small server-only client and domain layer that fetches raw activities, activity detail + intervals, time-series streams, and daily wellness data, and converts each into our own normalized models (`src/types/activity.ts`, `src/types/interval.ts`, `src/types/stream.ts`, `src/types/wellness.ts`). `src/lib/intervals/progress.ts` builds descriptive trend analysis (`src/types/progress.ts`) on top of the same activity list + wellness data — no extra upstream endpoints, no per-run detail/stream fetches. MCP code never touches the raw Intervals.icu response shape directly.
- **WorkOS OAuth protected MCP** (`src/app/api/mcp/route.ts` + `src/lib/auth/*`) — exposes the domain layer as MCP tools over Streamable HTTP via [`mcp-handler`](https://www.npmjs.com/package/mcp-handler), gated behind OAuth bearer-token verification.
- **ChatGPT** (or any MCP-compatible client — Claude Desktop, Cursor, MCP Inspector, etc.) — calls `get_recent_runs`, `get_run_details`, `get_run_streams`, `get_wellness`, and `get_running_progress` after completing the OAuth flow against WorkOS.

### OAuth roles

- **WorkOS AuthKit is the OAuth *Authorization Server***. It authenticates the user and issues access tokens. This app never issues tokens itself and never runs its own authorization server.
- **running-coach-mcp is the OAuth *Resource Server***. It cryptographically verifies WorkOS-issued access tokens (signature + issuer + audience, via JWKS) before allowing a request to reach any tool (`get_recent_runs`, `get_run_details`, `get_run_streams`, `get_wellness`, `get_running_progress`). The check wraps the whole `/api/mcp` handler, so every tool registered on it — including future ones — inherits the same protection automatically.
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
      mcp/route.ts        # MCP endpoint (Streamable HTTP), OAuth-protected — registers all five tools
    page.tsx              # minimal info page (no UI framework needed)

  lib/
    auth/
      config.ts             # reads/validates WORKOS_AUTHKIT_DOMAIN / MCP_RESOURCE_URL / MCP_ALLOWED_USER_ID
      verifyAccessToken.ts   # cryptographic JWT verification against WorkOS JWKS (jose), issuer + audience checks
      mcpAuth.ts             # withMcpAuth wiring + single-user (sub) authorization -> 401 / 403
    intervals/
      auth.ts               # reads INTERVALS_API_KEY / INTERVALS_ATHLETE_ID, builds Basic Auth header
      client.ts             # server-only fetch wrapper (GET only, timeout, no-store, error mapping)
      activities.ts         # domain layer: getRunningActivitiesInRange() + getRecentRuns() — fetch, filter, sort, (optionally) limit
      activityDetails.ts    # domain layer: getRunDetails() — activity + intervals, running-type check
      streams.ts            # domain layer: getRunStreams() — full stream fetch + downsampling
      wellness.ts            # domain layer: getWellness() — daily wellness fetch + latest/latest-non-null summary
      progress.ts            # domain layer: getRunningProgress() — trend analysis, built on activities.ts + wellness.ts (no new upstream calls)
      normalizers.ts        # raw Intervals.icu activity shapes -> RunningActivity / RunningInterval / stream point models
      wellnessNormalizers.ts # raw Intervals.icu wellness shape -> DailyWellness model
    running/
      pace.ts             # pure pace/speed calculation + formatting helpers
      downsample.ts       # pure, deterministic bucket-sampling helper (no randomness)
      dates.ts            # pure date-only helpers (toDateOnly, daysBeforeDateOnly, isDateOnlyInRange), shared by activities/wellness/progress
      progressAggregation.ts # pure aggregation rules for progress analysis (pace/HR weighting, weekly buckets, HR bands, VO2 trend, comparisons)

  types/
    activity.ts          # IntervalsActivity (raw) and RunningActivity / RunningActivityDetail (our models)
    interval.ts           # IntervalsInterval (raw) and RunningInterval (our model)
    stream.ts             # IntervalsStream (raw) and RunningStreamPoint / RunningStreamsResult (our models)
    wellness.ts            # IntervalsWellnessEntry (raw) and DailyWellness / WellnessResult (our models)
    progress.ts            # normalized RunningProgressResult and its nested types (no raw upstream shape here)
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

All five tools are read-only, require the same WorkOS OAuth bearer token, and never expose Intervals.icu credentials or raw upstream payloads.

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

## Quality checks

```bash
npm run lint     # ESLint
npx tsc --noEmit # TypeScript type checking
npm run test     # unit tests (vitest)
npm run build    # production build
```

## Milestone status

**Milestone 1** was strictly read-only with no auth. **Milestone 2B** added WorkOS OAuth protection in front of the same read-only tool. **Milestone 3A** added two more read-only tools — `get_run_details` and `get_run_streams` — for per-activity analysis. **Milestone 3B** added `get_wellness` for daily recovery/physiological data (including VO2 max). **Milestone 3C** (this milestone) adds `get_running_progress` for descriptive weekly-volume/pace/HR/training-load/VO2 max trend analysis and recent-vs-previous period comparisons — all five tools inherit the same OAuth protection unchanged. Still no database, no calendar, no automatic coaching logic, and no write operations (no `POST`/`PUT`/`PATCH`/`DELETE` calls to Intervals.icu). VO2 max is never calculated by this project — it's read verbatim from Intervals.icu's `vo2max` wellness field, which itself comes from Garmin. `get_running_progress` never predicts race times, estimates lactate threshold, calculates cardiac drift, claims training zones, or computes a proprietary fitness score.

Future milestones will build on this foundation to add:

- Calendar / planned workouts (`getCalendar`)
- Deeper training analytics (e.g. properly-designed performance/race-time modeling, if ever added, would be its own carefully-scoped milestone — not part of this one)
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

### Design assumptions (Milestone 3C)

- `get_running_progress` makes exactly one activities request and one wellness request, both via the existing `getRunningActivitiesInRange` (extracted from, and still used by, `get_recent_runs`) and `getWellness` domain functions — no new upstream endpoints, no per-run detail/stream fetches (no N+1).
- `recentPeriod` + `previousPeriod` together can span up to `2 × comparisonDays` days, which may exceed the requested `days` window for small `days` + large `comparisonDays` combinations (e.g. `days=14`, `comparisonDays=56`). In that case the tool transparently widens its single upstream fetch to `max(days, 2 × comparisonDays)` days so the comparison is never silently truncated; the top-level `period` object still only aggregates over the originally requested `days`.
- Weekly buckets and `paceByAverageHeartRateBand` are scoped to the `daysRequested` window, not the (possibly wider) internal fetch window.
- `weekly` does not manufacture zero-run weeks for gaps in training history — only weeks that actually contain at least one run appear. This was a deliberate simplicity/compactness choice (see the milestone's own design note) and is covered by a dedicated test.
- All aggregation math (pace/HR weighting, weekly bucketing, HR banding, VO2 trend, recent-vs-previous comparison, data-sufficiency) lives in pure, independently unit-tested functions in `src/lib/running/progressAggregation.ts` — `src/lib/intervals/progress.ts` itself only handles fetching and date-window slicing.
- **"Today" is computed in the athlete's local timezone (`ATHLETE_TIME_ZONE`, `src/lib/running/athleteTimeZone.ts`), never via a plain `new Date().toISOString()` UTC conversion.** A naive UTC conversion reports the wrong calendar date for part of every day in any non-UTC timezone (e.g. shortly after local midnight in a positive-UTC-offset zone like `Europe/Stockholm`, or shortly before local midnight in a negative-UTC-offset zone) — which would silently shift `get_recent_runs`/`get_wellness`/`get_running_progress`'s date windows by a day. `todayDateOnly(timeZone, date)` (`src/lib/running/dates.ts`) resolves this via `Intl.DateTimeFormat`; all other date-only arithmetic in this project (`addDaysToDateOnly`, weekly bucketing's Monday calculation) is pure UTC-component math on already-resolved `"YYYY-MM-DD"` strings, so it can never reintroduce this class of bug.
