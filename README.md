# running-coach-mcp

A small, read-only [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects an AI client to a personal [Intervals.icu](https://intervals.icu) account.

**Milestone 1** exposes a single tool, `get_recent_runs`, which returns the athlete's most recent running activities as clean, normalized JSON.

## Architecture

```
Garmin  →  Intervals.icu  →  Next.js backend (this app)  →  MCP  →  AI client
```

- **Garmin** — the athlete's watch/activity source, synced into Intervals.icu.
- **Intervals.icu** — source of truth for activity data. Accessed read-only via HTTP Basic Auth.
- **Next.js backend** (`src/lib/intervals/*`) — a small server-only client and domain layer that fetches raw activities and converts them into our own normalized model (`src/types/activity.ts`). MCP code never touches the raw Intervals.icu response shape directly.
- **MCP** (`src/app/api/mcp/route.ts`) — exposes the domain layer as MCP tools over Streamable HTTP, via [`mcp-handler`](https://www.npmjs.com/package/mcp-handler).
- **AI client** — any MCP-compatible client (Claude Desktop, Cursor, MCP Inspector, etc.) that calls `get_recent_runs`.

```
src/
  app/
    api/
      health/route.ts   # GET /api/health — liveness + config check (no secrets, no Intervals calls)
      mcp/route.ts       # MCP endpoint (Streamable HTTP) — registers get_recent_runs
    page.tsx             # minimal info page (no UI framework needed)

  lib/
    intervals/
      auth.ts            # reads INTERVALS_API_KEY / INTERVALS_ATHLETE_ID, builds Basic Auth header
      client.ts           # server-only fetch wrapper (GET only, timeout, no-store, error mapping)
      activities.ts       # domain layer: getRecentRuns() — fetch, filter, sort, limit
      normalizers.ts       # IntervalsActivity -> RunningActivity conversion
    running/
      pace.ts             # pure pace calculation/formatting helpers

  types/
    activity.ts           # IntervalsActivity (raw) and RunningActivity (our model)
```

This milestone is intentionally read-only: no database, no OAuth, no write endpoints. The `IntervalsClient` layer is structured so that future methods (`getActivity`, `getActivityStreams`, `getWellness`, `getCalendar`, and eventually write operations) can be added without reshaping what's already here — see the comments in `src/lib/intervals/client.ts`.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` (see `.env.example`):

   ```bash
   INTERVALS_API_KEY=<your personal Intervals API key>
   INTERVALS_ATHLETE_ID=0
   ```

   Get your API key from Intervals.icu under **Settings → Developer Settings**. `INTERVALS_ATHLETE_ID` defaults to `0` (your own athlete) if omitted.

3. Run the dev server:

   ```bash
   npm run dev
   ```

- MCP endpoint: `http://localhost:3000/api/mcp`
- Health check: `http://localhost:3000/api/health`

## Testing the MCP endpoint with MCP Inspector

With the dev server running, in another terminal:

```bash
npx @modelcontextprotocol/inspector
```

This opens the Inspector UI in your browser. Connect with:

- **Transport**: `Streamable HTTP`
- **URL**: `http://localhost:3000/api/mcp`

Once connected, open the **Tools** tab, select `get_recent_runs`, and call it (optionally with `limit` and `days`) to see your recent runs as JSON.

## The `get_recent_runs` tool

- **limit** (optional integer, 1–20, default 5) — max number of runs to return.
- **days** (optional integer, 7–365, default 90) — how far back to search.

It fetches up to 100 recent activities from Intervals.icu within the date window, filters to running types (`Run`, `TrailRun`, `VirtualRun`), sorts newest first, and returns up to `limit` normalized runs. If fewer runs exist in the window, it returns whatever is available.

## Quality checks

```bash
npm run lint     # ESLint
npx tsc --noEmit # TypeScript type checking
npm run test     # unit tests (vitest)
npm run build    # production build
```

## Milestone status

**Milestone 1 (this milestone) is strictly read-only**: no database, no Supabase, no OAuth, no write operations (no `POST`/`PUT`/`PATCH`/`DELETE` calls to Intervals.icu).

Future milestones will build on this foundation to add:

- Activity streams (`getActivityStreams`)
- Wellness data (`getWellness`)
- Calendar / planned workouts (`getCalendar`)
- Deeper training analytics
- Eventually, workout creation/editing (`createWorkout`, `updateWorkout`, `deleteWorkout`) — write access, once OAuth and stronger safeguards are in place

## Notes / assumptions

- Never commit `.env.local` or any file containing a real API key (`.env*` is git-ignored; `.env.example` is explicitly un-ignored so the template can be committed).
