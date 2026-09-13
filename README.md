# running-coach-mcp

A small, read-only [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects an AI client to a personal [Intervals.icu](https://intervals.icu) account.

- **Milestone 1** exposed a single tool, `get_recent_runs`, returning the athlete's most recent running activities as clean, normalized JSON.
- **Milestone 2B** (this milestone) protects `/api/mcp` with standards-compliant OAuth via [WorkOS AuthKit](https://workos.com/authkit), so the endpoint can be safely exposed on the public internet (e.g. on Vercel) while remaining accessible to exactly one person.

The server remains strictly **read-only**.

## Architecture

```
Garmin  →  Garmin Connect  →  Intervals.icu  →  running-coach-mcp  →  WorkOS OAuth protected MCP  →  ChatGPT
```

- **Garmin / Garmin Connect** — the athlete's watch and activity sync source.
- **Intervals.icu** — source of truth for activity data, synced from Garmin. Accessed read-only via HTTP Basic Auth with a personal API key.
- **running-coach-mcp** (this app, `src/lib/intervals/*`) — a small server-only client and domain layer that fetches raw activities and converts them into our own normalized model (`src/types/activity.ts`). MCP code never touches the raw Intervals.icu response shape directly.
- **WorkOS OAuth protected MCP** (`src/app/api/mcp/route.ts` + `src/lib/auth/*`) — exposes the domain layer as MCP tools over Streamable HTTP via [`mcp-handler`](https://www.npmjs.com/package/mcp-handler), gated behind OAuth bearer-token verification.
- **ChatGPT** (or any MCP-compatible client — Claude Desktop, Cursor, MCP Inspector, etc.) — calls `get_recent_runs` after completing the OAuth flow against WorkOS.

### OAuth roles

- **WorkOS AuthKit is the OAuth *Authorization Server***. It authenticates the user and issues access tokens. This app never issues tokens itself and never runs its own authorization server.
- **running-coach-mcp is the OAuth *Resource Server***. It cryptographically verifies WorkOS-issued access tokens (signature + issuer + audience, via JWKS) before allowing a request to reach the `get_recent_runs` tool.
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
      mcp/route.ts        # MCP endpoint (Streamable HTTP), OAuth-protected — registers get_recent_runs
    page.tsx              # minimal info page (no UI framework needed)

  lib/
    auth/
      config.ts             # reads/validates WORKOS_AUTHKIT_DOMAIN / MCP_RESOURCE_URL / MCP_ALLOWED_USER_ID
      verifyAccessToken.ts   # cryptographic JWT verification against WorkOS JWKS (jose), issuer + audience checks
      mcpAuth.ts             # withMcpAuth wiring + single-user (sub) authorization -> 401 / 403
    intervals/
      auth.ts            # reads INTERVALS_API_KEY / INTERVALS_ATHLETE_ID, builds Basic Auth header
      client.ts          # server-only fetch wrapper (GET only, timeout, no-store, error mapping)
      activities.ts      # domain layer: getRecentRuns() — fetch, filter, sort, limit
      normalizers.ts     # IntervalsActivity -> RunningActivity conversion
    running/
      pace.ts            # pure pace calculation/formatting helpers

  types/
    activity.ts          # IntervalsActivity (raw) and RunningActivity (our model)
```

The `IntervalsClient` layer is structured so future methods (`getActivity`, `getActivityStreams`, `getWellness`, `getCalendar`, and eventually write operations) can be added without reshaping what's already here — see the comments in `src/lib/intervals/client.ts`. None of those are implemented yet.

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

## Testing `get_recent_runs` with MCP Inspector

Calling `/api/mcp` now requires a valid WorkOS access token (see [Auth architecture](#oauth-roles) above), so a plain `npx @modelcontextprotocol/inspector <url>` connection will get a `401` until it completes the OAuth flow.

With the dev server running, in another terminal:

```bash
npx @modelcontextprotocol/inspector
```

This opens the Inspector UI in your browser. Connect with:

- **Transport**: `Streamable HTTP`
- **URL**: `http://localhost:3000/api/mcp` (or the production URL above)

Inspector supports the standard OAuth discovery flow: it will read `/.well-known/oauth-protected-resource`, follow the `authorization_servers` entry to WorkOS, and prompt you to sign in. Once authenticated as the allow-listed user, open the **Tools** tab, select `get_recent_runs`, and call it (optionally with `limit` and `days`) to see your recent runs as JSON.

## The `get_recent_runs` tool

Unchanged since Milestone 1:

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

**Milestone 1** was strictly read-only with no auth. **Milestone 2B** (this milestone) adds WorkOS OAuth protection in front of the same read-only tool — no database, no Supabase, still no write operations (no `POST`/`PUT`/`PATCH`/`DELETE` calls to Intervals.icu).

Future milestones will build on this foundation to add:

- Activity streams (`getActivityStreams`)
- Wellness data (`getWellness`)
- Calendar / planned workouts (`getCalendar`)
- Deeper training analytics
- Eventually, workout creation/editing (`createWorkout`, `updateWorkout`, `deleteWorkout`) — write access, with stronger safeguards

## Notes / assumptions

- Never commit `.env.local` or any file containing a real API key, WorkOS domain secret, or your real WorkOS user id (`.env*` is git-ignored; `.env.example` is explicitly un-ignored so the template can be committed).
- `/api/health` is intentionally public and never requires OAuth; it only reports whether config *exists*, never secret values.
