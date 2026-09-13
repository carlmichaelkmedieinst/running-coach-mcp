import { NextResponse } from "next/server";

import { isOAuthConfigured } from "@/lib/auth/config";
import { isIntervalsConfigured } from "@/lib/intervals/auth";

/**
 * Lightweight, PUBLIC health check — does not require OAuth. Does NOT
 * call Intervals.icu or WorkOS, and never exposes the athlete id, API
 * key, allow-listed user id, or any token/JWT contents.
 * `intervalsConfigured` / `oauthConfigured` only reflect whether their
 * required environment variables are present.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "running-coach-mcp",
    intervalsConfigured: isIntervalsConfigured(),
    oauthConfigured: isOAuthConfigured(),
  });
}
