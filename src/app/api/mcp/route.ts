import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

import { getRecentRuns } from "@/lib/intervals/activities";
import { IntervalsApiError } from "@/lib/intervals/client";

/**
 * MCP endpoint (Streamable HTTP transport, via `mcp-handler`).
 *
 * Milestone 1 exposes exactly one, read-only tool: `get_recent_runs`.
 * MCP-specific code here only talks to our domain layer
 * (`getRecentRuns`) — it never touches the raw Intervals.icu response
 * shape directly.
 */
const handler = createMcpHandler(
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
  },
  {
    serverInfo: {
      name: "running-coach-mcp",
      version: "0.1.0",
    },
  }
);

export { handler as GET, handler as POST };
