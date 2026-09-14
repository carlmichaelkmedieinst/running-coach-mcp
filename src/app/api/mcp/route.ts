import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

import { withWorkosAuth } from "@/lib/auth/mcpAuth";
import { getRunDetails } from "@/lib/intervals/activityDetails";
import { getRecentRuns } from "@/lib/intervals/activities";
import { getCalendar } from "@/lib/intervals/calendar";
import { IntervalsApiError } from "@/lib/intervals/client";
import { getRunningProgress } from "@/lib/intervals/progress";
import { getRunStreams } from "@/lib/intervals/streams";
import { getWellness } from "@/lib/intervals/wellness";

/**
 * MCP endpoint (Streamable HTTP transport, via `mcp-handler`).
 *
 * Milestone 1 exposes `get_recent_runs`. Milestone 3A adds `get_run_details`
 * and `get_run_streams`, for analyzing one specific activity. Milestone 3B
 * adds `get_wellness`, for athlete-level daily recovery data (resting heart
 * rate, HRV, sleep, weight, VO2 max, fitnessCtl/fatigueAtl training load) —
 * deliberately separate from any single activity. Milestone 3C adds
 * `get_running_progress`, for descriptive weekly-volume/pace/HR/training-load/
 * VO2 max trends and recent-vs-previous period comparisons, built cheaply
 * from the existing activity list and wellness data (no per-run detail or
 * stream fetches). Milestone 3D adds `get_calendar`, for read-only calendar
 * events / planned workouts (still no create/update/delete). MCP-specific
 * code here only talks to our domain layer (`getRecentRuns` / `getRunDetails`
 * / `getRunStreams` / `getWellness` / `getRunningProgress` / `getCalendar`)
 * — it never touches raw Intervals.icu response shapes directly.
 *
 * Milestone 2B: the endpoint is protected by WorkOS OAuth (see
 * `withWorkosAuth` / `src/lib/auth/mcpAuth.ts`). Only a request bearing a
 * valid, WorkOS-issued access token for the allow-listed single user ever
 * reaches this handler. All tools registered below — including every tool
 * added after Milestone 2B — inherit this same protection automatically,
 * since it wraps the whole handler, not individual tools.
 */
