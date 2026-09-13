# running-coach-mcp

A small, read-only [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects an AI client to a personal [Intervals.icu](https://intervals.icu) account.

- **Milestone 1** exposed a single tool, `get_recent_runs`, returning the athlete's most recent running activities as clean, normalized JSON.
- **Milestone 2B** protected `/api/mcp` with standards-compliant OAuth via [WorkOS AuthKit](https://workos.com/authkit), so the endpoint can be safely exposed on the public internet (e.g. on Vercel) while remaining accessible to exactly one person.
- **Milestone 3A** (this milestone) adds two more read-only tools, `get_run_details` and `get_run_streams`, so an AI client can drill into a single run's detected intervals and time-series data (pace, heart rate, cadence, power, elevation) for real analysis — "did I fade in the last interval?", "how did my heart rate develop?", etc.

The server remains strictly **read-only**.

## Architecture

```
Garmin  →  Garmin Connect  →  Intervals.icu  →  running-coach-mcp  →  WorkOS OAuth protected MCP  →  ChatGPT
```

- **Garmin / Garmin Connect** — the athlete's watch and activity sync source.
- **Intervals.icu** — source of truth for activity data, synced from Garmin. Accessed read-only via HTTP Basic Auth with a personal API key.
- **running-coach-mcp** (this app, `src/lib/intervals/*`) — a small server-only client and domain layer that fetches raw activities, activity detail + intervals, and time-series streams, and converts each into our own normalized models (`src/types/activity.ts`, `src/types/interval.ts`, `src/types/stream.ts`). MCP code never touches the raw Intervals.icu response shape directly.
- **WorkOS OAuth protected MCP** (`src/app/api/mcp/route.ts` + `src/lib/auth/*`) — exposes the domain layer as MCP tools over Streamable HTTP via [`mcp-handler`](https://www.npmjs.com/package/mcp-handler), gated behind OAuth bearer-token verification.
- **ChatGPT** (or any MCP-compatible client — Claude Desktop, Cursor, MCP Inspector, etc.) — calls `get_recent_runs`, `get_run_details`, and `get_run_streams` after completing the OAuth flow against WorkOS.

### OAuth roles

- **WorkOS AuthKit is the OAuth *Authorization Server***. It authenticates the user and issues access tokens. This app never issues tokens itself and never runs its own authorization server.
- **running-coach-mcp is the OAuth *Resource Server***. It cryptographically verifies WorkOS-issued access tokens (signature + issuer + audience, via JWKS) before allowing a request to reach any tool (`get_recent_runs`, `get_run_details`, `get_run_streams`). The check wraps the whole `/api/mcp` handler, so every tool registered on it — including future ones — inherits the same protection automatically.
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
      mcp/route.ts        # MCP endpoint (Streamable HTTP), OAuth-protected — registers all three tools
    page.tsx              # minimal info page (no UI framework needed)

  lib/
    auth/
      config.ts             # reads/validates WORKOS_AUTHKIT_DOMAIN / MCP_RESOURCE_URL / MCP_ALLOWED_USER_ID
      verifyAccessToken.ts   # cryptographic JWT verification against WorkOS JWKS (jose), issuer + audience checks
      mcpAuth.ts             # withMcpAuth wiring + single-user (sub) authorization -> 401 / 403
    intervals/
      auth.ts             # reads INTERVALS_API_KEY / INTERVALS_ATHLETE_ID, builds Basic Auth header
      client.ts           # server-only fetch wrapper (GET only, timeout, no-store, error mapping)
      activities.ts       # domain layer: getRecentRuns() — fetch, filter, sort, limit
      activityDetails.ts  # domain layer: getRunDetails() — activity + intervals, running-type check
      streams.ts          # domain layer: getRunStreams() — full stream fetch + downsampling
      normalizers.ts      # raw Intervals.icu shapes -> our RunningActivity / RunningInterval / stream point models
    running/
      pace.ts             # pure pace/speed calculation + formatting helpers
      downsample.ts       # pure, deterministic bucket-sampling helper (no randomness)

  types/
    activity.ts          # IntervalsActivity (raw) and RunningActivity / RunningActivityDetail (our models)
    interval.ts           # IntervalsInterval (raw) and RunningInterval (our model)
    stream.ts             # IntervalsStream (raw) and RunningStreamPoint / RunningStreamsResult (our models)
```

The `IntervalsClient` layer is structured so future methods (`getWellness`, `getCalendar`, and eventually write operations) can be added without reshaping what's already here — see the comments in `src/lib/intervals/client.ts`. None of those are implemented yet.

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

All three tools are read-only, require the same WorkOS OAuth bearer token, and never expose Intervals.icu credentials or raw upstream payloads.

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

## Quality checks

```bash
npm run lint     # ESLint
npx tsc --noEmit # TypeScript type checking
npm run test     # unit tests (vitest)
npm run build    # production build
```

## Milestone status

**Milestone 1** was strictly read-only with no auth. **Milestone 2B** added WorkOS OAuth protection in front of the same read-only tool. **Milestone 3A** (this milestone) adds two more read-only tools — `get_run_details` and `get_run_streams` — for per-activity analysis, inheriting the same OAuth protection unchanged. Still no database, no wellness, no calendar, no automatic coaching logic, and no write operations (no `POST`/`PUT`/`PATCH`/`DELETE` calls to Intervals.icu).

Future milestones will build on this foundation to add:

- Wellness data (`getWellness`)
- Calendar / planned workouts (`getCalendar`)
- Deeper training analytics (e.g. cross-activity trends, load/fitness tracking over time)
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
