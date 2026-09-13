import { NextResponse } from "next/server";

import { isIntervalsConfigured } from "@/lib/intervals/auth";

/**
 * Lightweight health check. Does NOT call Intervals.icu and never exposes
 * the athlete id or API key — `intervalsConfigured` only reflects whether
 * the environment variable is present.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "running-coach-mcp",
    intervalsConfigured: isIntervalsConfigured(),
  });
}