const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "get_recent_runs",
      {
        title: "Get recent runs",
        description:
          "Get the athlete's most recent running activities from Intervals.icu. Use this when the user asks about recent runs or wants to see their latest running activities.",
        inputSchema: z.object({
          limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .default(5)
            .describe("Maximum number of runs to return (1-20, default 5)."),
          days: z
            .number()
            .int()
            .min(7)
            .max(365)
            .default(90)
            .describe("How many days back to search for runs (7-365, default 90)."),
        }),
        annotations: {
          title: "Get recent runs",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ limit, days }) => {
        try {
          const runs = await getRecentRuns({ limit, days });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ runs, count: runs.length }, null, 2),
              },
            ],
          };
        } catch (error) {
          const message =
            error instanceof IntervalsApiError || error instanceof Error
              ? error.message
              : "Intervals.icu request failed unexpectedly.";

          return {
            isError: true,
            content: [{ type: "text" as const, text: message }],
          };
        }
      }
    );

    server.registerTool(
      "get_run_details",
      {
        title: "Get run details",
        description:
          "Get detailed data and detected intervals for one running activity from Intervals.icu. Use this when analyzing a specific run or its interval structure.",
        inputSchema: z.object({
          activityId: z
            .string()
            .min(1)
            .describe('The Intervals.icu activity id, e.g. "i186254951".'),
        }),
        annotations: {
          title: "Get run details",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ activityId }) => {
        try {
          const detail = await getRunDetails(activityId);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(detail, null, 2),
              },
            ],
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Intervals.icu request failed unexpectedly.";

          return {
            isError: true,
            content: [{ type: "text" as const, text: message }],
          };
        }
      }
    );

    server.registerTool(
      "get_run_streams",
      {
        title: "Get run streams",
        description:
          "Get normalized time-series data for one running activity, including heart rate, pace, cadence, power and elevation where available. Use this for detailed run analysis such as pacing, heart-rate response and interval analysis.",
        inputSchema: z.object({
          activityId: z
            .string()
            .min(1)
            .describe('The Intervals.icu activity id, e.g. "i186254951".'),
          maxPoints: z
            .number()
            .int()
            .min(100)
            .max(1000)
            .default(600)
            .describe("Maximum number of normalized data points to return (100-1000, default 600)."),
        }),
        annotations: {
          title: "Get run streams",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ activityId, maxPoints }) => {
        try {
          const streams = await getRunStreams({ activityId, maxPoints });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(streams, null, 2),
              },
            ],
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Intervals.icu request failed unexpectedly.";

          return {
            isError: true,
            content: [{ type: "text" as const, text: message }],
          };
        }
      }
    );

    server.registerTool(
      "get_wellness",
      {
        title: "Get wellness",
        description:
          "Get recent wellness and recovery data from Intervals.icu, including VO2 max, resting heart rate, HRV, sleep, weight and other available recovery metrics. Use this for recovery assessment and physiological trends.",
        inputSchema: z.object({
          days: z
            .number()
            .int()
            .min(7)
            .max(365)
            .default(30)
            .describe("How many days back to fetch wellness data for (7-365, default 30)."),
        }),
        annotations: {
          title: "Get wellness",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ days }) => {
        try {
          const wellness = await getWellness({ days });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(wellness, null, 2),
              },
            ],
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Intervals.icu request failed unexpectedly.";

          return {
            isError: true,
            content: [{ type: "text" as const, text: message }],
          };
        }
      }
    );

    server.registerTool(
      "get_running_progress",
      {
        title: "Get running progress",
        description:
          "Analyze running progress and trends over time using recent running activities and wellness data. Includes weekly volume, pace, heart rate, training load, VO2 max trends and recent-vs-previous period comparisons.",
        inputSchema: z.object({
          days: z
            .number()
            .int()
            .min(14)
            .max(365)
            .default(90)
            .describe("Overall analysis window in days (14-365, default 90)."),
          comparisonDays: z
            .number()
            .int()
            .min(7)
            .max(56)
            .default(14)
            .describe(
              "Length of the recent-vs-previous comparison windows in days (7-56, default 14). recentPeriod is the last comparisonDays days; previousPeriod is the comparisonDays days immediately before that."
            ),
        }),
        annotations: {
          title: "Get running progress",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ days, comparisonDays }) => {
        try {
          const progress = await getRunningProgress({ days, comparisonDays });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(progress, null, 2),
              },
            ],
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Intervals.icu request failed unexpectedly.";

          return {
            isError: true,
            content: [{ type: "text" as const, text: message }],
          };
        }
      }
    );

    server.registerTool(
      "get_calendar",
      {
        title: "Get calendar",
        description:
          "Get recent and upcoming calendar events and planned workouts from Intervals.icu. Use this to inspect scheduled training, upcoming running sessions and their workout structure.",
        inputSchema: z.object({
          daysBefore: z
            .number()
            .int()
            .min(0)
            .max(90)
            .default(7)
            .describe("How many days before today to include (0-90, default 7)."),
          daysAfter: z
            .number()
            .int()
            .min(1)
            .max(180)
            .default(21)
            .describe("How many days after today to include (1-180, default 21)."),
        }),
        annotations: {
          title: "Get calendar",
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ daysBefore, daysAfter }) => {
        try {
          const calendar = await getCalendar({ daysBefore, daysAfter });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(calendar, null, 2),
              },
            ],
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Intervals.icu request failed unexpectedly.";

          return {
            isError: true,
            content: [{ type: "text" as const, text: message }],
          };
        }
      }
    );
  },
  {
    serverInfo: {
      name: "running-coach-mcp",
      version: "0.1.0",
    },
  }
);

const handler = withWorkosAuth(mcpHandler);

export { handler as GET, handler as POST };
